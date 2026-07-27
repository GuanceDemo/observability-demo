import {
  initialStoreState,
  storeReducer,
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
  it('owns navigation, theme and shopping bag transitions', () => {
    const state = reduce(initialStoreState, [
      {type: 'navigate', screen: 'detail'},
      {type: 'setCart', quantity: 1},
      {type: 'setTheme', theme: 'white'},
      {type: 'navigate', screen: 'purchase'},
    ]);
    expect(state).toMatchObject({
      screen: 'purchase',
      cartQuantity: 1,
      theme: 'white',
    });
  });

  it('normalizes persisted cart data', () => {
    const state = storeReducer(initialStoreState, {
      type: 'hydrate',
      theme: 'white',
      cartQuantity: 99,
      selectedSku: 'sku-1001',
    });
    expect(state.cartQuantity).toBe(1);
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

  it('restores an active server fault without inventing injection history', () => {
    const serverFault = {
      ...whiteScreenFault,
      id: 'payment_error',
      mode: 'payment_error',
      execution: 'server' as const,
      clientSide: false,
    };
    const state = storeReducer(initialStoreState, {
      type: 'restoreActiveFault',
      scenario: serverFault,
    });

    expect(state.activeFault).toEqual(serverFault);
    expect(state.selectedFaultId).toBe('payment_error');
    expect(state.faultHistory).toEqual([]);
  });
});
