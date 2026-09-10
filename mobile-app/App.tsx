import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  BackHandler,
  PanResponder,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import {
  DemoApi,
  isUnauthorized,
  type DemoRequestMetadata,
} from './src/api';
import {AuthOverlay} from './src/components/AuthOverlay';
import {FaultDrawer, FaultToolbarButton} from './src/components/FaultDrawer';
import {ResultToast} from './src/components/ResultToast';
import {DetailFaultBoundary, withMissingDetailDescription} from './src/components/DetailFaultBoundary';
import {CheckoutPreview} from './src/components/CheckoutPreview';
import {StoreBottomNav, StoreHeader} from './src/components/StoreHeader';
import {androidRumBuildConfig, gatewayUrl} from './src/config';
import {
  BUSINESS_FAULT_IDS,
  blockCheckoutPreview,
  faultContext,
  faultRequestMetadata,
  isBusinessFault,
  localizeBusinessFault,
} from './src/businessFaults';
import {useBusinessFaults} from './src/useBusinessFaults';
import {useBookContent} from './src/useBookContent';
import {
  ORDER_BACKEND_SKU,
  getProduct,
  getProductText,
  storeText,
} from './src/data';
import {storefrontTokens} from './src/designTokens';
import {acknowledgeInteraction} from './src/interactionAck';
import {
  dangerousScenarioIds,
  filterFaultsForPlatform,
  findActiveServerFault,
  injectClientFault,
} from './src/faults';
import {
  action as rumAction,
  bindUser,
  initializeObservability,
  log,
  recordFaultEvent,
  startView,
  stopView,
} from './src/observability';
import {BagScreen} from './src/screens/BagScreen';
import {DetailScreen} from './src/screens/DetailScreen';
import {HomeScreen, type HomeScrollPosition} from './src/screens/HomeScreen';
import {ReadingPathScreen} from './src/screens/ReadingPathScreen';
import {
  cartLines,
  checkoutSnapshot,
  initialStoreState,
  isInCart,
  storeReducer,
  totalCartQuantity,
  visibleProducts,
  type ToastState,
  type StoreAction,
} from './src/store';
import {loadPersistedStore, persistStore} from './src/storage';
import {buildRumUrl, buildTraceUrl} from './src/traceLink';
import {useStableCallback} from './src/useStableCallback';
import type {
  CheckoutMode,
  DemoPublicConfig,
  FaultHistoryItem,
  FaultScenario,
  MobileRumConfig,
  OrderResult,
  StoreLanguage,
  StoreScreen,
  StoreSort,
} from './src/types';

const DEFAULT_MOBILE_CONFIG: MobileRumConfig = {
  enabled: false,
  applicationIds: {android: '', ios: ''},
  project: 'mall-demo',
  service: 'mall-mobile',
  env: 'demo',
  version: '1.0.0',
  datakitPath: '/rum-proxy',
  sampleRates: {session: 1, sessionOnError: 1, trace: 1, replay: 1},
  sessionReplayEnabled: true,
  traceType: 'ddtrace',
};

const VIEW_NAMES: Record<StoreScreen, string> = {
  home: 'storefront/home',
  path: 'storefront/path',
  detail: 'storefront/detail',
  cart: 'storefront/cart',
};

function runSilently(promise: Promise<unknown>): void {
  promise.catch(() => undefined);
}

function confirmPress(actionName: string, operation: () => void): void {
  operation();
  acknowledgeInteraction(actionName);
}

function App() {
  return (
    <SafeAreaProvider>
      <Storefront />
    </SafeAreaProvider>
  );
}

