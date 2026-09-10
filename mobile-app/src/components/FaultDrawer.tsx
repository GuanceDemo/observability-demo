import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {
  FAULT_TOOLBAR_BUTTON_SIZE,
  faultDrawerSafeSpacing,
} from '../layout';
import type {DesignTokens} from '../designTokens';
import type {FaultHistoryItem, FaultScenario, StoreLanguage} from '../types';
import {openTraceUrl} from '../traceLink';
import {businessFaultCopy, faultPhaseLabel, isBusinessFault, type BusinessFaultRun} from '../businessFaults';
import {AppButton} from './AppButton';
import {StoreIcon} from './StoreIcon';

const DRAWER_SPRING = {
  damping: 24,
  stiffness: 220,
  mass: 0.8,
  useNativeDriver: true,
};
const DRAWER_EXIT_DURATION_MS = 220;
const BACKDROP_VISIBLE_OPACITY = 1;
const OPPOSING_DRAG_RESISTANCE = 0.2;
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface EdgeTagProps {
  tokens: DesignTokens;
  language?: StoreLanguage;
  activeFault: FaultScenario | null;
  onPress: () => void;
}

export function FaultToolbarButton({
  tokens,
  language = 'zh',
  activeFault,
  onPress,
}: EdgeTagProps) {
  return (
    <Pressable
      testID="fault-edge-tag"
      accessibilityRole="button"
      accessibilityLabel={
        activeFault
          ? faultCopy(language, 'edgeActive', {title: activeFault.title})
          : faultCopy(language, 'edgeOpen')
      }
      hitSlop={6}
      onPress={onPress}
      style={({pressed}) => [
        styles.edgeTag,
        {
          backgroundColor: tokens.colors.surface,
          borderColor: activeFault
            ? tokens.colors.danger
            : tokens.colors.line,
          opacity: pressed ? 0.76 : 1,
          transform: [{scale: pressed ? 0.96 : 1}],
        },
      ]}>
      {activeFault && (
        <View
          testID="active-fault-dot"
          style={[styles.activeDot, {backgroundColor: tokens.colors.danger}]}
        />
      )}
      <StoreIcon
        name="fault"
        color={activeFault ? tokens.colors.danger : tokens.colors.accent}
        size={20}
      />
    </Pressable>
  );
}

interface DrawerProps {
  visible: boolean;
  tokens: DesignTokens;
  language?: StoreLanguage;
  scenarios: FaultScenario[];
  selectedScenarioId: string | null;
  activeFault: FaultScenario | null;
  history: FaultHistoryItem[];
  busy: boolean;
  traceUrl: string;
  traceHint: string;
  run?: BusinessFaultRun | null;
  rumUrl?: string;
  replayUrl?: string;
  onClose: () => void;
  onSelect: (scenarioId: string) => void;
  onInject: (scenario: FaultScenario) => void;
  onRecover: () => void;
}

