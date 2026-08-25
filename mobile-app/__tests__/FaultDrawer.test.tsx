import React from 'react';
import {
  AccessibilityInfo,
  Animated,
  Modal,
  PanResponder,
  StyleSheet,
} from 'react-native';
import type {
  GestureResponderEvent,
  PanResponderCallbacks,
  PanResponderGestureState,
} from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';
import {FaultDrawer} from '../src/components/FaultDrawer';
import {storefrontTokens} from '../src/designTokens';
import type {FaultScenario} from '../src/types';
import {AppButton} from '../src/components/AppButton';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, right: 0, bottom: 0, left: 0}),
}));

type AnimationKind = 'spring' | 'timing' | 'parallel';

interface TrackedAnimation {
  kind: AnimationKind;
  config?: Record<string, unknown>;
  children: TrackedAnimation[];
  composite: Animated.CompositeAnimation;
  completion?: (result: {finished: boolean}) => void;
}

interface InspectableAnimatedValue {
  __getValue: () => number;
}

interface ReduceMotionAccessibilityInfo {
  addEventListener: (
    event: 'reduceMotionChanged',
    listener: (enabled: boolean) => void,
  ) => {remove: () => void};
}

const tokens = storefrontTokens;
const scenario: FaultScenario = {
  id: 'mobile_slow_network',
  title: '移动端慢网络',
  layer: '移动端',
  kind: 'slow_network',
  service: 'mobile-app',
  target: 'checkout',
  mode: 'slow',
  description: '模拟移动端慢网络。',
  expectedObservation: '请求耗时升高。',
  ttlSeconds: 60,
  clientSide: true,
  execution: 'client',
  platforms: ['android', 'ios'],
};

const noop = () => undefined;
let startedAnimations: TrackedAnimation[];
let trackedByComposite: WeakMap<Animated.CompositeAnimation, TrackedAnimation>;
let panCallbacks: PanResponderCallbacks;
let reduceMotionListener: ((enabled: boolean) => void) | undefined;
let removeReduceMotionListener: jest.Mock;

function gesture(
  overrides: Partial<PanResponderGestureState>,
): PanResponderGestureState {
  return {
    stateID: 1,
    moveX: 0,
    moveY: 0,
    x0: 0,
    y0: 0,
    dx: 0,
    dy: 0,
    vx: 0,
    vy: 0,
    numberActiveTouches: 1,
    _accountsForMovesUpTo: 0,
    ...overrides,
  };
}

function createTrackedAnimation(
  kind: AnimationKind,
  config?: Record<string, unknown>,
  children: TrackedAnimation[] = [],
): Animated.CompositeAnimation {
  const tracked = {} as TrackedAnimation;
  const composite: Animated.CompositeAnimation = {
    start: callback => {
      tracked.completion = callback;
      startedAnimations.push(tracked);
    },
    stop: jest.fn(),
    reset: jest.fn(),
  };
  Object.assign(tracked, {kind, config, children, composite});
  trackedByComposite.set(composite, tracked);
  return composite;
}

function complete(animation: TrackedAnimation, finished = true) {
  act(() => animation.completion?.({finished}));
}

function renderDrawer(
  visible: boolean,
  onClose: () => void = noop,
): TestRenderer.ReactTestRenderer {
  let tree: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <FaultDrawer
        visible={visible}
        tokens={tokens}
        scenarios={[scenario]}
        selectedScenarioId={scenario.id}
        activeFault={null}
        history={[]}
        busy={false}
        traceUrl=""
        traceHint="等待链路"
        onClose={onClose}
        onSelect={noop}
        onInject={noop}
        onRecover={noop}
      />,
    );
  });
  return tree!;
}

function updateDrawer(
  tree: TestRenderer.ReactTestRenderer,
  visible: boolean,
  onClose: () => void = noop,
) {
  act(() => {
    tree.update(
      <FaultDrawer
        visible={visible}
        tokens={tokens}
        scenarios={[scenario]}
        selectedScenarioId={scenario.id}
        activeFault={null}
        history={[]}
        busy={false}
        traceUrl=""
        traceHint="等待链路"
        onClose={onClose}
        onSelect={noop}
        onInject={noop}
        onRecover={noop}
      />,
    );
  });
}

function animatedValue(
  tree: TestRenderer.ReactTestRenderer,
  testID: string,
  property: 'opacity' | 'translateX',
): number {
  const style = StyleSheet.flatten(tree.root.findByProps({testID}).props.style);
  const value =
    property === 'opacity'
      ? style.opacity
      : style.transform.find(
          (entry: {translateX?: Animated.Value}) => entry.translateX,
        ).translateX;
  return (value as unknown as InspectableAnimatedValue).__getValue();
}