function Storefront() {
  const insets = useSafeAreaInsets();
  const [state, dispatch] = useReducer(storeReducer, initialStoreState);
  const [hydrated, setHydrated] = useState(false);
  const [faults, setFaults] = useState<FaultScenario[]>([]);
  const [rumConfig, setRumConfig] = useState(DEFAULT_MOBILE_CONFIG);
  const [publicConfig, setPublicConfig] = useState<DemoPublicConfig>({
    project: 'mall-demo',
  });
  const [traceId, setTraceId] = useState('');
  const [frozenAmountCent, setFrozenAmountCent] = useState<number | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [faultBusy, setFaultBusy] = useState(false);
  const faultTransition = useRef(false);
  const bookNavigation = useRef(0);
  const homeScrollPosition = useRef<HomeScrollPosition>({key: '', y: 0});
  const api = useMemo(() => new DemoApi(gatewayUrl), []);
  const businessFault = useBusinessFaults();
  const bookContent = useBookContent(api, rumConfig.project);
  const tokens = storefrontTokens;

  const metadata = useMemo<DemoRequestMetadata>(
    () => ({language: state.language, visitorId: state.visitorId}),
    [state.language, state.visitorId],
  );
  const products = useMemo(() => visibleProducts({
    language: state.language, query: state.query, activeTopic: state.activeTopic, sort: state.sort,
  }), [state.language, state.query, state.activeTopic, state.sort]);
  const cartSelection = useMemo(() => ({cart: state.cart, selectedCartIds: state.selectedCartIds}),
    [state.cart, state.selectedCartIds]);
  const lines = useMemo(() => cartLines(cartSelection), [cartSelection]);
  const checkout = useMemo(() => checkoutSnapshot({...cartSelection, language: state.language}), [cartSelection, state.language]);
  const cartQuantity = useMemo(() => totalCartQuantity({cart: state.cart}), [state.cart]);
  const currentProduct = getProduct(state.currentBookId);

  const showToast = useCallback((toast: ToastState) => {
    dispatch({type: 'showToast', toast});
  }, []);
  const dismissToast = useCallback(() => dispatch({type: 'hideToast'}), []);

  const applyFaultCatalog = useCallback((catalog: Awaited<ReturnType<DemoApi['getFaultCatalog']>>, language: StoreLanguage = 'zh') => {
    const platform = Platform.OS === 'ios' ? 'ios' : 'android';
    const platformFaults = filterFaultsForPlatform(catalog.items, platform)
      .map(scenario => localizeBusinessFault(scenario, language));
    setFaults(platformFaults);
    const activeServerFault = findActiveServerFault(platformFaults, catalog.active);
    if (activeServerFault) {
      dispatch({type: 'restoreActiveFault', scenario: activeServerFault});
    } else if (platformFaults[0]) {
      dispatch({type: 'selectFault', scenarioId: platformFaults[0].id});
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      const persisted = await loadPersistedStore();
      if (cancelled) return;
      const requestMetadata: DemoRequestMetadata = {
        language: persisted.language,
        visitorId: persisted.visitorId,
      };
      dispatch({type: 'hydrate', state: persisted});
      setHydrated(true);

      const [mobileResult, publicResult, catalogResult, authResult] =
        await Promise.allSettled([
          api.getMobileConfig(),
          api.getPublicConfig(),
          api.getFaultCatalog(requestMetadata),
          api.getAuthSession(requestMetadata),
        ]);
      if (cancelled) return;
      if (publicResult.status === 'fulfilled') setPublicConfig(publicResult.value);
      if (catalogResult.status === 'fulfilled') applyFaultCatalog(catalogResult.value, persisted.language);

      let initialized = false;
      if (mobileResult.status === 'fulfilled') {
        setRumConfig(mobileResult.value);
        try {
          initialized = await initializeObservability(mobileResult.value, gatewayUrl);
        } catch (error) {
          showToast({
            tone: 'error',
            title: nativeText(persisted.language, 'rumFailed'),
            detail: errorMessage(error),
          });
        }
      }

      if (authResult.status === 'fulfilled') {
        const session = authResult.value;
        dispatch({
          type: 'setAuthSession',
          user: session.authenticated ? session.user : null,
          personas: session.personas,
          restored: true,
        });
        if (initialized) {
          await bindUser(
            session.authenticated ? session.user : null,
            persisted.visitorId,
          );
        }
      } else {
        dispatch({type: 'setAuthSession', user: null, personas: [], restored: true});
      }
      startView(VIEW_NAMES.home, {
        screen: 'home',
        language: persisted.language,
        visitor_id: persisted.visitorId,
      });
    }
    runSilently(bootstrap());
    return () => {
      cancelled = true;
    };
  }, [api, applyFaultCatalog, showToast]);

  useEffect(() => {
    if (!hydrated) return;
    runSilently(
      persistStore({
        language: state.language,
        currentBookId: state.currentBookId,
        activeTopic: state.activeTopic,
        sort: state.sort,
        cart: state.cart,
        selectedCartIds: state.selectedCartIds,
        visitorId: state.visitorId,
      }),
    );
  }, [
    hydrated,
    state.activeTopic,
    state.cart,
    state.currentBookId,
    state.language,
    state.selectedCartIds,
    state.sort,
    state.visitorId,
  ]);

  useEffect(() => {
    if (!hydrated) return;
    stopView({reason: 'navigation'});
    startView(VIEW_NAMES[state.screen], {
      screen: state.screen,
      language: state.language,
      book_id: state.screen === 'detail' ? state.currentBookId : undefined,
      visitor_id: state.visitorId,
      auth_state: state.auth.user ? 'authenticated' : 'anonymous',
      user_tier: state.auth.user?.tier,
    });
  }, [
    hydrated,
    state.auth.user,
    state.currentBookId,
    state.language,
    state.screen,
    state.visitorId,
  ]);

  const navigate = useCallback(
    (screen: StoreScreen) => {
      if (screen === state.screen) return;
      bookNavigation.current += 1;
      bookContent.cancel();
      setPreviewOpen(false);
      rumAction('business_navigate_bookstore', {
        from_page: state.screen,
        to_page: screen,
        language: state.language,
      });
      dispatch({type: 'navigate', screen});
    },
    [bookContent, state.language, state.screen],
  );

  const goBack = useCallback(() => {
    bookNavigation.current += 1;
    bookContent.cancel();
    if (state.history.at(-2) === 'detail') {
      runSilently(bookContent.load(state.currentBookId, faultRequestMetadata(metadata, businessFault.current.current)));
    }
    rumAction('mobile_swipe_back', {from_page: state.screen});
    dispatch({type: 'goBack'});
  }, [bookContent, businessFault, metadata, state.currentBookId, state.history, state.screen]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (previewOpen) {
        setPreviewOpen(false);
        return true;
      }
      if (state.auth.overlayOpen) {
        dispatch({type: 'setAuthOverlay', open: false, pending: null});
        return true;
      }
      if (state.drawerOpen) {
        dispatch({type: 'setDrawer', open: false});
        return true;
      }
      if (state.history.length > 1) {
        goBack();
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [goBack, previewOpen, state.auth.overlayOpen, state.drawerOpen, state.history.length]);

  const swipeBack = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (event, gesture) =>
          !state.drawerOpen &&
          !state.auth.overlayOpen &&
          !previewOpen &&
          state.history.length > 1 &&
          event.nativeEvent.pageX - gesture.dx <= 24 &&
          gesture.dx > 16 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx > 72 || gesture.vx > 0.7) goBack();
        },
      }),
    [goBack, previewOpen, state.auth.overlayOpen, state.drawerOpen, state.history.length],
  );

  const changeLanguage = useCallback(() => {
    const language: StoreLanguage = state.language === 'zh' ? 'en' : 'zh';
    rumAction('storefront_change_language', {from: state.language, to: language});
    dispatch({type: 'setLanguage', language});
    bookNavigation.current += 1;
    bookContent.cancel();
    if (state.screen === 'detail') {
      runSilently(bookContent.load(state.currentBookId, faultRequestMetadata({...metadata, language}, businessFault.current.current)));
    }
    runSilently(
      api
        .getFaultCatalog({language, visitorId: state.visitorId})
        .then(catalog => applyFaultCatalog(catalog, language)),
    );
  }, [api, applyFaultCatalog, bookContent, businessFault, metadata, state.currentBookId, state.language, state.screen, state.visitorId]);

  const openBook = useCallback(
    async (bookId: string) => {
      const navigation = ++bookNavigation.current;
      const product = getProduct(bookId);
      bookContent.cancel();
      const triggerId = [BUSINESS_FAULT_IDS.detail, BUSINESS_FAULT_IDS.slow, BUSINESS_FAULT_IDS.timeout]
        .find(id => businessFault.enabled(id));
      if (triggerId) await businessFault.trigger(triggerId, {book_id: product.id});
      if (navigation !== bookNavigation.current) return;
      rumAction('business_view_book_detail', {
        book_id: product.id,
        book_title: getProductText(product, state.language).title,
      });
      dispatch({type: 'openBook', bookId});
      const mode = businessFault.enabled(BUSINESS_FAULT_IDS.slow) ? 'slow'
        : businessFault.enabled(BUSINESS_FAULT_IDS.timeout) ? 'timeout' : 'normal';
      runSilently(bookContent.load(product.id, faultRequestMetadata(metadata, businessFault.current.current), mode));
    },
    [bookContent, businessFault, metadata, state.language],
  );

  const addBook = useCallback(
    async (bookId: string, quantity = 1) => {
      const product = getProduct(bookId);
      const text = getProductText(product, state.language);
      const nextQuantity = Math.max(Number(state.cart[bookId] ?? 0), quantity);
      if (nextQuantity > Number(state.cart[bookId] ?? 0) && businessFault.enabled(BUSINESS_FAULT_IDS.addCart)) {
        const run = await businessFault.trigger(BUSINESS_FAULT_IDS.addCart, {book_id: bookId});
        if (run) {
          rumAction('business_add_book_to_bag', {book_id: bookId, quantity: nextQuantity});
          recordFaultEvent('cart_update_missing', {...faultContext(run), book_id: bookId,
            previous_quantity: Number(state.cart[bookId] ?? 0), expected_quantity: nextQuantity,
            actual_quantity: Number(state.cart[bookId] ?? 0), validation: 'state_update_missing'});
          return false;
        }
      }
      dispatch({type: 'setCartQuantity', bookId, quantity: nextQuantity});
      rumAction('business_add_book_to_bag', {
        product: text.title,
        book_id: product.id,
        quantity: nextQuantity,
      });
      showToast({
        tone: 'success',
        title: storeText(state.language, 'added', {title: text.title}),
        detail: `${text.title} · ${storeText(state.language, 'copies', {count: nextQuantity})}`,
      });
      recordFaultEvent('cart_update_succeeded', {book_id: bookId, actual_quantity: nextQuantity});
      return true;
    },
    [businessFault, showToast, state.cart, state.language],
  );

  const applyCartChange = useCallback(async (change: StoreAction) => {
    const next = storeReducer(state, change);
    const nextCheckout = checkoutSnapshot(next);
    if (businessFault.enabled(BUSINESS_FAULT_IDS.cartTotal)
      && checkout.amountCent !== nextCheckout.amountCent && nextCheckout.totalCopies > 0) {
      const run = await businessFault.trigger(BUSINESS_FAULT_IDS.cartTotal);
      if (run) {
        const shown = frozenAmountCent ?? checkout.amountCent;
        setFrozenAmountCent(shown);
        recordFaultEvent('cart_total_mismatch', {...faultContext(run),
          expected_amount_cent: nextCheckout.amountCent, displayed_amount_cent: shown,
          selected_copies: nextCheckout.totalCopies, validation: 'stale_derived_state'});
      }
    }
    dispatch(change);
  }, [businessFault, checkout.amountCent, frozenAmountCent, state]);

  const updateCartQuantity = useCallback(
    (bookId: string, quantity: number) => {
      const previous = Number(state.cart[bookId] ?? 0);
      runSilently(applyCartChange({type: 'setCartQuantity', bookId, quantity}));
      const product = getProduct(bookId);
      rumAction(
        quantity > previous
          ? 'business_add_book_to_bag'
          : 'business_remove_book_from_bag',
        {book_id: product.id, previous_quantity: previous, quantity},
      );
    },
    [applyCartChange, state.cart],
  );

  const lookupTrace = useCallback(
    async (result: OrderResult) => {
      const requestId = typeof result.businessRequestId === 'string' ? result.businessRequestId : '';
      const orderId = typeof result.orderId === 'string' ? result.orderId : '';
      if (!requestId) return;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await delay(attempt === 0 ? 350 : 500);
        try {
          const lookup = await api.findTrace(requestId, orderId, metadata);
          const found = lookup.traceId ?? lookup.traceIds?.[0] ?? '';
          if (found) {
            setTraceId(found);
            return;
          }
        } catch {
          // Logs can arrive after the order response; retry briefly for the demo.
        }
      }
    },
    [api, metadata],
  );

  const executeCheckout = useCallback(
    async (mode: CheckoutMode, authenticated = Boolean(state.auth.user)) => {
      if (checkout.totalCopies < 1 || checkout.amountCent < 1) return;
      if (frozenAmountCent !== null && frozenAmountCent !== checkout.amountCent) {
        showToast({tone: 'error', title: state.language === 'en' ? 'Review your cart total' : '请先核对购物车金额',
          detail: state.language === 'en' ? 'Reload the total before placing an order.' : '重新计算合计后再提交订单。'});
        return;
      }
      if (!authenticated) {
        rumAction('auth_login_prompt', {trigger: mode, visitor_id: state.visitorId});
        dispatch({type: 'setAuthOverlay', open: true, pending: mode});
        return;
      }
      const order = {
        sku: ORDER_BACKEND_SKU,
        quantity: checkout.totalCopies,
        amountCent: checkout.amountCent,
      };
      rumAction(mode === 'single' ? 'business_submit_book_order' : 'run_book_purchase_traffic', {
        book_ids: checkout.bookIds,
        book_titles: checkout.titles,
        book_quantities: checkout.quantities,
        cart_line_count: checkout.lineCount,
        cart_total_copies: checkout.totalCopies,
        cart_amount_cent: checkout.amountCent,
        total: mode === 'traffic' ? 5 : 1,
      });
      dispatch({
        type: 'setLoading',
        loading: true,
        title: nativeText(state.language, mode === 'single' ? 'submitting' : 'batchSubmitting'),
        detail: nativeText(state.language, mode === 'single' ? 'submittingDetail' : 'batchDetail'),
      });
      try {
        const results =
          mode === 'single'
            ? [await api.purchase(rumConfig.project, order, metadata)]
            : await api.runPurchaseTraffic(rumConfig.project, order, 5, metadata);
        if (mode === 'single') {
          // Apply the submitted snapshot, not a selection changed while awaiting the API.
          dispatch({
            type: 'completeCheckout',
            items: checkout.lines.map(({product, quantity}) => ({bookId: product.id, quantity})),
          });
        }
        const last = results.at(-1);
        showToast({
          tone: 'success',
          title: nativeText(state.language, mode === 'single' ? 'purchaseSuccess' : 'batchSuccess'),
          detail:
            mode === 'single' && last?.orderId
              ? nativeText(state.language, 'orderConfirmed', {
                  orderId: String(last.orderId).slice(-10),
                })
              : nativeText(state.language, 'batchCompleted', {count: results.length}),
        });
        if (last) runSilently(lookupTrace(last));
      } catch (error) {
        if (isUnauthorized(error)) {
          dispatch({type: 'setAuthSession', user: null, personas: state.auth.personas});
          dispatch({type: 'setAuthOverlay', open: true, pending: mode});
          await bindUser(null, state.visitorId);
          showToast({
            tone: 'error',
            title: nativeText(state.language, 'sessionExpired'),
            detail: storeText(state.language, 'authSessionExpired'),
          });
        } else {
          showToast({
            tone: 'error',
            title: nativeText(state.language, 'purchaseFailed'),
            detail: errorMessage(error),
          });
        }
      } finally {
        dispatch({type: 'setLoading', loading: false});
      }
    },
    [
      api,
      checkout,
      frozenAmountCent,
      lookupTrace,
      metadata,
      rumConfig.project,
      showToast,
      state.auth.personas,
      state.auth.user,
      state.language,
      state.visitorId,
    ],
  );

  const login = useCallback(
    async (userId: string) => {
      dispatch({type: 'setAuthBusy', busy: true, error: null});
      try {
        const session = await api.login(userId, rumConfig.project, metadata);
        const user = session.authenticated ? session.user : null;
        dispatch({type: 'setAuthSession', user, personas: session.personas});
        await bindUser(user, state.visitorId);
        if (user) {
          rumAction('auth_login_success', {
            user_id: user.id,
            user_tier: user.tier,
            visitor_id: state.visitorId,
          });
          runSilently(
            log(storeText(state.language, 'authLogSuccess', {name: user.name}), undefined, {
              operation: 'auth_login_success',
              user_id: user.id,
              user_tier: user.tier,
            }),
          );
        }
        const pending = state.auth.pendingCheckout;
        dispatch({type: 'setAuthOverlay', open: false, pending: null});
        if (pending) await executeCheckout(pending, true);
      } catch (error) {
        rumAction('auth_login_failure', {reason: errorMessage(error)});
        dispatch({type: 'setAuthBusy', busy: false, error: errorMessage(error)});
      }
    },
    [api, executeCheckout, metadata, rumConfig.project, state.auth.pendingCheckout, state.language, state.visitorId],
  );

  const logout = useCallback(async () => {
    const user = state.auth.user;
    if (!user) return;
    dispatch({type: 'setAuthBusy', busy: true, error: null});
    try {
      await api.logout(rumConfig.project, metadata);
      await bindUser(null, state.visitorId);
      dispatch({type: 'setAuthSession', user: null, personas: state.auth.personas});
      dispatch({type: 'setAuthOverlay', open: false, pending: null});
      rumAction('auth_logout', {user_id: user.id, user_tier: user.tier});
    } catch (error) {
      dispatch({type: 'setAuthBusy', busy: false, error: errorMessage(error)});
    }
  }, [api, metadata, rumConfig.project, state.auth.personas, state.auth.user, state.visitorId]);

  const recoverLocalFault = useCallback(async (reason: string, expectedRunId?: string, properties: object = {}) => {
    const active = businessFault.current.current;
    if (!active || (expectedRunId && active.id !== expectedRunId)) return;
    bookNavigation.current += 1;
    bookContent.cancel();
    setFrozenAmountCent(null);
    await businessFault.recover(reason, properties);
    if (businessFault.current.current?.id !== active.id) return;
    const scenario = faults.find(item => item.id === active.scenarioId);
    if (scenario) dispatch({type: 'faultRecovered', history: historyItem(scenario, 'recovered')});
  }, [bookContent, businessFault, faults]);

  const retryBookContent = useCallback(async () => {
    await recoverLocalFault('content_retry');
    runSilently(bookContent.load(state.currentBookId, faultRequestMetadata(metadata, businessFault.current.current)));
  }, [bookContent, businessFault, metadata, recoverLocalFault, state.currentBookId]);

  const openCheckoutPreview = useCallback(async () => {
    if (checkout.totalCopies < 1 || previewOpen) return;
    setPreviewOpen(true);
    const run = await businessFault.trigger(BUSINESS_FAULT_IDS.uiBlock);
    rumAction('business_preview_checkout', {selected_copies: checkout.totalCopies});
    if (!run) return;
    // Commit a normal, replayable native view before occupying the UI thread.
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    if (businessFault.current.current?.id !== run.id || businessFault.current.current.phase !== 'triggered') return;
    try {
      const durationMs = await blockCheckoutPreview();
      recordFaultEvent('checkout_preview_resumed', {...faultContext(run), blocked_duration_ms: durationMs});
      await recoverLocalFault('native_block_finished', run.id, {blocked_duration_ms: durationMs});
    } catch (error) {
      await recoverLocalFault('native_block_unavailable', run.id);
      showToast({tone: 'error', title: state.language === 'en' ? 'Preview demonstration unavailable' : '暂时无法演示卡顿', detail: errorMessage(error)});
    }
  }, [businessFault, checkout.totalCopies, previewOpen, recoverLocalFault, showToast, state.language]);

  const activateFault = useCallback(
    async (scenario: FaultScenario) => {
      if (faultTransition.current) return;
      faultTransition.current = true;
      setFaultBusy(true);
      try {
        bookNavigation.current += 1;
        bookContent.cancel();
        setFrozenAmountCent(null);
        setPreviewOpen(false);
        if (isBusinessFault(scenario.id)) {
          if (state.activeFault?.execution === 'server') await api.recoverFaults(metadata);
          await businessFault.recover('switch_scenario');
          await businessFault.arm(scenario);
          dispatch({type: 'faultActivated', scenario, history: historyItem(scenario, 'active')});
          dispatch({type: 'setDrawer', open: false});
          showToast({tone: 'info', title: state.language === 'en' ? 'Scenario ready' : '场景已就绪', detail: scenario.description});
          return;
        }
        await businessFault.clearContext();
        dispatch({type: 'faultActivated', scenario, history: historyItem(scenario, 'active')});
        if (scenario.execution === 'client') {
          await injectClientFault(scenario, {
            api,
            project: rumConfig.project,
            setWhiteScreen: active => dispatch({type: 'setWhiteScreen', active}),
          });
        } else {
          await api.enableServerFault(scenario.id, metadata);
        }
        showToast({
          tone: 'info',
          title: nativeText(state.language, 'faultInjected', {title: scenario.title}),
          detail: scenario.expectedObservation,
        });
      } catch (error) {
        dispatch({
          type: 'faultFailed',
          history: historyItem(scenario, 'failed', errorMessage(error)),
        });
        showToast({
          tone: 'error',
          title: nativeText(state.language, 'faultFailed'),
          detail: errorMessage(error),
        });
      } finally {
        faultTransition.current = false;
        setFaultBusy(false);
      }
    },
    [api, bookContent, businessFault, metadata, rumConfig.project, showToast, state.activeFault, state.language],
  );

  const injectFault = useCallback(
    (scenario: FaultScenario) => {
      rumAction('mobile_inject_fault', {fault_id: scenario.id});
      if (dangerousScenarioIds.has(scenario.id)) {
        Alert.alert(
          nativeText(state.language, 'confirmFault', {title: scenario.title}),
          nativeText(state.language, 'dangerousFault'),
          [
            {text: nativeText(state.language, 'cancel'), style: 'cancel'},
            {
              text: nativeText(state.language, 'continue'),
              style: 'destructive',
              onPress: () => runSilently(activateFault(scenario)),
            },
          ],
        );
        return;
      }
      runSilently(activateFault(scenario));
    },
    [activateFault, state.language],
  );

  const recoverFaults = useCallback(async () => {
    const recovering = state.activeFault;
    if (recovering && isBusinessFault(recovering.id)) {
      await recoverLocalFault('manual');
      if (state.screen === 'detail') runSilently(bookContent.load(state.currentBookId, faultRequestMetadata(metadata, businessFault.current.current)));
      showToast({tone: 'success', title: state.language === 'en' ? 'Baseline restored' : '已恢复基线', detail: state.language === 'en' ? 'Repeat the same action to compare the result.' : '可重复刚才的操作，对比恢复后的表现。'});
      return;
    }
    dispatch({
      type: 'setLoading',
      loading: true,
      title: nativeText(state.language, 'recovering'),
      detail: nativeText(state.language, 'recoveringDetail'),
    });
    try {
      await api.recoverFaults(metadata);
      dispatch({
        type: 'faultRecovered',
        history: recovering
          ? historyItem(recovering, 'recovered')
          : {
              id: `recover-${Date.now()}`,
              scenarioId: 'all',
              title: nativeText(state.language, 'recoverAll'),
              status: 'recovered',
              timestamp: new Date().toISOString(),
            },
      });
      showToast({
        tone: 'success',
        title: nativeText(state.language, 'recovered'),
        detail: nativeText(state.language, 'recoveredDetail'),
      });
    } catch (error) {
      showToast({
        tone: 'error',
        title: nativeText(state.language, 'recoverFailed'),
        detail: errorMessage(error),
      });
    } finally {
      dispatch({type: 'setLoading', loading: false});
    }
  }, [api, bookContent, businessFault, metadata, recoverLocalFault, showToast, state.activeFault, state.currentBookId, state.language, state.screen]);

  const traceUrl = buildTraceUrl(traceId, publicConfig);
  const rumAppId = Platform.OS === 'android' ? androidRumBuildConfig?.appId || rumConfig.applicationIds.android : rumConfig.applicationIds.ios;
  const rumUrl = buildRumUrl(businessFault.run, rumAppId, publicConfig);
  const detailFaulted = businessFault.run?.scenarioId === BUSINESS_FAULT_IDS.detail && businessFault.run.phase === 'triggered';
  const traceHint = traceId
    ? `trace_id=${shortId(traceId)}`
    : nativeText(state.language, 'traceHint');

  const onHomeTopicChange = useCallback((topicId: string) => {
    confirmPress(`filter_topic:${topicId}`, () => {
      rumAction('storefront_filter_topic', {topic_id: topicId});
      dispatch({type: 'setTopic', topicId});
    });
  }, []);
  const onHomeSortChange = useCallback((sort: StoreSort) => {
    confirmPress(`sort_catalog:${sort}`, () => {
      rumAction('storefront_sort_catalog', {sort});
      dispatch({type: 'setSort', sort});
    });
  }, []);
  const onOpenBook = useStableCallback((bookId: string) =>
    confirmPress(`open_book:${bookId}`, () => runSilently(openBook(bookId))));
  const onAddBook = useStableCallback((bookId: string) =>
    confirmPress(`add_book:${bookId}`, () => runSilently(addBook(bookId))));

  if (state.whiteScreen) {
    return (
      <View testID="white-screen" style={styles.whiteScreen}>
        <StatusBar hidden />
      </View>
    );
  }

  return (
    <SafeAreaView
      edges={
        Platform.OS === 'android'
          ? ['top', 'left', 'right']
          : ['top', 'left', 'right', 'bottom']
      }
      style={[styles.root, {backgroundColor: tokens.colors.surface}]}
      {...swipeBack.panHandlers}>
      <StatusBar
        animated={false}
        backgroundColor={tokens.colors.surface}
        barStyle="dark-content"
      />
      <StoreHeader
        tokens={tokens}
        language={state.language}
        query={state.query}
        user={state.auth.user}
        faultControl={
          <FaultToolbarButton
            tokens={tokens}
            language={state.language}
            activeFault={state.activeFault}
            onPress={() =>
              confirmPress('open_fault_drawer', () => {
                rumAction('mobile_open_fault_drawer');
                dispatch({type: 'setDrawer', open: true});
              })
            }
          />
        }
        onQueryChange={query => dispatch({type: 'setQuery', query})}
        onToggleLanguage={() =>
          confirmPress('switch_language', changeLanguage)
        }
        onAccount={() =>
          confirmPress('open_account', () => {
            rumAction('auth_login_prompt', {trigger: 'account'});
            dispatch({type: 'setAuthOverlay', open: true});
          })
        }
      />
      <View style={[styles.screen, {backgroundColor: tokens.colors.background}]}>
        {state.screen === 'home' && (
          <HomeScreen
            query={state.query}
            scrollPosition={homeScrollPosition}
            tokens={tokens}
            language={state.language}
            products={products}
            activeTopic={state.activeTopic}
            sort={state.sort}
            cart={state.cart}
            onTopicChange={onHomeTopicChange}
            onSortChange={onHomeSortChange}
            onOpenBook={onOpenBook}
            onAddBook={onAddBook}
          />
        )}
        {state.screen === 'path' && (
          <ReadingPathScreen
            tokens={tokens}
            language={state.language}
            onOpenBook={bookId =>
              confirmPress(`open_book:${bookId}`, () => runSilently(openBook(bookId)))
            }
          />
        )}
        {state.screen === 'detail' && (
          <DetailFaultBoundary
            key={`${currentProduct.id}:${businessFault.run?.id ?? 'baseline'}:${detailFaulted}`}
            tokens={tokens}
            language={state.language}
            onBack={goBack}
            onRetry={() => runSilently(retryBookContent())}
            onError={(error, componentStack) => recordFaultEvent('book_detail_render_failed', {
              ...(businessFault.run ? faultContext(businessFault.run) : {}),
              book_id: currentProduct.id, error_type: error.name, error_message: error.message,
              js_stack: error.stack ?? '', component_stack: componentStack,
            })}>
          <DetailScreen
            tokens={tokens}
            language={state.language}
            product={detailFaulted ? withMissingDetailDescription(currentProduct, state.language) : currentProduct}
            content={bookContent.state}
            onContentRetry={() => runSilently(retryBookContent())}
            tab={state.detailTab}
            quantity={state.detailQuantity}
            inCart={isInCart(state, currentProduct.id)}
            onBack={() => confirmPress('detail_back', goBack)}
            onTabChange={tab =>
              confirmPress(`detail_tab:${tab}`, () => {
                rumAction('business_view_book_detail_tab', {
                  book_id: currentProduct.id,
                  tab,
                });
                dispatch({type: 'setDetailTab', tab});
              })
            }
            onQuantityChange={quantity =>
              confirmPress('detail_quantity', () =>
                dispatch({type: 'setDetailQuantity', quantity}),
              )
            }
            onAdd={() =>
              confirmPress(`add_book:${currentProduct.id}`, () =>
                runSilently(addBook(currentProduct.id, state.detailQuantity)),
              )
            }
            onBuy={() =>
              confirmPress(`buy_now:${currentProduct.id}`, () => {
                runSilently(addBook(currentProduct.id, state.detailQuantity).then(added => {
                  if (added) navigate('cart');
                }));
              })
            }
          />
          </DetailFaultBoundary>
        )}
        {state.screen === 'cart' && (
          <BagScreen
            tokens={tokens}
            language={state.language}
            lines={lines}
            selectedCopies={checkout.totalCopies}
            amountCent={frozenAmountCent ?? checkout.amountCent}
            checkoutBlocked={frozenAmountCent !== null && frozenAmountCent !== checkout.amountCent}
            onRefreshTotal={() => runSilently(recoverLocalFault('cart_recalculate'))}
            onPreview={() => confirmPress('checkout_preview', () => runSilently(openCheckoutPreview()))}
            busy={state.loading}
            onBrowse={() =>
              confirmPress('cart_browse', () => navigate('home'))
            }
            onOpenBook={bookId =>
              confirmPress(`open_book:${bookId}`, () => runSilently(openBook(bookId)))
            }
            onToggleSelection={bookId =>
              confirmPress(`cart_toggle:${bookId}`, () =>
                runSilently(applyCartChange({type: 'toggleCartSelection', bookId})),
              )
            }
            onSelectAll={selected =>
              confirmPress('cart_select_all', () =>
                runSilently(applyCartChange({type: 'selectAllCart', selected})),
              )
            }
            onRemoveSelected={() =>
              confirmPress('cart_remove_selected', () =>
                runSilently(applyCartChange({type: 'removeSelectedCart'})),
              )
            }
            onQuantityChange={(bookId, quantity) =>
              confirmPress(`cart_quantity:${bookId}`, () =>
                updateCartQuantity(bookId, quantity),
              )
            }
            onRemove={bookId =>
              confirmPress(`cart_remove:${bookId}`, () =>
                updateCartQuantity(bookId, 0),
              )
            }
            onPurchase={() =>
              confirmPress('checkout', () =>
                runSilently(executeCheckout('single')),
              )
            }
            onBatchPurchase={() =>
              confirmPress('batch_purchase', () =>
                runSilently(executeCheckout('traffic')),
              )
            }
          />
        )}
      </View>
      <StoreBottomNav
        tokens={tokens}
        language={state.language}
        screen={state.screen}
        cartQuantity={cartQuantity}
        onNavigate={screen =>
          confirmPress(`navigate:${screen}`, () => navigate(screen))
        }
      />

      <FaultDrawer
        visible={state.drawerOpen}
        tokens={tokens}
        language={state.language}
        scenarios={faults}
        selectedScenarioId={state.selectedFaultId}
        activeFault={state.activeFault}
        history={state.faultHistory}
        busy={state.loading || faultBusy}
        run={businessFault.run}
        rumUrl={rumUrl}
        replayUrl={rumConfig.sessionReplayEnabled ? rumUrl : ''}
        traceUrl={traceUrl}
        traceHint={traceHint}
        onClose={() =>
          confirmPress('close_fault_drawer', () =>
            dispatch({type: 'setDrawer', open: false}),
          )
        }
        onSelect={scenarioId =>
          confirmPress(`select_fault:${scenarioId}`, () =>
            dispatch({type: 'selectFault', scenarioId}),
          )
        }
        onInject={scenario =>
          confirmPress(`inject_fault:${scenario.id}`, () => injectFault(scenario))
        }
        onRecover={() =>
          confirmPress('recover_faults', () => runSilently(recoverFaults()))
        }
      />

      <CheckoutPreview
        visible={previewOpen}
        tokens={tokens}
        language={state.language}
        lines={checkout.lines}
        amountCent={checkout.amountCent}
        onClose={() => setPreviewOpen(false)}
      />

      <AuthOverlay
        visible={state.auth.overlayOpen}
        tokens={tokens}
        language={state.language}
        user={state.auth.user}
        personas={state.auth.personas}
        busy={state.auth.busy}
        error={state.auth.error}
        onClose={() =>
          confirmPress('close_auth', () =>
            dispatch({type: 'setAuthOverlay', open: false, pending: null}),
          )
        }
        onLogin={userId =>
          confirmPress(`login:${userId}`, () => runSilently(login(userId)))
        }
        onLogout={() =>
          confirmPress('logout', () => runSilently(logout()))
        }
      />

      {state.loading && (
        <View testID="loading-overlay" style={[styles.overlay, {backgroundColor: tokens.colors.overlay}]}>
          <View style={[styles.loadingCard, {backgroundColor: tokens.colors.surface, borderColor: tokens.colors.line}]}>
            <View style={[styles.spinner, {borderColor: tokens.colors.line, borderTopColor: tokens.colors.accent}]} />
            <Text style={[styles.loadingTitle, {color: tokens.colors.text}]}>{state.loadingTitle}</Text>
            <Text style={[styles.loadingDetail, {color: tokens.colors.muted}]}>{state.loadingDetail}</Text>
          </View>
        </View>
      )}
      {state.toast && (
        <ResultToast
          toast={state.toast}
          tokens={tokens}
          topInset={insets.top}
          onDismiss={dismissToast}
        />
      )}
    </SafeAreaView>
  );
}