export function FaultDrawer({
  visible,
  tokens,
  language = 'zh',
  scenarios,
  selectedScenarioId,
  activeFault,
  history,
  busy,
  traceUrl,
  traceHint,
  run = null,
  rumUrl = '',
  replayUrl = '',
  onClose,
  onSelect,
  onInject,
  onRecover,
}: DrawerProps) {
  const {width: screenWidth} = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const safeSpacing = faultDrawerSafeSpacing(insets);
  const width = Math.min(screenWidth * 0.88, 360);
  const translateX = useRef(new Animated.Value(width)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const [rendered, setRendered] = useState(visible);
  const [reduceMotion, setReduceMotion] = useState(false);
  const animationGeneration = useRef(0);
  const activeAnimation = useRef<Animated.CompositeAnimation | null>(null);
  const releaseVelocity = useRef(0);
  const selected =
    scenarios.find(item => item.id === selectedScenarioId) ??
    scenarios[0] ??
    null;
  const layers = useMemo(
    () => [...new Set(scenarios.map(item => item.layer))],
    [scenarios],
  );
  const selectedLayer = selected?.layer ?? layers[0];

  const stopCurrentAnimation = useCallback(() => {
    activeAnimation.current?.stop();
    activeAnimation.current = null;
    translateX.stopAnimation();
    backdropOpacity.stopAnimation();
  }, [backdropOpacity, translateX]);

  useEffect(() => {
    let subscribed = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(enabled => {
        if (subscribed) setReduceMotion(enabled);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );
    return () => {
      subscribed = false;
      subscription.remove();
    };
  }, []);

  useEffect(
    () => () => {
      animationGeneration.current += 1;
      stopCurrentAnimation();
    },
    [stopCurrentAnimation],
  );

  useEffect(() => {
    const generation = ++animationGeneration.current;
    stopCurrentAnimation();

    if (visible && !rendered) {
      setRendered(true);
      return;
    }

    if (visible) {
      releaseVelocity.current = 0;
      if (reduceMotion) {
        translateX.setValue(0);
        backdropOpacity.setValue(BACKDROP_VISIBLE_OPACITY);
        return;
      }
      const animation = Animated.parallel([
        Animated.spring(translateX, {
          toValue: 0,
          ...DRAWER_SPRING,
        }),
        Animated.timing(backdropOpacity, {
          toValue: BACKDROP_VISIBLE_OPACITY,
          duration: DRAWER_EXIT_DURATION_MS,
          useNativeDriver: true,
        }),
      ]);
      activeAnimation.current = animation;
      animation.start(({finished}) => {
        if (finished && generation === animationGeneration.current) {
          activeAnimation.current = null;
        }
      });
      return;
    }

    if (!rendered) {
      releaseVelocity.current = 0;
      translateX.setValue(width);
      backdropOpacity.setValue(0);
      return;
    }

    const finalizeExit = () => {
      if (generation !== animationGeneration.current) return;
      activeAnimation.current = null;
      setRendered(false);
    };
    if (reduceMotion) {
      releaseVelocity.current = 0;
      translateX.setValue(width);
      backdropOpacity.setValue(0);
      finalizeExit();
      return;
    }

    const velocity = releaseVelocity.current;
    releaseVelocity.current = 0;
    const animation = Animated.parallel([
      Animated.spring(translateX, {
        toValue: width,
        velocity,
        ...DRAWER_SPRING,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: DRAWER_EXIT_DURATION_MS,
        useNativeDriver: true,
      }),
    ]);
    activeAnimation.current = animation;
    animation.start(({finished}) => {
      if (finished) finalizeExit();
    });
  }, [
    backdropOpacity,
    reduceMotion,
    rendered,
    stopCurrentAnimation,
    translateX,
    visible,
    width,
  ]);

  const settleDrawerOpen = useCallback(() => {
    const generation = ++animationGeneration.current;
    stopCurrentAnimation();
    releaseVelocity.current = 0;
    if (reduceMotion) {
      translateX.setValue(0);
      backdropOpacity.setValue(BACKDROP_VISIBLE_OPACITY);
      return;
    }
    const animation = Animated.parallel([
      Animated.spring(translateX, {
        toValue: 0,
        ...DRAWER_SPRING,
      }),
      Animated.timing(backdropOpacity, {
        toValue: BACKDROP_VISIBLE_OPACITY,
        duration: DRAWER_EXIT_DURATION_MS,
        useNativeDriver: true,
      }),
    ]);
    activeAnimation.current = animation;
    animation.start(({finished}) => {
      if (finished && generation === animationGeneration.current) {
        activeAnimation.current = null;
      }
    });
  }, [backdropOpacity, reduceMotion, stopCurrentAnimation, translateX]);

  const swipe = useMemo(
    () =>
      PanResponder.create({
        // The header is a dedicated drag surface. Claim its initial touch so a
        // short/coalesced drag retains the first movement in its release dx.
        onStartShouldSetPanResponder: () => visible,
        onMoveShouldSetPanResponder: (_, gesture) =>
          visible &&
          Math.abs(gesture.dx) > 10 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderGrant: () => {
          animationGeneration.current += 1;
          stopCurrentAnimation();
        },
        onPanResponderMove: (_, gesture) => {
          translateX.setValue(
            gesture.dx >= 0
              ? gesture.dx
              : gesture.dx * OPPOSING_DRAG_RESISTANCE,
          );
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx > 54 || gesture.vx > 0.65) {
            releaseVelocity.current = Math.max(0, gesture.vx);
            onClose();
          } else {
            settleDrawerOpen();
          }
        },
        onPanResponderTerminate: settleDrawerOpen,
      }),
    [onClose, settleDrawerOpen, stopCurrentAnimation, translateX, visible],
  );

  return (
    <Modal
      animationType="none"
      onRequestClose={onClose}
      navigationBarTranslucent
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={rendered}>
      <View style={styles.modal}>
        <AnimatedPressable
          testID="fault-drawer-backdrop"
          accessibilityLabel={faultCopy(language, 'close')}
          onPress={onClose}
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: tokens.colors.overlay,
              opacity: backdropOpacity,
            },
          ]}
        />
        <Animated.View
          testID="fault-drawer"
          style={[
            styles.drawer,
            {
              width,
              backgroundColor: tokens.colors.background,
              borderLeftColor: tokens.colors.line,
              transform: [{translateX}],
            },
          ]}>
          <View
            testID="fault-drawer-header"
            {...swipe.panHandlers}
            style={[
              styles.drawerHeader,
              {
                backgroundColor: tokens.colors.surface,
                borderBottomColor: tokens.colors.line,
                minHeight: safeSpacing.headerMinHeight,
                paddingTop: safeSpacing.headerPaddingTop,
                paddingRight: safeSpacing.headerPaddingRight,
              },
            ]}>
            <View style={styles.headerCopy}>
              <Text style={[styles.drawerTitle, {color: tokens.colors.text}]}>
                {faultCopy(language, 'title')}
              </Text>
              <Text style={[styles.drawerSubtitle, {color: tokens.colors.muted}]}>
                {faultCopy(language, 'subtitle')}
              </Text>
            </View>
            <AppButton
              label={faultCopy(language, 'collapse')}
              tokens={tokens}
              variant="ghost"
              compact
              onPress={onClose}
            />
          </View>
          <ScrollView
            testID="fault-drawer-scroll"
            contentContainerStyle={[
              styles.drawerContent,
              {
                paddingRight: safeSpacing.contentPaddingRight,
                paddingBottom: safeSpacing.contentPaddingBottom,
              },
            ]}
            overScrollMode="never"
            showsVerticalScrollIndicator={false}>
            <SectionTitle title={faultCopy(language, 'layers')} tokens={tokens} />
            <ScrollView
              horizontal
              overScrollMode="never"
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.tabs}>
              {layers.map(layer => {
                const active = layer === selectedLayer;
                const first = scenarios.find(item => item.layer === layer);
                return (
                  <Pressable
                    key={layer}
                    onPress={() => first && onSelect(first.id)}
                    style={({pressed}) => [
                      styles.tab,
                      {
                        backgroundColor: active
                          ? tokens.colors.accentSoft
                          : tokens.colors.surface,
                        borderColor: active
                          ? tokens.colors.accent
                          : tokens.colors.line,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}>
                    <Text
                      style={[
                        styles.tabText,
                        {
                          color: active
                            ? tokens.colors.accent
                            : tokens.colors.muted,
                        },
                      ]}>
                      {layerLabel(language, layer)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <SectionTitle title={faultCopy(language, 'scenarios')} tokens={tokens} />
            <View style={styles.scenarioGrid}>
              {scenarios
                .filter(item => item.layer === selectedLayer)
                .map(item => {
                  const active = item.id === selected?.id;
                  return (
                    <Pressable
                      key={item.id}
                      accessibilityState={{selected: active}}
                      onPress={() => onSelect(item.id)}
                      style={({pressed}) => [
                        styles.scenario,
                        {
                          backgroundColor: active
                            ? tokens.colors.accentSoft
                            : tokens.colors.surface,
                          borderColor: active
                            ? tokens.colors.accent
                            : tokens.colors.line,
                          opacity: pressed ? 0.72 : 1,
                        },
                      ]}>
                      <Text
                        style={[
                          styles.scenarioTitle,
                          {color: tokens.colors.text},
                        ]}>
                        {item.title}
                      </Text>
                      <Text
                        style={[
                          styles.scenarioMeta,
                          {color: tokens.colors.muted},
                        ]}>
                        {businessFaultCopy(item.id, language)?.trigger ?? `${item.execution} · ${item.kind}`}
                      </Text>
                    </Pressable>
                  );
                })}
            </View>

            {selected && (
              <View
                style={[
                  styles.detailCard,
                  {
                    backgroundColor: tokens.colors.surface,
                    borderColor: tokens.colors.line,
                  },
                ]}>
                <Text style={[styles.detailTitle, {color: tokens.colors.text}]}>
                  {selected.title}
                </Text>
                {!isBusinessFault(selected.id) && <View style={styles.pills}>
                  <Pill text={selected.kind} tokens={tokens} />
                  <Pill text={selected.execution} tokens={tokens} />
                </View>}
                <Text style={[styles.detailBody, {color: tokens.colors.muted}]}>
                  {selected.description}
                </Text>
                {!isBusinessFault(selected.id) && <>
                  <Meta label="service" value={selected.service} tokens={tokens} />
                  <Meta label="target" value={selected.target} tokens={tokens} />
                </>}
                <Text
                  style={[styles.observationLabel, {color: tokens.colors.text}]}>
                  {faultCopy(language, 'observation')}
                </Text>
                <Text
                  style={[styles.detailBody, {color: tokens.colors.muted}]}>
                  {selected.expectedObservation}
                </Text>
              </View>
            )}

            <SectionTitle title={faultCopy(language, 'active')} tokens={tokens} />
            <View
              style={[
                styles.activeCard,
                {
                  backgroundColor: activeFault
                    ? tokens.colors.accentSoft
                    : tokens.colors.surface,
                  borderColor: activeFault
                    ? tokens.colors.danger
                    : tokens.colors.line,
                },
              ]}>
              <Text style={[styles.activeTitle, {color: tokens.colors.text}]}>
                {activeFault?.title ?? (run ? businessFaultCopy(run.scenarioId, language)?.title : faultCopy(language, 'none'))}
              </Text>
              <Text style={[styles.activeDetail, {color: tokens.colors.muted}]}>
                {run && (!activeFault || isBusinessFault(activeFault.id))
                  ? faultPhaseLabel(run.phase, language)
                  : activeFault
                  ? faultCopy(language, 'activeDetail', {
                      layer: layerLabel(language, activeFault.layer),
                      kind: activeFault.kind,
                    })
                  : faultCopy(language, 'noneDetail')}
              </Text>
            </View>
            <View style={styles.actionRow}>
              <AppButton
                label={selected && isBusinessFault(selected.id) ? (language === 'en' ? 'Enable scenario' : '启用场景') : faultCopy(language, 'inject')}
                tokens={tokens}
                busy={busy}
                disabled={!selected}
                onPress={() => selected && onInject(selected)}
                style={styles.actionButton}
              />
              <AppButton
                label={activeFault && isBusinessFault(activeFault.id) ? (language === 'en' ? 'Restore baseline' : '恢复基线') : faultCopy(language, 'recover')}
                tokens={tokens}
                variant="danger"
                busy={busy}
                disabled={!activeFault}
                onPress={onRecover}
                style={styles.recoverButton}
              />
            </View>

            {run && <View style={[styles.traceCard, styles.rumCard, {backgroundColor: tokens.colors.surface, borderColor: tokens.colors.line}]}>
              <Text style={[styles.activeTitle, {color: tokens.colors.text}]}>{language === 'en' ? 'RUM & Session Replay' : 'RUM 与会话回放'}</Text>
              <Text selectable style={[styles.activeDetail, {color: tokens.colors.muted}]}>{run.id}</Text>
              <Text style={[styles.activeDetail, {color: tokens.colors.muted}]}>
                {language === 'en' ? 'Open the filtered views, then select a recorded view to play the session. Data may take a moment to arrive.' : '打开本次场景的视图列表，选择带回放的视图即可播放。数据上传后稍等片刻再查看。'}
              </Text>
              <AppButton label={language === 'en' ? 'Open RUM views' : '查看 RUM 视图'} tokens={tokens} variant="secondary" disabled={!rumUrl} onPress={() => { openTraceUrl(rumUrl).catch(() => undefined); }} style={styles.traceButton} />
              <AppButton label={language === 'en' ? 'Find session replay' : '查找会话回放'} tokens={tokens} variant="secondary" disabled={!replayUrl} onPress={() => { openTraceUrl(replayUrl).catch(() => undefined); }} style={styles.traceButton} />
            </View>}

            <SectionTitle title={faultCopy(language, 'trace')} tokens={tokens} />
            <View
              style={[
                styles.traceCard,
                {
                  backgroundColor: tokens.colors.surface,
                  borderColor: tokens.colors.line,
                },
              ]}>
              <Text style={[styles.activeDetail, {color: tokens.colors.muted}]}>
                {traceHint}
              </Text>
              <AppButton
                label={
                  traceUrl
                    ? faultCopy(language, 'openTrace')
                    : faultCopy(language, 'waitTrace')
                }
                tokens={tokens}
                variant="secondary"
                compact
                disabled={!traceUrl}
                onPress={() => {
                  openTraceUrl(traceUrl).catch(() => undefined);
                }}
                style={styles.traceButton}
              />
            </View>

            <SectionTitle title={faultCopy(language, 'history')} tokens={tokens} />
            <View style={styles.history}>
              {history.length === 0 ? (
                <Text style={[styles.emptyHistory, {color: tokens.colors.muted}]}>
                  {faultCopy(language, 'historyEmpty')}
                </Text>
              ) : (
                history.map(item => (
                  <View
                    key={item.id}
                    style={[
                      styles.historyItem,
                      {borderBottomColor: tokens.colors.line},
                    ]}>
                    <View style={styles.historyTop}>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.historyTitle,
                          {color: tokens.colors.text},
                        ]}>
                        {item.title}
                      </Text>
                      <Text
                        style={[
                          styles.historyStatus,
                          {
                            color:
                              item.status === 'failed'
                                ? tokens.colors.danger
                                : tokens.colors.accent,
                          },
                        ]}>
                        {faultStatus(language, item.status)}
                      </Text>
                    </View>
                    <Text
                      numberOfLines={2}
                      style={[styles.historyTime, {color: tokens.colors.muted}]}>
                      {new Date(item.timestamp).toLocaleTimeString()} ·{' '}
                      {item.detail ?? item.scenarioId}
                    </Text>
                  </View>
                ))
              )}
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

type FaultCopyKey =
  | 'edgeActive'
  | 'edgeOpen'
  | 'close'
  | 'title'
  | 'subtitle'
  | 'collapse'
  | 'layers'
  | 'scenarios'
  | 'observation'
  | 'active'
  | 'none'
  | 'activeDetail'
  | 'noneDetail'
  | 'inject'
  | 'recover'
  | 'trace'
  | 'openTrace'
  | 'waitTrace'
  | 'history'
  | 'historyEmpty';

const FAULT_COPY: Record<StoreLanguage, Record<FaultCopyKey, string>> = {
  zh: {
    edgeActive: '故障控制台，当前 {title}',
    edgeOpen: '打开故障控制台',
    close: '关闭故障抽屉',
    title: '故障注入控制台',
    subtitle: '移动端与服务端真实故障',
    collapse: '收起 ›',
    layers: '故障层级',
    scenarios: '具体场景',
    observation: '预期观测',
    active: '当前活动故障',
    none: '未注入异常',
    activeDetail: '{layer} / {kind}，收起抽屉不会恢复。',
    noneDetail: '选择上方场景后注入；同一时间保留一个活动故障。',
    inject: '注入选中故障',
    recover: '恢复',
    trace: '链路入口',
    openTrace: '打开链路详情',
    waitTrace: '等待链路',
    history: '最近注入记录',
    historyEmpty: '注入故障后，操作记录会显示在这里。',
  },
  en: {
    edgeActive: 'Fault console, active: {title}',
    edgeOpen: 'Open fault console',
    close: 'Close fault drawer',
    title: 'Fault Injection Console',
    subtitle: 'Real native and server faults',
    collapse: 'Close ›',
    layers: 'Fault layer',
    scenarios: 'Scenario',
    observation: 'Expected observation',
    active: 'Active fault',
    none: 'No injected fault',
    activeDetail: '{layer} / {kind}. Closing the drawer does not recover it.',
    noneDetail: 'Choose a scenario to inject. Only one fault remains active.',
    inject: 'Inject selected fault',
    recover: 'Recover',
    trace: 'Trace entry',
    openTrace: 'Open trace details',
    waitTrace: 'Waiting for trace',
    history: 'Recent injections',
    historyEmpty: 'Fault operations will appear here after injection.',
  },
};

function faultCopy(
  language: StoreLanguage,
  key: FaultCopyKey,
  params: Record<string, string> = {},
): string {
  return FAULT_COPY[language][key].replace(
    /\{([a-zA-Z0-9_]+)\}/g,
    (_, name: string) => params[name] ?? '',
  );
}

function faultStatus(
  language: StoreLanguage,
  status: FaultHistoryItem['status'],
): string {
  const copy = {
    zh: {active: '活动中', recovered: '已恢复', failed: '失败'},
    en: {active: 'active', recovered: 'recovered', failed: 'failed'},
  } as const;
  return copy[language][status];
}

function layerLabel(language: StoreLanguage, layer: string): string {
  const labels: Record<string, [string, string]> = {
    frontend: ['前端体验', 'Frontend'],
    runtime: ['运行时', 'Runtime'],
    network: ['网络请求', 'Network'],
    service: ['后端服务', 'Backend'],
    backend: ['后端', 'Backend'],
    dependency: ['依赖', 'Dependency'],
    infrastructure: ['基础设施', 'Infrastructure'],
    jvm: ['JVM', 'JVM'],
  };
  const value = labels[layer];
  return value ? value[language === 'en' ? 1 : 0] : layer;
}

function SectionTitle({
  title,
  tokens,
}: {
  title: string;
  tokens: DesignTokens;
}) {
  return (
    <Text style={[styles.sectionTitle, {color: tokens.colors.text}]}>
      {title}
    </Text>
  );
}

function Pill({text, tokens}: {text: string; tokens: DesignTokens}) {
  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: tokens.colors.accentSoft,
          borderColor: tokens.colors.line,
        },
      ]}>
      <Text style={[styles.pillText, {color: tokens.colors.accent}]}>{text}</Text>
    </View>
  );
}

function Meta({
  label,
  value,
  tokens,
}: {
  label: string;
  value: string;
  tokens: DesignTokens;
}) {
  return (
    <View style={styles.metaRow}>
      <Text style={[styles.metaLabel, {color: tokens.colors.muted}]}>
        {label}
      </Text>
      <Text
        numberOfLines={1}
        style={[styles.metaValue, {color: tokens.colors.text}]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  modal: {
    flex: 1,
    alignItems: 'flex-end',
  },
  drawer: {
    flex: 1,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  drawerHeader: {
    minHeight: 64,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerCopy: {
    flex: 1,
  },
  drawerTitle: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '900',
  },
  drawerSubtitle: {
    marginTop: 2,
    fontSize: 10,
    lineHeight: 14,
  },
  drawerContent: {
    padding: 14,
    paddingBottom: 40,
  },
  sectionTitle: {
    marginTop: 16,
    marginBottom: 9,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '900',
  },
  tabs: {
    gap: 7,
    paddingRight: 10,
  },
  tab: {
    minHeight: 32,
    paddingHorizontal: 11,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabText: {
    fontSize: 10,
    fontWeight: '900',
  },
  scenarioGrid: {
    gap: 7,
  },
  scenario: {
    minHeight: 53,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderWidth: 1,
    borderRadius: 9,
  },
  scenarioTitle: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '900',
  },
  scenarioMeta: {
    marginTop: 2,
    fontSize: 9,
    lineHeight: 13,
  },
  detailCard: {
    marginTop: 12,
    padding: 13,
    borderWidth: 1,
    borderRadius: 10,
  },
  detailTitle: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '900',
  },
  pills: {
    marginTop: 8,
    flexDirection: 'row',
    gap: 6,
  },
  pill: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: 1,
    borderRadius: 999,
  },
  pillText: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '900',
  },
  detailBody: {
    marginTop: 9,
    fontSize: 11,
    lineHeight: 18,
  },
  metaRow: {
    marginTop: 8,
    flexDirection: 'row',
    gap: 10,
  },
  metaLabel: {
    width: 48,
    fontSize: 10,
  },
  metaValue: {
    flex: 1,
    fontSize: 10,
    fontWeight: '800',
  },
  observationLabel: {
    marginTop: 12,
    fontSize: 10,
    fontWeight: '900',
  },
  activeCard: {
    padding: 12,
    borderWidth: 1,
    borderRadius: 10,
  },
  activeTitle: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '900',
  },
  activeDetail: {
    marginTop: 4,
    fontSize: 10,
    lineHeight: 16,
  },
  actionRow: {
    marginTop: 9,
    flexDirection: 'row',
    gap: 7,
  },
  actionButton: {
    flex: 1,
  },
  recoverButton: {
    minWidth: 82,
  },
  rumCard: {marginTop: 12},
  traceCard: {
    padding: 12,
    borderWidth: 1,
    borderRadius: 10,
  },
  traceButton: {
    marginTop: 9,
  },
  history: {
    minHeight: 60,
  },
  emptyHistory: {
    fontSize: 10,
    lineHeight: 16,
  },
  historyItem: {
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  historyTop: {
    flexDirection: 'row',
    gap: 8,
  },
  historyTitle: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
  },
  historyStatus: {
    fontSize: 9,
    lineHeight: 14,
    fontWeight: '900',
  },
  historyTime: {
    marginTop: 3,
    fontSize: 9,
    lineHeight: 14,
  },
  edgeTag: {
    width: FAULT_TOOLBAR_BUTTON_SIZE,
    height: FAULT_TOOLBAR_BUTTON_SIZE,
    borderWidth: 1,
    borderRadius: FAULT_TOOLBAR_BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeDot: {
    position: 'absolute',
    right: 5,
    top: 5,
    width: 7,
    height: 7,
    borderRadius: 4,
  },
});
