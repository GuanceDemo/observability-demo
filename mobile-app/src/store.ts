import type {
  FaultHistoryItem,
  FaultScenario,
  StoreScreen,
} from './types';

export interface ToastState {
  tone: 'info' | 'success' | 'error';
  title: string;
  detail: string;
}

export interface StoreState {
  screen: StoreScreen;
  cartQuantity: number;
  selectedSku: string;
  loading: boolean;
  loadingTitle: string;
  loadingDetail: string;
  toast: ToastState | null;
  drawerOpen: boolean;
  whiteScreen: boolean;
  selectedFaultId: string | null;
  activeFault: FaultScenario | null;
  faultHistory: FaultHistoryItem[];
}

export type StoreAction =
  | {type: 'hydrate'; cartQuantity: number; selectedSku: string}
  | {type: 'navigate'; screen: StoreScreen}
  | {type: 'setCart'; quantity: number}
  | {type: 'setSelectedSku'; sku: string}
  | {type: 'setLoading'; loading: boolean; title?: string; detail?: string}
  | {type: 'showToast'; toast: ToastState}
  | {type: 'hideToast'}
  | {type: 'setDrawer'; open: boolean}
  | {type: 'setWhiteScreen'; active: boolean}
  | {type: 'selectFault'; scenarioId: string}
  | {type: 'restoreActiveFault'; scenario: FaultScenario}
  | {type: 'faultActivated'; scenario: FaultScenario; history: FaultHistoryItem}
  | {type: 'faultRecovered'; history: FaultHistoryItem}
  | {type: 'faultFailed'; history: FaultHistoryItem};

export const initialStoreState: StoreState = {
  screen: 'home',
  cartQuantity: 0,
  selectedSku: 'sku-1001',
  loading: false,
  loadingTitle: '',
  loadingDetail: '',
  toast: null,
  drawerOpen: false,
  whiteScreen: false,
  selectedFaultId: null,
  activeFault: null,
  faultHistory: [],
};

function appendHistory(
  history: FaultHistoryItem[],
  item: FaultHistoryItem,
): FaultHistoryItem[] {
  return [item, ...history].slice(0, 8);
}

export function storeReducer(
  state: StoreState,
  action: StoreAction,
): StoreState {
  switch (action.type) {
    case 'hydrate':
      return {
        ...state,
        cartQuantity: Math.max(0, Math.min(1, action.cartQuantity)),
        selectedSku: action.selectedSku,
      };
    case 'navigate':
      return {...state, screen: action.screen};
    case 'setCart':
      return {...state, cartQuantity: Math.max(0, Math.min(1, action.quantity))};
    case 'setSelectedSku':
      return {...state, selectedSku: action.sku};
    case 'setLoading':
      return {
        ...state,
        loading: action.loading,
        loadingTitle: action.title ?? '',
        loadingDetail: action.detail ?? '',
      };
    case 'showToast':
      return {...state, toast: action.toast};
    case 'hideToast':
      return {...state, toast: null};
    case 'setDrawer':
      return {...state, drawerOpen: action.open};
    case 'setWhiteScreen':
      return {...state, whiteScreen: action.active};
    case 'selectFault':
      return {...state, selectedFaultId: action.scenarioId};
    case 'restoreActiveFault':
      return {
        ...state,
        activeFault: action.scenario,
        selectedFaultId: action.scenario.id,
      };
    case 'faultActivated':
      return {
        ...state,
        activeFault: action.scenario,
        selectedFaultId: action.scenario.id,
        faultHistory: appendHistory(state.faultHistory, action.history),
      };
    case 'faultRecovered':
      return {
        ...state,
        activeFault: null,
        whiteScreen: false,
        faultHistory: appendHistory(state.faultHistory, action.history),
      };
    case 'faultFailed':
      return {
        ...state,
        activeFault:
          state.activeFault?.id === action.history.scenarioId
            ? null
            : state.activeFault,
        whiteScreen:
          state.activeFault?.id === action.history.scenarioId
            ? false
            : state.whiteScreen,
        faultHistory: appendHistory(state.faultHistory, action.history),
      };
  }
}
