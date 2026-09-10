import {
  checkoutSnapshot,
  initialStoreState,
  storeReducer,
  visibleProducts,
  type StoreState,
} from '../src/store';
import type {FaultScenario} from '../src/types';

const whiteScreenFault: FaultScenario = {
  id: 'mobile_white_screen',
  title: '移动端白屏',
  layer: 'frontend',
  kind: 'white_screen',
  service: 'mall-mobile',
  target: 'react-native-root',
  mode: 'client',
  description: 'blank',
  expectedObservation: 'RUM Error',
  ttlSeconds: 0,
  clientSide: true,
  execution: 'client',
  platforms: ['android', 'ios'],
};

function reduce(
  state: StoreState,
  actions: Parameters<typeof storeReducer>[1][],
): StoreState {
  return actions.reduce(storeReducer, state);
}

describe('store reducer', () => {
  it('owns native page history and book-detail transitions', () => {
    const state = reduce(initialStoreState, [
      {type: 'navigate', screen: 'path'},
      {type: 'openBook', bookId: 'implementing-slo'},
      {type: 'navigate', screen: 'cart'},
      {type: 'goBack'},
    ]);
    expect(state.screen).toBe('detail');
    expect(state.currentBookId).toBe('implementing-slo');
    expect(state.history).toEqual(['home', 'path', 'detail']);
  });

  it('normalizes hydrated multi-product cart data', () => {
    const state = storeReducer(initialStoreState, {
      type: 'hydrate',
      state: {
        language: 'en',
        currentBookId: 'distributed-observability',
        activeTopic: 'tracing',
        sort: 'price-asc',
        cart: {
          'distributed-observability': 120,
          'missing-book': 4,
        },
        selectedCartIds: ['distributed-observability', 'missing-book'],
        visitorId: 'visitor-test',
      },
    });
    expect(state.cart).toEqual({'distributed-observability': 99});
    expect(state.selectedCartIds).toEqual(['distributed-observability']);
    expect(state.language).toBe('en');
  });

  it('filters, searches, and sorts the canonical catalog', () => {
    const state = reduce(initialStoreState, [
      {type: 'setLanguage', language: 'en'},
      {type: 'setTopic', topicId: 'reliability'},
      {type: 'setQuery', query: 'SLO'},
      {type: 'setSort', sort: 'price-asc'},
    ]);
    const products = visibleProducts(state);
    expect(products.map(product => product.id)).toContain('implementing-slo');
    expect(
      products.every(product => product.tags.some(tag => tag === 'reliability')),
    ).toBe(true);
  });

  it('calculates selected multi-line checkout totals', () => {
    const state = reduce(initialStoreState, [
      {type: 'setCartQuantity', bookId: 'observability-engineering', quantity: 2},
      {type: 'setCartQuantity', bookId: 'distributed-observability', quantity: 3},
      {type: 'toggleCartSelection', bookId: 'observability-engineering'},
    ]);
    const snapshot = checkoutSnapshot(state);
    expect(snapshot.bookIds).toEqual(['distributed-observability']);
    expect(snapshot.totalCopies).toBe(3);
    expect(snapshot.amountCent).toBe(14700);
  });

  it('keeps an active fault while the drawer is closed', () => {
    const state = reduce(initialStoreState, [
      {
        type: 'faultActivated',
        scenario: whiteScreenFault,
        history: {
          id: '1',
          scenarioId: whiteScreenFault.id,
          title: whiteScreenFault.title,
          status: 'active',
          timestamp: '2026-07-26T00:00:00Z',
        },
      },
      {type: 'setDrawer', open: false},
    ]);
    expect(state.drawerOpen).toBe(false);
    expect(state.activeFault?.id).toBe('mobile_white_screen');
  });

  it('removes purchased quantities while retaining unpurchased cart lines', () => {
    const before = {
      ...initialStoreState,
      cart: {'observability-engineering': 2, 'distributed-observability': 3},
      selectedCartIds: ['observability-engineering'],
    };
    const after = storeReducer(before, {
      type: 'completeCheckout',
      items: [{bookId: 'observability-engineering', quantity: 2}],
    });
    expect(after.cart).toEqual({'distributed-observability': 3});
    expect(after.selectedCartIds).toEqual([]);
    expect(before.cart['observability-engineering']).toBe(2);
    expect(checkoutSnapshot(after).totalCopies).toBe(0);
  });

  it('uses the submitted snapshot and retains additions made during checkout', () => {
    const after = storeReducer({
      ...initialStoreState,
      cart: {'observability-engineering': 4, 'distributed-observability': 3},
      selectedCartIds: ['distributed-observability'],
    }, {
      type: 'completeCheckout',
      items: [{bookId: 'observability-engineering', quantity: 2}],
    });
    expect(after.cart).toEqual({'observability-engineering': 2, 'distributed-observability': 3});
    expect(after.selectedCartIds).toEqual(['distributed-observability']);
  });

  it('empties a fully purchased cart without reintroducing removed items', () => {
    const after = storeReducer(initialStoreState, {
      type: 'completeCheckout',
      items: [
        {bookId: 'observability-engineering', quantity: 1},
        {bookId: 'distributed-observability', quantity: 3},
      ],
    });
    expect(after.cart).toEqual({});
    expect(after.selectedCartIds).toEqual([]);
  });

  it('clears only the fault whose injection failed', () => {
    const activeState = storeReducer(initialStoreState, {
      type: 'faultActivated',
      scenario: whiteScreenFault,
      history: {
        id: 'active-1',
        scenarioId: whiteScreenFault.id,
        title: whiteScreenFault.title,
        status: 'active',
        timestamp: '2026-07-26T00:00:00Z',
      },
    });
    const failedState = storeReducer(
      {...activeState, whiteScreen: true},
      {
        type: 'faultFailed',
        history: {
          id: 'failed-1',
          scenarioId: whiteScreenFault.id,
          title: whiteScreenFault.title,
          status: 'failed',
          timestamp: '2026-07-26T00:00:01Z',
          detail: 'DEMO_FAULTS_DISABLED',
        },
      },
    );
    expect(failedState.activeFault).toBeNull();
    expect(failedState.whiteScreen).toBe(false);
    expect(failedState.faultHistory[0].status).toBe('failed');
  });
});
