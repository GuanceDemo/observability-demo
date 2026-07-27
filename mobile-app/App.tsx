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
} from 'react-native-safe-area-context';
import {DemoApi} from './src/api';
import {
  FaultDrawer,
  FaultEdgeTag,
} from './src/components/FaultDrawer';
import {StoreHeader} from './src/components/StoreHeader';
import {gatewayUrl} from './src/config';
import {BOOK} from './src/data';
import {
  dangerousScenarioIds,
  filterFaultsForPlatform,
  findActiveServerFault,
  injectClientFault,
} from './src/faults';
import {
  action as rumAction,
  initializeObservability,
  startView,
  stopView,
} from './src/observability';
import {BagScreen} from './src/screens/BagScreen';
import {DetailScreen} from './src/screens/DetailScreen';
import {HomeScreen} from './src/screens/HomeScreen';
import {
  initialStoreState,
  storeReducer,
  type ToastState,
} from './src/store';
import {loadPersistedStore, persistStore} from './src/storage';
import {themeFor} from './src/theme';
import {buildTraceUrl} from './src/traceLink';
import type {
  DemoPublicConfig,
  FaultHistoryItem,
  FaultScenario,
  MobileRumConfig,
  OrderResult,
  StoreScreen,
  ThemeName,
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

function runSilently(promise: Promise<unknown>): void {
  promise.catch(() => undefined);
}

function App() {
  return (
    <SafeAreaProvider>
      <Storefront />
    </SafeAreaProvider>
  );
}

function Storefront() {
  const [state, dispatch] = useReducer(storeReducer, initialStoreState);
  const [hydrated, setHydrated] = useState(false);
  const [faults, setFaults] = useState<FaultScenario[]>([]);
  const [rumConfig, setRumConfig] = useState(DEFAULT_MOBILE_CONFIG);
  const [publicConfig, setPublicConfig] = useState<DemoPublicConfig>({
    project: 'mall-demo',
  });
  const [traceId, setTraceId] = useState('');
  const api = useMemo(() => new DemoApi(gatewayUrl), []);
  const tokens = themeFor(state.theme);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((toast: ToastState) => {
    if (toastTimer.current) {
      clearTimeout(toastTimer.current);
    }
    dispatch({type: 'showToast', toast});
    toastTimer.current = setTimeout(
      () => dispatch({type: 'hideToast'}),
      3600,
    );
  }, []);

  const navigate = useCallback(
    (screen: StoreScreen) => {
      if (screen === state.screen) {
        return;
      }
      rumAction('business_navigate_bookstore', {
        from: state.screen,
        to: screen,
      });
      dispatch({type: 'navigate', screen});
    },
    [state.screen],
  );

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      const persisted = await loadPersistedStore();
      if (cancelled) {
        return;
      }
      dispatch({type: 'hydrate', ...persisted});
      setHydrated(true);

      const [mobileResult, publicResult, catalogResult] =
        await Promise.allSettled([
          api.getMobileConfig(),
          api.getPublicConfig(),
          api.getFaultCatalog(),
        ]);
      if (cancelled) {
        return;
      }
      if (publicResult.status === 'fulfilled') {
        setPublicConfig(publicResult.value);
      }
      if (catalogResult.status === 'fulfilled') {
        const platform = Platform.OS === 'ios' ? 'ios' : 'android';
        const platformFaults = filterFaultsForPlatform(
          catalogResult.value.items,
          platform,
        );
        setFaults(platformFaults);
        const activeServerFault = findActiveServerFault(
          platformFaults,
          catalogResult.value.active,
        );
        if (activeServerFault) {
          dispatch({type: 'restoreActiveFault', scenario: activeServerFault});
        } else if (platformFaults[0]) {
          dispatch({type: 'selectFault', scenarioId: platformFaults[0].id});
        }
      }
      if (mobileResult.status === 'fulfilled') {
        setRumConfig(mobileResult.value);
        try {
          await initializeObservability(mobileResult.value, gatewayUrl);
        } catch (error) {
          showToast({
            tone: 'error',
            title: 'RUM 初始化失败',
            detail: errorMessage(error),
          });
        }
      }
      startView('商城首页', {screen: 'home'});
    }
    runSilently(bootstrap());
    return () => {
      cancelled = true;
    };
  }, [api, showToast]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    runSilently(persistStore({
      theme: state.theme,
      cartQuantity: state.cartQuantity,
      selectedSku: state.selectedSku,
    }));
  }, [
    hydrated,
    state.cartQuantity,
    state.selectedSku,
    state.theme,
  ]);

  useEffect(() => {
    const names: Record<StoreScreen, string> = {
      home: '商城首页',
      detail: '图书详情',
      purchase: '购物袋',
    };
    stopView({reason: 'navigation'});
    startView(names[state.screen], {screen: state.screen});
  }, [state.screen]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (state.drawerOpen) {
          dispatch({type: 'setDrawer', open: false});
          return true;
        }
        if (state.screen !== 'home') {
          navigate('home');
          return true;
        }
        return false;
      },
    );
    return () => subscription.remove();
  }, [navigate, state.drawerOpen, state.screen]);

  const swipeBack = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (event, gesture) =>
          !state.drawerOpen &&
          state.screen !== 'home' &&
          event.nativeEvent.pageX - gesture.dx <= 28 &&
          gesture.dx > 14 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx > 70 || gesture.vx > 0.65) {
            rumAction('mobile_swipe_back', {from: state.screen});
            navigate('home');
          }
        },
      }),
    [navigate, state.drawerOpen, state.screen],
  );

  const toggleCart = useCallback(() => {
    const next = state.cartQuantity === 1 ? 0 : 1;
    rumAction(next ? 'business_add_book_to_bag' : 'business_remove_book_from_bag', {
      product: BOOK.name,
      sku: BOOK.sku,
    });
    dispatch({type: 'setCart', quantity: next});
    showToast({
      tone: 'info',
      title: next ? '已加入购物袋' : '已移出购物袋',
      detail: next
        ? `《${BOOK.name}》已放入购物袋。`
        : '你可以随时再次加入这本书。',
    });
  }, [showToast, state.cartQuantity]);

  const lookupTrace = useCallback(
    async (result: OrderResult) => {
      const requestId =
        typeof result.businessRequestId === 'string'
          ? result.businessRequestId
          : '';
      const orderId = typeof result.orderId === 'string' ? result.orderId : '';
      if (!requestId) {
        return;
      }
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await delay(attempt === 0 ? 350 : 500);
        try {
          const lookup = await api.findTrace(requestId, orderId);
          const found = lookup.traceId ?? lookup.traceIds?.[0] ?? '';
          if (found) {
            setTraceId(found);
            return;
          }
        } catch {
          // The logs can arrive after the order response; retry within a short demo window.
        }
      }
    },
    [api],
  );

  const purchase = useCallback(async () => {
    rumAction('business_submit_book_order', {
      product: BOOK.name,
      sku: BOOK.sku,
    });
    dispatch({
      type: 'setLoading',
      loading: true,
      title: '正在提交订单',
      detail: '正在关联库存、支付与后端 Trace…',
    });
    try {
      const result = await api.purchase(rumConfig.project);
      showToast({
        tone: 'success',
        title: '购买成功',
        detail: result.orderId
          ? `订单 ${String(result.orderId).slice(-10)} 已确认。`
          : '订单已确认，可在故障抽屉查看链路。',
      });
      runSilently(lookupTrace(result));
    } catch (error) {
      showToast({
        tone: 'error',
        title: '购买失败',
        detail: errorMessage(error),
      });
    } finally {
      dispatch({type: 'setLoading', loading: false});
    }
  }, [api, lookupTrace, rumConfig.project, showToast]);

  const batchPurchase = useCallback(async () => {
    rumAction('run_book_purchase_traffic', {total: 5});
    dispatch({
      type: 'setLoading',
      loading: true,
      title: '正在生成演示流量',
      detail: '连续创建 5 条购书业务链路…',
    });
    try {
      const results = await api.runPurchaseTraffic(rumConfig.project, 5);
      showToast({
        tone: 'success',
        title: '批量流量完成',
        detail: `已生成 ${results.length} 条订单请求。`,
      });
      const last = results.at(-1);
      if (last) {
        runSilently(lookupTrace(last));
      }
    } catch (error) {
      showToast({
        tone: 'error',
        title: '批量流量失败',
        detail: errorMessage(error),
      });
    } finally {
      dispatch({type: 'setLoading', loading: false});
    }
  }, [api, lookupTrace, rumConfig.project, showToast]);

  const activateFault = useCallback(
    async (scenario: FaultScenario) => {
      const history = historyItem(scenario, 'active');
      dispatch({type: 'faultActivated', scenario, history});
      try {
        if (scenario.execution === 'client') {
          await injectClientFault(scenario, {
            api,
            project: rumConfig.project,
            setWhiteScreen: active =>
              dispatch({type: 'setWhiteScreen', active}),
          });
        } else {
          await api.enableServerFault(scenario.id);
        }
        showToast({
          tone: 'info',
          title: `故障已注入：${scenario.title}`,
          detail: scenario.expectedObservation,
        });
      } catch (error) {
        dispatch({
          type: 'faultFailed',
          history: historyItem(scenario, 'failed', errorMessage(error)),
        });
        showToast({
          tone: 'error',
          title: '故障注入失败',
          detail: errorMessage(error),
        });
      }
    },
    [api, rumConfig.project, showToast],
  );

  const injectFault = useCallback(
    (scenario: FaultScenario) => {
      rumAction('mobile_inject_fault', {fault_id: scenario.id});
      if (dangerousScenarioIds.has(scenario.id)) {
        Alert.alert(
          `确认注入 ${scenario.title}？`,
          'App 将退出或短暂无响应，数据可能在下次启动后上传。',
          [
            {text: '取消', style: 'cancel'},
            {
              text: '继续注入',
              style: 'destructive',
              onPress: () => runSilently(activateFault(scenario)),
            },
          ],
        );
        return;
      }
      runSilently(activateFault(scenario));
    },
    [activateFault],
  );

  const recoverFaults = useCallback(async () => {
    const recovering = state.activeFault;
    dispatch({
      type: 'setLoading',
      loading: true,
      title: '正在恢复故障',
      detail: '关闭客户端状态与服务端故障开关…',
    });
    try {
      await api.recoverFaults();
      dispatch({
        type: 'faultRecovered',
        history: recovering
          ? historyItem(recovering, 'recovered')
          : {
              id: `recover-${Date.now()}`,
              scenarioId: 'all',
              title: '关闭全部故障',
              status: 'recovered',
              timestamp: new Date().toISOString(),
            },
      });
      showToast({
        tone: 'success',
        title: '故障已恢复',
        detail: '客户端和服务端故障状态已关闭。',
      });
    } catch (error) {
      showToast({
        tone: 'error',
        title: '恢复失败',
        detail: errorMessage(error),
      });
    } finally {
      dispatch({type: 'setLoading', loading: false});
    }
  }, [api, showToast, state.activeFault]);

  const traceUrl = buildTraceUrl(traceId, publicConfig);
  const traceHint = traceId
    ? `已匹配 trace_id=${shortId(traceId)}。`
    : '购买后将按业务请求 ID 匹配 gateway、order、inventory 与 payment Trace。';

  if (state.whiteScreen) {
    return (
      <View
        testID="white-screen"
        style={styles.whiteScreen}>
        <StatusBar hidden />
      </View>
    );
  }

  return (
    <SafeAreaView
      edges={['top', 'left', 'right', 'bottom']}
      style={[styles.root, {backgroundColor: tokens.colors.background}]}
      {...swipeBack.panHandlers}>
      <StatusBar
        barStyle="dark-content"
        backgroundColor={tokens.colors.surface}
      />
      <StoreHeader
        tokens={tokens}
        screen={state.screen}
        cartQuantity={state.cartQuantity}
        onNavigate={navigate}
        onThemeChange={(theme: ThemeName) => {
          rumAction('business_switch_theme', {theme});
          dispatch({type: 'setTheme', theme});
        }}
      />
      <View style={styles.screen}>
        {state.screen === 'home' && (
          <HomeScreen
            tokens={tokens}
            inCart={state.cartQuantity === 1}
            onViewBook={() => navigate('detail')}
            onToggleCart={toggleCart}
          />
        )}
        {state.screen === 'detail' && (
          <DetailScreen
            tokens={tokens}
            inCart={state.cartQuantity === 1}
            onBack={() => navigate('home')}
            onToggleCart={toggleCart}
            onBuy={() => {
              if (state.cartQuantity === 0) {
                dispatch({type: 'setCart', quantity: 1});
              }
              navigate('purchase');
            }}
          />
        )}
        {state.screen === 'purchase' && (
          <BagScreen
            tokens={tokens}
            cartQuantity={state.cartQuantity}
            busy={state.loading}
            onBrowse={() => navigate('detail')}
            onRemove={toggleCart}
            onPurchase={() => runSilently(purchase())}
            onBatchPurchase={() => runSilently(batchPurchase())}
          />
        )}
      </View>

      <FaultEdgeTag
        tokens={tokens}
        activeFault={state.activeFault}
        onPress={() => {
          rumAction('mobile_open_fault_drawer');
          dispatch({type: 'setDrawer', open: true});
        }}
      />
      <FaultDrawer
        visible={state.drawerOpen}
        tokens={tokens}
        scenarios={faults}
        selectedScenarioId={state.selectedFaultId}
        activeFault={state.activeFault}
        history={state.faultHistory}
        busy={state.loading}
        traceUrl={traceUrl}
        traceHint={traceHint}
        onClose={() => dispatch({type: 'setDrawer', open: false})}
        onSelect={scenarioId =>
          dispatch({type: 'selectFault', scenarioId})
        }
        onInject={injectFault}
        onRecover={() => runSilently(recoverFaults())}
      />

      {state.loading && (
        <View
          testID="loading-overlay"
          style={[styles.overlay, {backgroundColor: tokens.colors.overlay}]}>
          <View
            style={[
              styles.loadingCard,
              {
                backgroundColor: tokens.colors.surface,
                borderColor: tokens.colors.line,
              },
            ]}>
            <View
              style={[
                styles.spinner,
                {
                  borderColor: tokens.colors.line,
                  borderTopColor: tokens.colors.accent,
                },
              ]}
            />
            <Text style={[styles.loadingTitle, {color: tokens.colors.text}]}>
              {state.loadingTitle}
            </Text>
            <Text style={[styles.loadingDetail, {color: tokens.colors.muted}]}>
              {state.loadingDetail}
            </Text>
          </View>
        </View>
      )}
      {state.toast && (
        <View
          testID="result-toast"
          style={[
            styles.toast,
            {
              backgroundColor: tokens.colors.surface,
              borderColor:
                state.toast.tone === 'error'
                  ? tokens.colors.danger
                  : state.toast.tone === 'success'
                    ? tokens.colors.accent
                    : tokens.colors.line,
            },
          ]}>
          <Text style={[styles.toastTitle, {color: tokens.colors.text}]}>
            {state.toast.title}
          </Text>
          <Text style={[styles.toastDetail, {color: tokens.colors.muted}]}>
            {state.toast.detail}
          </Text>
        </View>
      )}
    </SafeAreaView>
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
  root: {
    flex: 1,
  },
  screen: {
    flex: 1,
  },
  whiteScreen: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 70,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingCard: {
    width: '100%',
    maxWidth: 310,
    padding: 22,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: 'center',
  },
  spinner: {
    width: 32,
    height: 32,
    borderWidth: 3,
    borderRadius: 16,
    transform: [{rotate: '45deg'}],
  },
  loadingTitle: {
    marginTop: 14,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '900',
  },
  loadingDetail: {
    marginTop: 5,
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'center',
  },
  toast: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 14,
    zIndex: 65,
    padding: 13,
    borderWidth: 1,
    borderRadius: 12,
  },
  toastTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
  },
  toastDetail: {
    marginTop: 3,
    fontSize: 11,
    lineHeight: 16,
  },
});

export default App;