type NativeMessageKey =
  | 'rumFailed'
  | 'submitting'
  | 'submittingDetail'
  | 'batchSubmitting'
  | 'batchDetail'
  | 'purchaseSuccess'
  | 'batchSuccess'
  | 'orderConfirmed'
  | 'batchCompleted'
  | 'purchaseFailed'
  | 'sessionExpired'
  | 'faultInjected'
  | 'faultFailed'
  | 'confirmFault'
  | 'dangerousFault'
  | 'cancel'
  | 'continue'
  | 'recovering'
  | 'recoveringDetail'
  | 'recoverAll'
  | 'recovered'
  | 'recoveredDetail'
  | 'recoverFailed'
  | 'traceHint';

const NATIVE_MESSAGES: Record<StoreLanguage, Record<NativeMessageKey, string>> = {
  zh: {
    rumFailed: 'RUM 初始化失败',
    submitting: '正在提交订单',
    submittingDetail: '正在关联库存、支付与后端 Trace…',
    batchSubmitting: '正在生成演示流量',
    batchDetail: '连续创建 5 条购书业务链路…',
    purchaseSuccess: '购买成功',
    batchSuccess: '批量流量完成',
    orderConfirmed: '订单 {orderId} 已确认。',
    batchCompleted: '已生成 {count} 条订单请求。',
    purchaseFailed: '购买失败',
    sessionExpired: '登录已过期',
    faultInjected: '故障已注入：{title}',
    faultFailed: '故障注入失败',
    confirmFault: '确认注入 {title}？',
    dangerousFault: 'App 将退出或短暂无响应，数据可能在下次启动后上传。',
    cancel: '取消',
    continue: '继续注入',
    recovering: '正在恢复故障',
    recoveringDetail: '关闭客户端状态与服务端故障开关…',
    recoverAll: '关闭全部故障',
    recovered: '故障已恢复',
    recoveredDetail: '客户端和服务端故障状态已关闭。',
    recoverFailed: '恢复失败',
    traceHint: '购买后将按业务请求 ID 匹配 gateway、order、inventory 与 payment Trace。',
  },
  en: {
    rumFailed: 'RUM initialization failed',
    submitting: 'Submitting order',
    submittingDetail: 'Correlating inventory, payment, and backend traces…',
    batchSubmitting: 'Generating demo traffic',
    batchDetail: 'Creating five sequential purchase traces…',
    purchaseSuccess: 'Purchase confirmed',
    batchSuccess: 'Batch traffic complete',
    orderConfirmed: 'Order {orderId} is confirmed.',
    batchCompleted: 'Created {count} order requests.',
    purchaseFailed: 'Purchase failed',
    sessionExpired: 'Session expired',
    faultInjected: 'Fault injected: {title}',
    faultFailed: 'Fault injection failed',
    confirmFault: 'Inject {title}?',
    dangerousFault: 'The app may exit or stop responding briefly. Data may upload after restart.',
    cancel: 'Cancel',
    continue: 'Inject',
    recovering: 'Recovering faults',
    recoveringDetail: 'Clearing native state and server fault switches…',
    recoverAll: 'Recover all faults',
    recovered: 'Faults recovered',
    recoveredDetail: 'Native and server fault states are cleared.',
    recoverFailed: 'Recovery failed',
    traceHint: 'After checkout, match gateway, order, inventory, and payment traces by business request ID.',
  },
};

