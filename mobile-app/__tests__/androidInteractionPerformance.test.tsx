import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from '../App';
import {DemoApi} from '../src/api';
import {FaultDrawer} from '../src/components/FaultDrawer';
import {StoreHeader} from '../src/components/StoreHeader';
import {DetailScreen} from '../src/screens/DetailScreen';

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
jest.mock('../src/screens/ReadingPathScreen', () => ({ReadingPathScreen: () => null}));
jest.mock('../src/screens/BagScreen', () => ({BagScreen: () => null}));

import {ResultToast} from '../src/components/ResultToast';
import {BUSINESS_FAULT_IDS} from '../src/businessFaults';
import {recordFaultEvent} from '../src/observability';
import {PRODUCTS} from '../src/data';

jest.mock('../src/components/Commerce', () => {
  const actual = jest.requireActual('../src/components/Commerce');
  const renderProductCard = jest.fn(actual.ProductCard.type);
  return {...actual, ProductCard: require('react').memo(renderProductCard), renderProductCard};
});
const cards = require('../src/components/Commerce').renderProductCard as jest.Mock;
const api = jest.mocked(DemoApi.prototype);
const bookId = 'distributed-observability';

it('isolates catalog renders, retains fresh business handlers, and restores home scroll after navigation', async () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  let tree!: TestRenderer.ReactTestRenderer;
  try {
    await AsyncStorage.clear();
    api.getMobileConfig.mockRejectedValue(new Error('SDK isolated'));
    api.getPublicConfig.mockResolvedValue({project: 'mall-demo'});
    api.getFaultCatalog.mockResolvedValue({items: [], active: {}, timestamp: ''});
    api.getAuthSession.mockResolvedValue({authenticated: false, user: null, personas: []});
    api.bookContent.mockResolvedValue({data: {bookId, title: 'Book', description: 'Content', parts: []}, businessRequestId: 'audit', durationMs: 1});
    await act(async () => { tree = TestRenderer.create(<App />); });
    const counts: Record<string, number> = {};
    const add = (id = bookId) => tree.root.findByProps({testID: `add-${id}`}).props.onPress();
    const open = () => tree.root.findByProps({testID: `product-card-${bookId}`}).findAll(node => typeof node.props.onPress === 'function')[0].props.onPress();
    const home = () => tree.root.findByProps({testID: 'home-screen'});
    cards.mockClear();
    await act(async () => { tree.root.findByType(StoreHeader).props.faultControl.props.onPress(); });
    counts.openDrawer = cards.mock.calls.length;
    cards.mockClear();
    await act(async () => { tree.root.findByType(FaultDrawer).props.onClose(); });
    counts.closeDrawer = cards.mock.calls.length;
    cards.mockClear();
    await act(async () => { add(); });
    counts.addOneBook = cards.mock.calls.length;
    cards.mockClear();
    await act(async () => { tree.root.findByType(ResultToast).props.onDismiss(); });
    counts.dismissToast = cards.mock.calls.length;
    expect(counts).toEqual({openDrawer: 0, closeDrawer: 0, addOneBook: 1, dismissToast: 0});

    // A memoized card must see the latest cart, even when its visual state is unchanged.
    await act(async () => { add(); });
    expect(JSON.parse((await AsyncStorage.getItem('mall-demo-mobile:store:v2'))!).cart[bookId]).toBe(1);
    expect(tree.root.findByType(ResultToast).props.toast.title).toBe('《分布式系统可观测性》已加入购物车');
    await act(async () => { tree.root.findByType(StoreHeader).props.onToggleLanguage(); });
    await act(async () => { add(); });
    expect(tree.root.findByType(ResultToast).props.toast.title).toBe('“Distributed Systems Observability” was added to your cart');
    await act(async () => { tree.root.findByType(StoreHeader).props.onToggleLanguage(); });
    await act(async () => {
      tree.root.findByType(FaultDrawer).props.onInject({id: BUSINESS_FAULT_IDS.addCart, title: 'Ignored add', layer: 'frontend', kind: 'business', clientSide: true, mode: 'client', target: 'business', execution: 'client', ttlSeconds: 0});
    });
    cards.mockClear();
    jest.mocked(recordFaultEvent).mockClear();
    await act(async () => { add(); });
    expect(recordFaultEvent).not.toHaveBeenCalledWith('cart_update_missing', expect.anything());
    await act(async () => { add(PRODUCTS[2].id); });
    expect(cards).not.toHaveBeenCalled();
    expect(recordFaultEvent).toHaveBeenCalledWith('mobile_fault_triggered', expect.objectContaining({fault_id: BUSINESS_FAULT_IDS.addCart}));
    await act(async () => { tree.root.findByType(FaultDrawer).props.onRecover(); });

    act(() => {
      home().props.onScrollEndDrag({nativeEvent: {contentOffset: {y: 220}}});
      home().props.onMomentumScrollEnd({nativeEvent: {contentOffset: {y: 410}}});
    });
    await act(async () => { open(); });
    expect(tree.root.findAllByProps({testID: 'home-screen'})).toHaveLength(0);
    await act(async () => { tree.root.findByType(DetailScreen).props.onBack(); });
    expect(home().props.contentOffset).toEqual({x: 0, y: 410});
    await act(async () => { tree.root.findByType(StoreHeader).props.onQueryChange('分布式'); });
    // The native scroll command resets immediately; remount also starts from zero.
    await act(async () => { open(); });
    await act(async () => { tree.root.findByType(DetailScreen).props.onBack(); });
    expect(home().props.contentOffset).toEqual({x: 0, y: 0});
  } finally {
    if (tree) { act(() => tree.unmount()); }
    consoleError.mockRestore();
  }
});
