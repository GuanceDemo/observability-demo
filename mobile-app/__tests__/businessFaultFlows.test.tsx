import React from 'react';
import {NativeModules} from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from '../App';
import {BookContentRequestError, DemoApi} from '../src/api';
import {BUSINESS_FAULT_IDS} from '../src/businessFaults';
import {FaultDrawer} from '../src/components/FaultDrawer';
import {StoreBottomNav, StoreHeader} from '../src/components/StoreHeader';
import {DetailFaultBoundary} from '../src/components/DetailFaultBoundary';
import {CheckoutPreview} from '../src/components/CheckoutPreview';
import {HomeScreen} from '../src/screens/HomeScreen';
import {BagScreen} from '../src/screens/BagScreen';
import {DetailScreen} from '../src/screens/DetailScreen';
import {recordFaultEvent} from '../src/observability';
import {persistStore} from '../src/storage';
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
const otherBookId = 'distributed-observability';
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

describe('six business-triggered Android fault flows', () => {
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
  });

  it('arms without an error, then catches a real detail render error and reloads the baseline', async () => {
    await enable(BUSINESS_FAULT_IDS.detail);
    expect(recordFaultEvent).not.toHaveBeenCalledWith('book_detail_render_failed', expect.anything());
    await openBook();
    expect(tree.root.findByProps({testID: 'detail-error'})).toBeTruthy();
    expect(tree.root.findByType(StoreHeader)).toBeTruthy();
    expect(drawer().run.phase).toBe('triggered');
    expect(recordFaultEvent).toHaveBeenCalledWith('book_detail_render_failed', expect.objectContaining({
      error_type: 'TypeError', js_stack: expect.stringContaining('DetailScreen'), book_id: bookId,
    }));
    await act(async () => { tree.root.findByType(DetailFaultBoundary).props.onRetry(); });
    expect(tree.root.findAllByProps({testID: 'detail-error'})).toHaveLength(0);
    expect(tree.root.findByType(DetailScreen).props.product.zh.description).toEqual(expect.any(String));
    expect(drawer().run.phase).toBe('recovered');
  });

  it('records repeated missing cart updates, then allows the same add after recovery', async () => {
    await enable(BUSINESS_FAULT_IDS.addCart);
    for (let i = 0; i < 2; i += 1) {
      await act(async () => { tree.root.findByType(HomeScreen).props.onAddBook(otherBookId); });
    }
    expect(tree.root.findByType(StoreBottomNav).props.cartQuantity).toBe(1);
    expect(jest.mocked(recordFaultEvent).mock.calls.filter(([name]) => name === 'cart_update_missing')).toHaveLength(2);
    expect(recordFaultEvent).toHaveBeenCalledWith('cart_update_missing', expect.objectContaining({
      previous_quantity: 0, expected_quantity: 1, actual_quantity: 0, fault_phase: 'triggered',
    }));
    await act(async () => { drawer().onRecover(); });
    await act(async () => { tree.root.findByType(HomeScreen).props.onAddBook(otherBookId); });
    expect(tree.root.findByType(StoreBottomNav).props.cartQuantity).toBe(2);
    expect(api.recoverFaults).not.toHaveBeenCalled();
  });

  it('shows a stale total while retaining correct cart state and blocks both order paths until recalculation', async () => {
    await enable(BUSINESS_FAULT_IDS.cartTotal);
    await navigate('cart');
    const original = bag().amountCent;
    await act(async () => { bag().onQuantityChange(bookId, 2); });
    expect(bag()).toMatchObject({amountCent: original, selectedCopies: 2, checkoutBlocked: true});
    expect(bag().lines[0].lineAmountCent).toBe(original * 2);
    await act(async () => { bag().onPurchase(); bag().onBatchPurchase(); });
    expect(api.purchase).not.toHaveBeenCalled();
    expect(api.runPurchaseTraffic).not.toHaveBeenCalled();
    await act(async () => { bag().onRefreshTotal(); });
    expect(bag()).toMatchObject({amountCent: original * 2, checkoutBlocked: false});
    expect(drawer().run.phase).toBe('recovered');
  });

  it('opens a native preview, invokes only the fixed-duration bridge and recovers when it resumes', async () => {
    let resume!: (value: number) => void;
    NativeModules.DemoFaults = {blockCheckoutPreview: jest.fn(() => new Promise(resolve => {resume = resolve;}))};
    jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => {callback(0); return 1;});
    await enable(BUSINESS_FAULT_IDS.uiBlock);
    await navigate('cart');
    await act(async () => { bag().onPreview(); });
    expect(tree.root.findByType(CheckoutPreview).props.visible).toBe(true);
    expect(NativeModules.DemoFaults.blockCheckoutPreview).toHaveBeenCalledWith();
    expect(drawer().run.phase).toBe('triggered');
    await act(async () => { resume(1802); });
    expect(drawer().run.phase).toBe('recovered');
    expect(bag().selectedCopies).toBe(1);
    expect(recordFaultEvent).toHaveBeenCalledWith('checkout_preview_resumed', expect.objectContaining({blocked_duration_ms: 1802}));
  });

  it('keeps book content loading until the real slow request resolves and carries the run ID', async () => {
    let finish!: (value: ReturnType<typeof response>) => void;
    api.bookContent.mockReturnValue(new Promise(resolve => {finish = resolve;}));
    await enable(BUSINESS_FAULT_IDS.slow);
    await openBook();
    expect(tree.root.findByProps({testID: 'book-content-loading'})).toBeTruthy();
    expect(api.bookContent).toHaveBeenCalledWith(bookId, 'mall-demo', expect.objectContaining({
      faultRunId: drawer().run.id, faultId: BUSINESS_FAULT_IDS.slow, faultPhase: 'triggered',
    }), 'slow', expect.anything());
    await act(async () => { finish(response()); });
    expect(tree.root.findByType(DetailScreen).props.content.status).toBe('ready');
    expect(recordFaultEvent).toHaveBeenCalledWith('book_content_load_succeeded', expect.objectContaining({duration_ms: 3500, attempt: 1}));
  });

  it('shows a real deadline failure and retries normal content with the same recovered run', async () => {
    api.bookContent.mockRejectedValueOnce(new BookContentRequestError(new Error('Aborted'), true, false, 'biz-timeout', 2000));
    await enable(BUSINESS_FAULT_IDS.timeout);
    const runId = drawer().run.id;
    await openBook();
    expect(tree.root.findByProps({testID: 'book-content-error'})).toBeTruthy();
    expect(recordFaultEvent).toHaveBeenCalledWith('book_content_load_failed', expect.objectContaining({timeout_source: 'app_deadline', duration_ms: 2000}));
    await act(async () => { tree.root.findByType(DetailScreen).props.onContentRetry(); });
    expect(api.bookContent).toHaveBeenLastCalledWith(bookId, 'mall-demo', expect.objectContaining({faultRunId: runId, faultPhase: 'recovered'}), 'normal', expect.anything());
    expect(tree.root.findByType(DetailScreen).props.content.status).toBe('ready');
    expect(recordFaultEvent).toHaveBeenCalledWith('book_content_load_succeeded', expect.objectContaining({attempt: 2}));
  });

  it('aborts a request when leaving details and ignores a late failed response', async () => {
    let fail!: (error: Error) => void;
    api.bookContent.mockReturnValue(new Promise((_, reject) => {fail = reject;}));
    await enable(BUSINESS_FAULT_IDS.slow);
    await openBook();
    const signal = api.bookContent.mock.calls[0][4];
    await navigate('cart');
    expect(signal?.aborted).toBe(true);
    await act(async () => { fail(new Error('late failure')); });
    expect(recordFaultEvent).not.toHaveBeenCalledWith('book_content_load_failed', expect.anything());
    expect(tree.root.findByType(BagScreen)).toBeTruthy();
  });
});
