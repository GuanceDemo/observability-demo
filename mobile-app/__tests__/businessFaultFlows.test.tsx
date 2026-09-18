import React from 'react';
import {AppState, NativeModules, Platform} from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from '../App';
import {DemoApi} from '../src/api';
import {BUSINESS_FAULT_IDS} from '../src/businessFaults';
import {FaultDrawer} from '../src/components/FaultDrawer';
import {StoreBottomNav, StoreHeader} from '../src/components/StoreHeader';
import {CheckoutCrashConfirmation} from '../src/components/CheckoutCrashConfirmation';
import {HomeScreen} from '../src/screens/HomeScreen';
import {BagScreen} from '../src/screens/BagScreen';
import {DetailScreen} from '../src/screens/DetailScreen';
import {addError, recordFaultEvent, startView, stopView} from '../src/observability';
import {consumeCrashMarker, persistStore, writeCrashMarker} from '../src/storage';
import type {FaultScenario} from '../src/types';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: require('react-native').View,
  SafeAreaView: require('react-native').View,
  useSafeAreaInsets: () => ({top: 24, bottom: 16, left: 0, right: 0}),
}));
jest.mock('../src/api', () => {
  const actual = jest.requireActual('../src/api');
  const mocked = jest.createMockFromModule<typeof import('../src/api')>('../src/api');
  return {...mocked, BookContentRequestError: actual.BookContentRequestError};
});
jest.mock('../src/observability', () => ({
  action: jest.fn(), bindUser: jest.fn(), initializeObservability: jest.fn(),
  log: jest.fn(), startView: jest.fn(), stopView: jest.fn(),
  recordFaultEvent: jest.fn(), setFaultObservationContext: jest.fn(async () => undefined),
  addError: jest.fn(async () => undefined),
}));
jest.mock('../src/interactionAck', () => ({acknowledgeInteraction: jest.fn()}));
jest.mock('../src/components/AuthOverlay', () => ({AuthOverlay: () => null}));
jest.mock('../src/components/FaultDrawer', () => ({FaultDrawer: () => null, FaultToolbarButton: () => null}));
jest.mock('../src/components/ResultToast', () => ({ResultToast: () => null}));
jest.mock('../src/components/StoreHeader', () => ({StoreHeader: () => null, StoreBottomNav: () => null}));
jest.mock('../src/screens/HomeScreen', () => ({HomeScreen: () => null}));
jest.mock('../src/screens/ReadingPathScreen', () => ({ReadingPathScreen: () => null}));
jest.mock('../src/screens/BagScreen', () => ({BagScreen: () => null}));

const api = jest.mocked(DemoApi.prototype);
const bookId = 'observability-engineering';
const response = (id = bookId) => ({
  data: {bookId: id, title: 'Book content', description: 'Real response content', parts: []},
  businessRequestId: 'biz-content-test', durationMs: 3500,
});
const scenarios = Object.values(BUSINESS_FAULT_IDS).map(id => ({
  id, title: id, layer: id.includes('content') ? 'network' : id.includes('ui_block') ? 'runtime' : 'frontend',
  kind: 'business', mode: 'client', ttlSeconds: 0, service: 'mall-mobile', target: 'business', execution: 'client',
  description: 'Trigger from business UI', expectedObservation: 'RUM', clientSide: true,
  platforms: ['android'], scenes: ['mobile-storefront'],
})) as FaultScenario[];

