import {
  DEFAULT_PRODUCT_ID,
  PRODUCTS,
  getProduct,
  getProductText,
  type StorefrontProduct,
} from './data';
import type {
  CheckoutMode,
  DemoUser,
  DetailTab,
  FaultHistoryItem,
  FaultScenario,
  StoreLanguage,
  StoreScreen,
  StoreSort,
} from './types';

export interface ToastState {
  tone: 'info' | 'success' | 'error';
  title: string;
  detail: string;
}

export interface AuthState {
  restored: boolean;
  busy: boolean;
  overlayOpen: boolean;
  user: DemoUser | null;
  personas: DemoUser[];
  pendingCheckout: CheckoutMode | null;
  error: string | null;
}

export interface StoreState {
  screen: StoreScreen;
  history: StoreScreen[];
  language: StoreLanguage;
  currentBookId: string;
  query: string;
  activeTopic: string;
  sort: StoreSort;
  detailTab: DetailTab;
  detailQuantity: number;
  cart: Record<string, number>;
  selectedCartIds: string[];
  visitorId: string;
  auth: AuthState;
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

export interface HydratedStoreState {
  language: StoreLanguage;
  currentBookId: string;
  activeTopic: string;
  sort: StoreSort;
  cart: Record<string, number>;
  selectedCartIds: string[];
  visitorId: string;
}

export type StoreAction =
  | {type: 'hydrate'; state: HydratedStoreState}
  | {type: 'navigate'; screen: StoreScreen}
  | {type: 'goBack'}
  | {type: 'openBook'; bookId: string}
  | {type: 'setLanguage'; language: StoreLanguage}
  | {type: 'setQuery'; query: string}
  | {type: 'setTopic'; topicId: string}
  | {type: 'setSort'; sort: StoreSort}
  | {type: 'setDetailTab'; tab: DetailTab}
  | {type: 'setDetailQuantity'; quantity: number}
  | {type: 'setCartQuantity'; bookId: string; quantity: number; select?: boolean}
  | {type: 'toggleCartSelection'; bookId: string}
  | {type: 'selectAllCart'; selected: boolean}
  | {type: 'removeSelectedCart'}
  | {type: 'completeCheckout'; items: {bookId: string; quantity: number}[]}
  | {
      type: 'setAuthSession';
      user: DemoUser | null;
      personas: DemoUser[];
      restored?: boolean;
    }
  | {type: 'setAuthBusy'; busy: boolean; error?: string | null}
  | {type: 'setAuthOverlay'; open: boolean; pending?: CheckoutMode | null}
  | {type: 'clearPendingCheckout'}
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
  history: ['home'],
  language: 'zh',
  currentBookId: DEFAULT_PRODUCT_ID,
  query: '',
  activeTopic: 'all',
  sort: 'recommended',
  detailTab: 'overview',
  detailQuantity: 1,
  cart: {[DEFAULT_PRODUCT_ID]: 1},
  selectedCartIds: [DEFAULT_PRODUCT_ID],
  visitorId: '',
  auth: {
    restored: false,
    busy: false,
    overlayOpen: false,
    user: null,
    personas: [],
    pendingCheckout: null,
    error: null,
  },
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

function validCart(cart: Record<string, number>): Record<string, number> {
  const productIds = new Set<string>(PRODUCTS.map(product => product.id));
  return Object.fromEntries(
    Object.entries(cart)
      .filter(([bookId, quantity]) =>
        productIds.has(bookId) && Number(quantity) > 0,
      )
      .map(([bookId, quantity]) => [
        bookId,
        Math.max(1, Math.min(99, Math.floor(Number(quantity)))),
      ]),
  );
}

export function storeReducer(
  state: StoreState,
  action: StoreAction,
): StoreState {
  switch (action.type) {
    case 'hydrate': {
      const cart = validCart(action.state.cart);
      return {
        ...state,
        language: action.state.language,
        currentBookId: getProduct(action.state.currentBookId).id,
        activeTopic: action.state.activeTopic,
        sort: action.state.sort,
        cart,
        selectedCartIds: action.state.selectedCartIds.filter(
          bookId => cart[bookId] > 0,
        ),
        visitorId: action.state.visitorId,
      };
    }
    case 'navigate':
      if (action.screen === state.screen) return state;
      return {
        ...state,
        screen: action.screen,
        history: [...state.history, action.screen].slice(-12),
      };
    case 'goBack': {
      if (state.history.length <= 1) return state;
      const history = state.history.slice(0, -1);
      return {...state, history, screen: history.at(-1) ?? 'home'};
    }
    case 'openBook':
      return {
        ...state,
        screen: 'detail',
        history:
          state.screen === 'detail'
            ? state.history
            : [...state.history, 'detail' as StoreScreen].slice(-12),
        currentBookId: getProduct(action.bookId).id,
        detailTab: 'overview',
        detailQuantity: 1,
      };
    case 'setLanguage':
      return {...state, language: action.language};
    case 'setQuery':
      return {...state, query: action.query};
    case 'setTopic':
      return {...state, activeTopic: action.topicId};
    case 'setSort':
      return {...state, sort: action.sort};
    case 'setDetailTab':
      return {...state, detailTab: action.tab};
    case 'setDetailQuantity':
      return {
        ...state,
        detailQuantity: Math.max(1, Math.min(99, action.quantity)),
      };
    case 'setCartQuantity': {
      const bookId = getProduct(action.bookId).id;
      const quantity = Math.max(0, Math.min(99, Math.floor(action.quantity)));
      const cart = {...state.cart};
      const selected = new Set(state.selectedCartIds);
      if (quantity > 0) {
        cart[bookId] = quantity;
        if (action.select !== false) selected.add(bookId);
      } else {
        delete cart[bookId];
        selected.delete(bookId);
      }
      return {...state, cart, selectedCartIds: [...selected]};
    }
    case 'toggleCartSelection': {
      if (!state.cart[action.bookId]) return state;
      const selected = new Set(state.selectedCartIds);
      if (selected.has(action.bookId)) selected.delete(action.bookId);
      else selected.add(action.bookId);
      return {...state, selectedCartIds: [...selected]};
    }
    case 'selectAllCart':
      return {
        ...state,
        selectedCartIds: action.selected ? Object.keys(state.cart) : [],
      };
    case 'removeSelectedCart': {
      const selected = new Set(state.selectedCartIds);
      return {
        ...state,
        cart: Object.fromEntries(
          Object.entries(state.cart).filter(([bookId]) => !selected.has(bookId)),
        ),
        selectedCartIds: [],
      };
    }
    case 'completeCheckout': {
      const cart = {...state.cart};
      for (const {bookId, quantity} of action.items) {
        const remaining = (cart[bookId] ?? 0) - quantity;
        if (remaining > 0) cart[bookId] = remaining;
        else delete cart[bookId];
      }
      return {
        ...state,
        cart,
        selectedCartIds: state.selectedCartIds.filter(bookId => cart[bookId] > 0),
      };
    }
    case 'setAuthSession':
      return {
        ...state,
        auth: {
          ...state.auth,
          restored: action.restored ?? true,
          busy: false,
          user: action.user,
          personas: action.personas,
          error: null,
        },
      };
    case 'setAuthBusy':
      return {
        ...state,
        auth: {
          ...state.auth,
          busy: action.busy,
          error: action.error === undefined ? state.auth.error : action.error,
        },
      };
    case 'setAuthOverlay':
      return {
        ...state,
        auth: {
          ...state.auth,
          overlayOpen: action.open,
          pendingCheckout:
            action.pending === undefined
              ? state.auth.pendingCheckout
              : action.pending,
          error: action.open ? null : state.auth.error,
        },
      };
    case 'clearPendingCheckout':
      return {
        ...state,
        auth: {...state.auth, pendingCheckout: null},
      };
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

export function visibleProducts(state: Pick<StoreState, 'query' | 'language' | 'activeTopic' | 'sort'>): StorefrontProduct[] {
  const query = state.query.trim().toLocaleLowerCase(
    state.language === 'en' ? 'en' : 'zh-CN',
  );
  return PRODUCTS.filter(product => {
    if (
      state.activeTopic !== 'all' &&
      !product.tags.some(tag => tag === state.activeTopic)
    ) {
      return false;
    }
    if (!query) return true;
    const current = getProductText(product, state.language);
    const alternate = getProductText(
      product,
      state.language === 'zh' ? 'en' : 'zh',
    );
    return [
      current.title,
      current.author,
      current.description,
      alternate.title,
      alternate.author,
      ...product.tags,
    ]
      .join(' ')
      .toLocaleLowerCase(state.language === 'en' ? 'en' : 'zh-CN')
      .includes(query);
  }).sort((left, right) => {
    if (state.sort === 'rating') {
      return right.rating - left.rating || left.rank - right.rank;
    }
    if (state.sort === 'price-asc') {
      return left.amountCent - right.amountCent || left.rank - right.rank;
    }
    return left.rank - right.rank;
  });
}

export interface CartLine {
  product: StorefrontProduct;
  quantity: number;
  selected: boolean;
  lineAmountCent: number;
}

type CartSelection = Pick<StoreState, 'cart' | 'selectedCartIds'>;

export function cartLines(state: CartSelection): CartLine[] {
  const selected = new Set(state.selectedCartIds);
  return Object.entries(state.cart)
    .filter(([, quantity]) => quantity > 0)
    .map(([bookId, quantity]) => {
      const product = getProduct(bookId);
      return {
        product,
        quantity,
        selected: selected.has(product.id),
        lineAmountCent: product.amountCent * quantity,
      };
    });
}

export function totalCartQuantity(state: Pick<StoreState, 'cart'>): number {
  return Object.values(state.cart).reduce((total, quantity) => quantity > 0 ? total + quantity : total, 0);
}

export function isInCart(state: StoreState, bookId: string): boolean {
  return Number(state.cart[bookId] ?? 0) > 0;
}

export function checkoutSnapshot(state: CartSelection & Pick<StoreState, 'language'>) {
  const selected = new Set(state.selectedCartIds);
  const lines = cartLines(state).filter(line => selected.has(line.product.id));
  const totalCopies = lines.reduce((total, line) => total + line.quantity, 0);
  const amountCent = lines.reduce(
    (total, line) => total + line.lineAmountCent,
    0,
  );
  return {
    lines,
    lineCount: lines.length,
    totalCopies,
    amountCent,
    bookIds: lines.map(line => line.product.id),
    titles: lines.map(line => getProductText(line.product, state.language).title),
    quantities: lines.map(line => line.quantity),
    productLabel: lines
      .map(line => getProductText(line.product, state.language).title)
      .join(' / '),
  };
}
