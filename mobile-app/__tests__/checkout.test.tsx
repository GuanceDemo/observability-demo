import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from '../App';
import {DemoApi} from '../src/api';
import {BagScreen} from '../src/screens/BagScreen';
import {StoreBottomNav} from '../src/components/StoreHeader';
import {ResultToast} from '../src/components/ResultToast';
import {loadPersistedStore, persistStore} from '../src/storage';
import type {OrderResult} from '../src/types';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: require('react-native').View,
  SafeAreaView: require('react-native').View,
  useSafeAreaInsets: () => ({top: 24, bottom: 16, left: 0, right: 0}),
}));
jest.mock('../src/api');
jest.mock('../src/observability', () => ({
  action: jest.fn(), bindUser: jest.fn(), initializeObservability: jest.fn(),
  log: jest.fn(), recordFaultEvent: jest.fn(), setFaultObservationContext: jest.fn(), startView: jest.fn(), stopView: jest.fn(),
}));
jest.mock('../src/faults', () => ({dangerousScenarioIds: new Set()}));
jest.mock('../src/interactionAck', () => ({acknowledgeInteraction: jest.fn()}));
// Keep the real root, reducer and persistence; isolate native rendering/SDKs.
jest.mock('../src/components/AuthOverlay', () => ({AuthOverlay: () => null}));
jest.mock('../src/components/FaultDrawer', () => ({FaultDrawer: () => null, FaultToolbarButton: () => null}));
jest.mock('../src/components/ResultToast', () => ({ResultToast: () => null}));
jest.mock('../src/components/StoreHeader', () => ({StoreHeader: () => null, StoreBottomNav: () => null}));
jest.mock('../src/screens/HomeScreen', () => ({HomeScreen: () => null}));
jest.mock('../src/screens/ReadingPathScreen', () => ({ReadingPathScreen: () => null}));
jest.mock('../src/screens/DetailScreen', () => ({DetailScreen: () => null}));
jest.mock('../src/screens/BagScreen', () => ({BagScreen: () => null}));

const initialCart = {'observability-engineering': 2, 'distributed-observability': 3};
const api = jest.mocked(DemoApi.prototype);

describe('native checkout lifecycle', () => {
  let tree: TestRenderer.ReactTestRenderer;

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    await persistStore({
      language: 'zh', currentBookId: 'observability-engineering',
      activeTopic: 'all', sort: 'recommended', visitorId: 'visitor-checkout-test',
      cart: initialCart, selectedCartIds: ['observability-engineering'],
    });
    api.getMobileConfig.mockRejectedValue(new Error('RUM disabled in unit tests'));
    api.getPublicConfig.mockRejectedValue(new Error('not needed'));
    api.getFaultCatalog.mockRejectedValue(new Error('not needed'));
    api.getAuthSession.mockResolvedValue({
      authenticated: true,
      user: {id: 'test-reader', name: 'Reader', email: 'reader@example.invalid', tier: 'standard'},
      personas: [],
    });
    api.purchase.mockResolvedValue({orderId: 'test-order'});
    api.runPurchaseTraffic.mockResolvedValue(Array.from({length: 5}, (_, i) => ({orderId: `test-${i}`})));
    await act(async () => { tree = TestRenderer.create(<App />); });
    await act(async () => {
      tree.root.findByType(StoreBottomNav).props.onNavigate('cart');
    });
  });

  afterEach(() => { act(() => tree.unmount()); });

  it('clears only purchased lines on success and persists them across remount', async () => {
    await act(async () => { tree.root.findByType(BagScreen).props.onPurchase(); });
    expect(api.purchase).toHaveBeenCalledWith('mall-demo',
      {sku: 'sku-1001', quantity: 2, amountCent: 19800}, expect.any(Object));
    expect(tree.root.findByType(ResultToast).props.toast.tone).toBe('success');
    expect(tree.root.findByType(StoreBottomNav).props.cartQuantity).toBe(3);
    expect(tree.root.findByType(BagScreen).props.selectedCopies).toBe(0);
    await expect(loadPersistedStore()).resolves.toMatchObject({
      cart: {'distributed-observability': 3}, selectedCartIds: [],
    });
    act(() => tree.unmount());
    await act(async () => { tree = TestRenderer.create(<App />); });
    expect(tree.root.findByType(StoreBottomNav).props.cartQuantity).toBe(3);
  });

  it('shows the empty-cart state when every line was purchased', async () => {
    await act(async () => { tree.root.findByType(BagScreen).props.onSelectAll(true); });
    await act(async () => { tree.root.findByType(BagScreen).props.onPurchase(); });
    expect(tree.root.findByType(BagScreen).props.lines).toEqual([]);
    expect(tree.root.findByType(StoreBottomNav).props.cartQuantity).toBe(0);
    await expect(loadPersistedStore()).resolves.toMatchObject({cart: {}, selectedCartIds: []});
  });

  it('does not clear the cart before the response or delete newly selected lines', async () => {
    let finish!: (result: OrderResult) => void;
    api.purchase.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await act(async () => { tree.root.findByType(BagScreen).props.onPurchase(); });
    expect(tree.root.findByType(StoreBottomNav).props.cartQuantity).toBe(5);
    await act(async () => {
      tree.root.findByType(BagScreen).props.onToggleSelection('observability-engineering');
      tree.root.findByType(BagScreen).props.onToggleSelection('distributed-observability');
    });
    await act(async () => { finish({orderId: 'test-order'}); });
    await expect(loadPersistedStore()).resolves.toMatchObject({
      cart: {'distributed-observability': 3}, selectedCartIds: ['distributed-observability'],
    });
  });

  it('retains the cart and selection after a failed purchase', async () => {
    api.purchase.mockRejectedValue(new Error('HTTP 503'));
    await act(async () => { tree.root.findByType(BagScreen).props.onPurchase(); });
    expect(tree.root.findByType(ResultToast).props.toast.tone).toBe('error');
    expect(tree.root.findByType(StoreBottomNav).props.cartQuantity).toBe(5);
    await expect(loadPersistedStore()).resolves.toMatchObject({
      cart: initialCart, selectedCartIds: ['observability-engineering'],
    });
  });

  it('retains the cart for the five-order traffic demonstration', async () => {
    await act(async () => { tree.root.findByType(BagScreen).props.onBatchPurchase(); });
    expect(api.runPurchaseTraffic).toHaveBeenCalledWith('mall-demo',
      {sku: 'sku-1001', quantity: 2, amountCent: 19800}, 5, expect.any(Object));
    expect(api.purchase).not.toHaveBeenCalled();
    expect(tree.root.findByType(ResultToast).props.toast.tone).toBe('success');
    expect(tree.root.findByType(StoreBottomNav).props.cartQuantity).toBe(5);
    await expect(loadPersistedStore()).resolves.toMatchObject({
      cart: initialCart, selectedCartIds: ['observability-engineering'],
    });
  });
});