describe('FaultDrawer motion lifecycle', () => {
  beforeEach(() => {
    startedAnimations = [];
    trackedByComposite = new WeakMap();
    panCallbacks = {};
    reduceMotionListener = undefined;
    removeReduceMotionListener = jest.fn();

    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockReturnValue(new Promise(() => undefined));
    jest
      .spyOn(
        AccessibilityInfo as unknown as ReduceMotionAccessibilityInfo,
        'addEventListener',
      )
      .mockImplementation((_event, listener) => {
        reduceMotionListener = listener;
        return {remove: removeReduceMotionListener};
      });
    jest.spyOn(Animated, 'spring').mockImplementation((_value, config) =>
      createTrackedAnimation(
        'spring',
        config as unknown as Record<string, unknown>,
      ),
    );
    jest.spyOn(Animated, 'timing').mockImplementation((_value, config) =>
      createTrackedAnimation(
        'timing',
        config as unknown as Record<string, unknown>,
      ),
    );
    jest.spyOn(Animated, 'parallel').mockImplementation(animations =>
      createTrackedAnimation(
        'parallel',
        undefined,
        animations.map(animation => trackedByComposite.get(animation)!),
      ),
    );
    jest.spyOn(PanResponder, 'create').mockImplementation(callbacks => {
      panCallbacks = callbacks;
      return {panHandlers: {}};
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps the modal rendered until the current exit completes', () => {
    const tree = renderDrawer(true);
    updateDrawer(tree, false);

    const exit = startedAnimations.at(-1)!;
    expect(tree.root.findByType(Modal).props.visible).toBe(true);
    expect(exit.kind).toBe('parallel');
    expect(exit.children[0]).toMatchObject({
      kind: 'spring',
      config: expect.objectContaining({
        velocity: 0,
        damping: 24,
        stiffness: 220,
        mass: 0.8,
        useNativeDriver: true,
      }),
    });
    expect(exit.children[1]).toMatchObject({
      kind: 'timing',
      config: expect.objectContaining({
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }),
    });

    complete(exit);
    expect(tree.root.findByType(Modal).props.visible).toBe(false);
    act(() => tree.unmount());
  });

  it('ignores a stale exit completion after a rapid reopen', () => {
    const tree = renderDrawer(true);
    updateDrawer(tree, false);
    const staleExit = startedAnimations.at(-1)!;

    updateDrawer(tree, true);
    const reopened = startedAnimations.at(-1)!;
    expect(reopened).not.toBe(staleExit);
    expect(staleExit.composite.stop).toHaveBeenCalled();

    complete(staleExit);
    expect(tree.root.findByType(Modal).props.visible).toBe(true);
    expect(animatedValue(tree, 'fault-drawer', 'translateX')).toBeGreaterThanOrEqual(
      0,
    );
    act(() => tree.unmount());
  });

  it('routes close button, backdrop, hardware back, and swipe through onClose', () => {
    const onClose = jest.fn();
    const tree = renderDrawer(true, onClose);
    const closeButton = tree.root
      .findAllByType(AppButton)
      .find(node => node.props.label === '收起 ›')!;

    act(() => closeButton.props.onPress());
    act(() =>
      tree.root.findByProps({testID: 'fault-drawer-backdrop'}).props.onPress(),
    );
    act(() => tree.root.findByType(Modal).props.onRequestClose());
    act(() =>
      panCallbacks.onPanResponderRelease?.(
        null as unknown as GestureResponderEvent,
        gesture({dx: 60, vx: 0.8}),
      ),
    );

    expect(onClose).toHaveBeenCalledTimes(4);
    act(() => tree.unmount());
  });

  it('resists opposing drag, springs a cancelled swipe, and preserves exit velocity', () => {
    const onClose = jest.fn();
    const tree = renderDrawer(true, onClose);
    const event = null as unknown as GestureResponderEvent;

    expect(
      panCallbacks.onMoveShouldSetPanResponder?.(
        event,
        gesture({dx: -20, dy: 2}),
      ),
    ).toBe(true);
    act(() => panCallbacks.onPanResponderGrant?.(event, gesture({})));
    act(() =>
      panCallbacks.onPanResponderMove?.(event, gesture({dx: -20, dy: 2})),
    );
    expect(animatedValue(tree, 'fault-drawer', 'translateX')).toBe(-4);

    act(() =>
      panCallbacks.onPanResponderRelease?.(
        event,
        gesture({dx: 24, vx: 0.2}),
      ),
    );
    const cancelled = startedAnimations.at(-1)!;
    expect(cancelled.children[0]).toMatchObject({
      kind: 'spring',
      config: expect.objectContaining({toValue: 0, useNativeDriver: true}),
    });
    expect(onClose).not.toHaveBeenCalled();

    act(() => panCallbacks.onPanResponderGrant?.(event, gesture({})));
    act(() =>
      panCallbacks.onPanResponderRelease?.(
        event,
        gesture({dx: 60, vx: 0.9}),
      ),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    updateDrawer(tree, false, onClose);
    const exit = startedAnimations.at(-1)!;
    expect(exit.children[0].config).toEqual(
      expect.objectContaining({velocity: 0.9, useNativeDriver: true}),
    );
    act(() => tree.unmount());
  });

  it('snaps position for reduced motion and removes its listener on unmount', () => {
    const tree = renderDrawer(true);
    act(() => reduceMotionListener?.(true));

    expect(animatedValue(tree, 'fault-drawer', 'translateX')).toBe(0);
    expect(animatedValue(tree, 'fault-drawer-backdrop', 'opacity')).toBe(1);
    const animationCount = startedAnimations.length;

    updateDrawer(tree, false);
    expect(tree.root.findByType(Modal).props.visible).toBe(false);
    expect(startedAnimations).toHaveLength(animationCount);

    act(() => tree.unmount());
    expect(removeReduceMotionListener).toHaveBeenCalledTimes(1);
  });
});