describe('real Android fault flows', () => {
  let tree: TestRenderer.ReactTestRenderer;
  let consoleError: jest.SpyInstance;
  const drawer = () => tree.root.findByType(FaultDrawer).props;
  const bag = () => tree.root.findByType(BagScreen).props;
  async function enable(id: string) {
    await act(async () => { drawer().onInject(scenarios.find(item => item.id === id)); });
    expect(drawer().run.phase).toBe('armed');
  }
  async function navigate(screen: string) {
    await act(async () => { tree.root.findByType(StoreBottomNav).props.onNavigate(screen); });
  }
  async function openBook() {
    await act(async () => { tree.root.findByType(HomeScreen).props.onOpenBook(bookId); });
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.mocked(startView).mockReset().mockResolvedValue(undefined);
    Platform.OS = 'android';
    NativeModules.DemoFaults = {nativePerformanceEnabled: true, blockBookDetails: jest.fn(async () => 2000), cancelBookDetailsBlock: jest.fn(), checkoutCrashEnabled: true, crashCheckout: jest.fn(async () => undefined)};
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await AsyncStorage.clear();
    await persistStore({language: 'zh', currentBookId: bookId, activeTopic: 'all', sort: 'recommended',
      visitorId: 'visitor-business-fault-test', cart: {[bookId]: 1}, selectedCartIds: [bookId]});
    api.getMobileConfig.mockRejectedValue(new Error('SDK mocked'));
    api.getPublicConfig.mockResolvedValue({project: 'mall-demo', workspaceId: 'workspace-test', observabilityConsoleUrl: 'https://console.guance.com'});
    api.getFaultCatalog.mockResolvedValue({items: scenarios, active: {}, timestamp: new Date().toISOString()});
    api.getAuthSession.mockResolvedValue({authenticated: true,
      user: {id: 'reader', name: 'Reader', email: 'reader@example.invalid', tier: 'standard'}, personas: []});
    api.bookContent.mockResolvedValue(response());
    await act(async () => { tree = TestRenderer.create(<App />); });
  });
  afterEach(() => {
    act(() => tree.unmount());
    consoleError.mockRestore();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it.each([BUSINESS_FAULT_IDS.anr, BUSINESS_FAULT_IDS.freeze])('runs %s through the native bridge and recovers without a synthetic Error', async id => {
    let complete!: (duration: number) => void;
    NativeModules.DemoFaults.blockBookDetails.mockImplementationOnce(() => new Promise<number>(resolve => { complete = resolve; }));
    await enable(id);
    expect(NativeModules.DemoFaults.blockBookDetails).not.toHaveBeenCalled();
    await openBook();
    expect(drawer().run.phase).toBe('triggered');
    if (id === BUSINESS_FAULT_IDS.freeze) {
      expect(tree.root.findByProps({testID: 'book-content-expanding'})).toBeTruthy();
      expect(tree.root.findAllByProps({testID: 'book-content-expanded'})).toHaveLength(0);
    }
    expect(NativeModules.DemoFaults.blockBookDetails).toHaveBeenCalledWith(id === BUSINESS_FAULT_IDS.anr ? 'anr' : 'freeze');
    expect(addError).not.toHaveBeenCalled();
    const marker = await AsyncStorage.getItem('mall-demo-mobile:crash-marker:v1');
    if (id === BUSINESS_FAULT_IDS.anr) expect(JSON.parse(marker!)).toMatchObject({scenarioId: id, run: {id: drawer().run.id, phase: 'triggered'}});
    else expect(marker).toBeNull();
    await act(async () => { complete(4000); });
    if (id === BUSINESS_FAULT_IDS.freeze) {
      expect(tree.root.findAllByProps({testID: 'book-content-expanding'})).toHaveLength(0);
      expect(tree.root.findByProps({testID: 'book-content-expanded'})).toBeTruthy();
    }
    await expect(consumeCrashMarker()).resolves.toBeNull();
    expect(drawer().run.phase).toBe('recovered');
    expect(addError).not.toHaveBeenCalled();
  });

  it.each([BUSINESS_FAULT_IDS.anr, BUSINESS_FAULT_IDS.freeze])('ignores an old %s completion after switching scenarios', async id => {
    let complete!: (duration: number) => void;
    NativeModules.DemoFaults.blockBookDetails.mockImplementationOnce(() => new Promise<number>(resolve => { complete = resolve; }));
    await enable(id);
    await openBook();
    await enable(BUSINESS_FAULT_IDS.loading);
    const nextRun = drawer().run.id;
    expect(NativeModules.DemoFaults.cancelBookDetailsBlock).toHaveBeenCalled();
    await act(async () => { complete(3000); });
    expect(drawer().run).toMatchObject({id: nextRun, phase: 'armed'});
    expect(tree.root.findAllByProps({testID: 'book-content-expanded'})).toHaveLength(0);
    expect(tree.root.findAllByProps({testID: 'book-content-expanding'})).toHaveLength(0);
    expect(addError).not.toHaveBeenCalled();
  });

  it('recovers when the native bridge rejects instead of claiming a captured ANR', async () => {
    NativeModules.DemoFaults.blockBookDetails.mockRejectedValueOnce(new Error('PERFORMANCE_BUSY'));
    await enable(BUSINESS_FAULT_IDS.anr);
    await openBook();
    expect(drawer().run.phase).toBe('recovered');
    expect(addError).not.toHaveBeenCalled();
    expect(recordFaultEvent).not.toHaveBeenCalledWith('native_detail_block_finished', expect.anything());
  });

  it('arms without an error, then lets the real asynchronous TypeError escape to the runtime', async () => {
    jest.useFakeTimers();
    await enable(BUSINESS_FAULT_IDS.detail);
    expect(addError).not.toHaveBeenCalled();
    await openBook();
    const runId = drawer().run.id;
    expect(tree.root.findAllByProps({testID: 'detail-container'})).toHaveLength(0);
    expect(() => { act(() => jest.advanceTimersByTime(0)); }).toThrow(TypeError);
    expect(recordFaultEvent).not.toHaveBeenCalledWith('book_detail_render_failed', expect.anything());
    expect(addError).not.toHaveBeenCalled();
    await expect(consumeCrashMarker()).resolves.toMatchObject({run: {id: runId, scenarioId: BUSINESS_FAULT_IDS.detail, phase: 'triggered'}});
  });

  it('cancels pending JS preparation when the scenario is switched before it runs', async () => {
    jest.useFakeTimers();
    await enable(BUSINESS_FAULT_IDS.detail);
    await openBook();
    await enable(BUSINESS_FAULT_IDS.loading);
    expect(() => { act(() => jest.advanceTimersByTime(0)); }).not.toThrow();
    await expect(consumeCrashMarker()).resolves.toBeNull();
    expect(addError).not.toHaveBeenCalled();
  });

  it('establishes the detail View before JS preparation errors and content requests', async () => {
    jest.useFakeTimers();
    await enable(BUSINESS_FAULT_IDS.detail);
    let finishView!: () => void;
    jest.mocked(startView).mockImplementationOnce(() => new Promise<void>(resolve => { finishView = resolve; }));
    await openBook();
    expect(startView).toHaveBeenLastCalledWith('storefront/detail', expect.objectContaining({book_id: bookId}));
    expect(tree.root.findAllByProps({testID: 'detail-white-screen'})).toHaveLength(0);
    expect(api.bookContent).not.toHaveBeenCalled();
    expect(drawer().run.phase).toBe('armed');
    await act(async () => { finishView(); });
    expect(tree.root.findByType(DetailScreen).props.deferPreparation).toBe(true);
    expect(api.bookContent).toHaveBeenCalledTimes(1);
    expect(stopView).not.toHaveBeenCalled();
    const views = jest.mocked(startView).mock.calls.length;
    await act(async () => { tree.root.findByType(StoreHeader).props.onToggleLanguage(); });
    expect(startView).toHaveBeenCalledTimes(views);
  });

  it('does not render an obsolete destination when a newer navigation wins', async () => {
    let finishView!: () => void;
    jest.mocked(startView).mockImplementationOnce(() => new Promise<void>(resolve => { finishView = resolve; }));
    await openBook();
    await navigate('cart');
    await act(async () => { finishView(); });
    expect(tree.root.findByType(BagScreen)).toBeTruthy();
    expect(tree.root.findAllByType(DetailScreen)).toHaveLength(0);
    expect(api.bookContent).not.toHaveBeenCalled();
    expect(startView).toHaveBeenLastCalledWith('storefront/cart', expect.anything());
  });

  it('restores the visible business View on foreground without navigation View churn', async () => {
    jest.useFakeTimers();
    const listener = jest.spyOn(AppState, 'addEventListener').mockClear();
    act(() => tree.unmount());
    await act(async () => { tree = TestRenderer.create(<App />); });
    await navigate('cart');
    const change = listener.mock.calls.find(([event]) => event === 'change')![1];
    jest.mocked(startView).mockClear();
    jest.mocked(stopView).mockClear();
    await act(async () => { change('background'); jest.advanceTimersByTime(300); change('active'); });
    expect(startView).not.toHaveBeenCalled();
    expect(stopView).not.toHaveBeenCalled();
    await act(async () => { change('background'); jest.advanceTimersByTime(500); });
    expect(stopView).toHaveBeenCalledWith({reason: 'background'});
    await act(async () => { change('active'); });
    expect(startView).toHaveBeenCalledTimes(1);
    expect(startView).toHaveBeenCalledWith('storefront/cart', expect.objectContaining({screen: 'cart'}));
    await act(async () => { change('active'); });
    expect(startView).toHaveBeenCalledTimes(1);
  });

  it('uses only the three APK client scenarios and retains the server catalog', async () => {
    expect(drawer().scenarios.map((item: FaultScenario) => item.id)).toEqual(Object.values(BUSINESS_FAULT_IDS));
    expect(drawer().scenarios.every((item: FaultScenario) => item.layer === 'android')).toBe(true);
  });

  it('keeps loading after an actual successful response and detects it once, then restores ready', async () => {
    jest.useFakeTimers();
    await enable(BUSINESS_FAULT_IDS.loading);
    const runId = drawer().run.id;
    await openBook();
    expect(api.bookContent).toHaveBeenCalledWith(bookId, 'mall-demo', expect.objectContaining({faultRunId: runId}), 'normal', expect.anything());
    expect(recordFaultEvent).toHaveBeenCalledWith('book_content_load_succeeded', expect.objectContaining({biz_request_id: 'biz-content-test'}));
    expect(tree.root.findByType(DetailScreen).props.content.status).toBe('loading');
    expect(tree.root.findByProps({testID: 'book-content-loading'}).props.accessibilityState).toEqual({busy: true});
    expect(tree.root.findByProps({testID: 'detail-screen'}).props.scrollEnabled).toBe(false);
    await act(async () => { jest.advanceTimersByTime(3100); });
    expect(addError).toHaveBeenCalledWith('ContentNotReady', expect.any(String), expect.objectContaining({
      fault_run_id: runId, state_event: 'content_loaded', expected_event: 'content_ready', actual_state: 'loading',
      stack_origin: 'content_state_transition', error_detection: 'readiness_timeout',
      biz_request_id: 'biz-content-test',
    }), expect.any(Error));
    const capturedError = jest.mocked(addError).mock.calls[0][3]!;
    expect(capturedError.name).toBe('ContentNotReady');
    expect(capturedError.stack).toContain('useBookContent.ts');
    expect(capturedError.stack).not.toContain('callTimer');
    await act(async () => { jest.advanceTimersByTime(5000); });
    expect(addError).toHaveBeenCalledTimes(1);
    await act(async () => { drawer().onRecover(); });
    expect(tree.root.findByType(DetailScreen).props.content.status).toBe('ready');
    expect(tree.root.findAllByProps({testID: 'book-content-loading'})).toHaveLength(0);
    expect(tree.root.findByProps({testID: 'detail-screen'}).props.scrollEnabled).toBe(true);
    expect(drawer().run.phase).toBe('recovered');
    expect(api.recoverFaults).not.toHaveBeenCalled();
  });

  it('cancels the readiness detector on navigation and ignores late failed responses', async () => {
    jest.useFakeTimers();
    await enable(BUSINESS_FAULT_IDS.loading);
    await openBook();
    await navigate('cart');
    await act(async () => { jest.advanceTimersByTime(4000); });
    expect(addError).not.toHaveBeenCalled();
    await navigate('home');
    let fail!: (error: Error) => void;
    api.bookContent.mockReturnValue(new Promise((_, reject) => {fail = reject;}));
    await openBook();
    const signal = api.bookContent.mock.calls.at(-1)![4];
    await navigate('cart');
    expect(signal?.aborted).toBe(true);
    await act(async () => { fail(new Error('late failure')); });
    expect(recordFaultEvent).not.toHaveBeenCalledWith('book_content_load_failed', expect.anything());
  });

  it('requires checkout confirmation, persists correlation, and never submits an order', async () => {
    await enable(BUSINESS_FAULT_IDS.crash);
    await navigate('cart');
    expect(NativeModules.DemoFaults.crashCheckout).not.toHaveBeenCalled();
    await act(async () => { bag().onPurchase(); });
    await act(async () => { tree.root.findByType(CheckoutCrashConfirmation).props.onCancel(); });
    expect(drawer().run.phase).toBe('armed');
    expect(NativeModules.DemoFaults.crashCheckout).not.toHaveBeenCalled();
    await act(async () => { bag().onPurchase(); });
    await act(async () => { tree.root.findByType(CheckoutCrashConfirmation).props.onConfirm(); });
    expect(NativeModules.DemoFaults.crashCheckout).toHaveBeenCalledTimes(1);
    expect(api.purchase).not.toHaveBeenCalled();
    expect(api.runPurchaseTraffic).not.toHaveBeenCalled();
    await expect(consumeCrashMarker()).resolves.toMatchObject({run: {id: drawer().run.id, phase: 'triggered'}});
  });

  it('invalidates an outstanding checkout confirmation when recovered', async () => {
    await enable(BUSINESS_FAULT_IDS.crash);
    await navigate('cart');
    await act(async () => { bag().onPurchase(); });
    await act(async () => { drawer().onRecover(); });
    await act(async () => { tree.root.findByType(CheckoutCrashConfirmation).props.onConfirm(); });
    expect(NativeModules.DemoFaults.crashCheckout).not.toHaveBeenCalled();
    expect(api.purchase).not.toHaveBeenCalled();
  });

  it.each([BUSINESS_FAULT_IDS.detail, BUSINESS_FAULT_IDS.crash, BUSINESS_FAULT_IDS.anr])('restores %s after restart without synthesizing an error', async scenarioId => {
    const run = {id: 'fault-restart-123', scenarioId, layer: 'android', phase: 'triggered' as const, startedAt: Date.now()};
    act(() => tree.unmount());
    await writeCrashMarker(run.scenarioId, run);
    await act(async () => { tree = TestRenderer.create(<App />); });
    expect(drawer().run).toMatchObject({...run, phase: 'recovered'});
    expect(recordFaultEvent).toHaveBeenCalledWith(scenarioId === BUSINESS_FAULT_IDS.detail ? 'js_crash_restart_observed' : scenarioId === BUSINESS_FAULT_IDS.anr ? 'native_anr_restart_observed' : 'native_crash_restart_observed', expect.objectContaining({fault_run_id: run.id}));
    expect(NativeModules.DemoFaults.crashCheckout).not.toHaveBeenCalled();
    expect(addError).not.toHaveBeenCalled();
  });
});