function nativeText(
  language: StoreLanguage,
  key: NativeMessageKey,
  params: Record<string, string | number> = {},
): string {
  return NATIVE_MESSAGES[language][key].replace(
    /\{([a-zA-Z0-9_]+)\}/g,
    (_, name: string) => String(params[name] ?? ''),
  );
}

function historyItem(
  scenario: FaultScenario,
  status: FaultHistoryItem['status'],
  detail?: string,
): FaultHistoryItem {
  return {
    id: `${scenario.id}-${status}-${Date.now()}`,
    scenarioId: scenario.id,
    title: scenario.title,
    status,
    timestamp: new Date().toISOString(),
    detail,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shortId(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-6)}` : value;
}

const styles = StyleSheet.create({
  root: {flex: 1},
  screen: {flex: 1},
  whiteScreen: {flex: 1},
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 90,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingCard: {
    width: '100%',
    maxWidth: 310,
    padding: 22,
    borderWidth: 1,
    borderRadius: 16,
    alignItems: 'center',
  },
  spinner: {
    width: 32,
    height: 32,
    borderWidth: 3,
    borderRadius: 16,
    transform: [{rotate: '45deg'}],
  },
  loadingTitle: {marginTop: 14, fontSize: 16, lineHeight: 21, fontWeight: '900'},
  loadingDetail: {marginTop: 5, fontSize: 11, lineHeight: 17, textAlign: 'center'},
});

export default App;
