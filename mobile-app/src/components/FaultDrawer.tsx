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
  FAULT_EDGE_TAG_WIDTH,
  FAULT_EDGE_TAG_MIN_HEIGHT,
  faultDrawerSafeSpacing,
} from '../layout';
import type {DesignTokens} from '../designTokens';
import type {FaultHistoryItem, FaultScenario} from '../types';
import {openTraceUrl} from '../traceLink';
import {AppButton} from './AppButton';

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
  activeFault: FaultScenario | null;
  onPress: () => void;
}

export function FaultEdgeTag({
  tokens,
  activeFault,
  onPress,
}: EdgeTagProps) {
  const shortened = activeFault
    ? activeFault.title.replace('移动端', '').slice(0, 2)
    : '故障';
  return (
    <Pressable
      testID="fault-edge-tag"
      accessibilityRole="button"
      accessibilityLabel={
        activeFault ? `故障控制台，当前 ${activeFault.title}` : '打开故障控制台'
      }
      onPress={onPress}
      style={({pressed}) => [
        styles.edgeTag,
        {
          backgroundColor: tokens.colors.surface,
          borderColor: activeFault
            ? tokens.colors.danger
            : tokens.colors.line,
          opacity: pressed ? 0.76 : 1,
        },
      ]}>
      {activeFault && (
        <View
          testID="active-fault-dot"
          style={[styles.activeDot, {backgroundColor: tokens.colors.danger}]}
        />
      )}
      <Text
        numberOfLines={2}
        style={[styles.edgeTagText, {color: tokens.colors.text}]}>
        !{'\n'}{shortened}
      </Text>
    </Pressable>
  );
}

interface DrawerProps {
  visible: boolean;
  tokens: DesignTokens;
  scenarios: FaultScenario[];
  selectedScenarioId: string | null;
  activeFault: FaultScenario | null;
  history: FaultHistoryItem[];
  busy: boolean;
  traceUrl: string;
  traceHint: string;
  onClose: () => void;
  onSelect: (scenarioId: string) => void;
  onInject: (scenario: FaultScenario) => void;
  onRecover: () => void;
}

export function FaultDrawer({
  visible,
  tokens,
  scenarios,
  selectedScenarioId,
  activeFault,
  history,
  busy,
  traceUrl,
  traceHint,
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
          accessibilityLabel="关闭故障抽屉"
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
          {...swipe.panHandlers}
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
                故障注入控制台
              </Text>
              <Text style={[styles.drawerSubtitle, {color: tokens.colors.muted}]}>
                移动端与服务端真实故障
              </Text>
            </View>
            <AppButton
              label="收起 ›"
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
            showsVerticalScrollIndicator={false}>
            <SectionTitle title="故障层级" tokens={tokens} />
            <ScrollView
              horizontal
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
                      {layer}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <SectionTitle title="具体场景" tokens={tokens} />
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
                        {item.execution} · {item.kind}
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
                <View style={styles.pills}>
                  <Pill text={selected.kind} tokens={tokens} />
                  <Pill text={selected.execution} tokens={tokens} />
                </View>
                <Text style={[styles.detailBody, {color: tokens.colors.muted}]}>
                  {selected.description}
                </Text>
                <Meta label="service" value={selected.service} tokens={tokens} />
                <Meta label="target" value={selected.target} tokens={tokens} />
                <Text
                  style={[styles.observationLabel, {color: tokens.colors.text}]}>
                  预期观测
                </Text>
                <Text
                  style={[styles.detailBody, {color: tokens.colors.muted}]}>
                  {selected.expectedObservation}
                </Text>
              </View>
            )}

            <SectionTitle title="当前活动故障" tokens={tokens} />
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
                {activeFault?.title ?? '未注入异常'}
              </Text>
              <Text style={[styles.activeDetail, {color: tokens.colors.muted}]}>
                {activeFault
                  ? `${activeFault.layer} / ${activeFault.kind}，收起抽屉不会恢复。`
                  : '选择上方场景后注入；同一时间保留一个活动故障。'}
              </Text>
            </View>
            <View style={styles.actionRow}>
              <AppButton
                label="注入选中故障"
                tokens={tokens}
                busy={busy}
                disabled={!selected}
                onPress={() => selected && onInject(selected)}
                style={styles.actionButton}
              />
              <AppButton
                label="恢复"
                tokens={tokens}
                variant="danger"
                busy={busy}
                disabled={!activeFault}
                onPress={onRecover}
                style={styles.recoverButton}
              />
            </View>

            <SectionTitle title="链路入口" tokens={tokens} />
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
                label={traceUrl ? '打开链路详情' : '等待链路'}
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

            <SectionTitle title="最近注入记录" tokens={tokens} />
            <View style={styles.history}>
              {history.length === 0 ? (
                <Text style={[styles.emptyHistory, {color: tokens.colors.muted}]}>
                  注入故障后，操作记录会显示在这里。
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
                        {item.status}
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
    position: 'absolute',
    right: -1,
    top: '43%',
    zIndex: 50,
    width: FAULT_EDGE_TAG_WIDTH,
    minHeight: FAULT_EDGE_TAG_MIN_HEIGHT,
    paddingHorizontal: 3,
    paddingVertical: 7,
    borderWidth: 1,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  edgeTagText: {
    width: '100%',
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '900',
    textAlign: 'center',
  },
  activeDot: {
    position: 'absolute',
    left: 5,
    top: 6,
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
