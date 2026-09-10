import React, {useEffect, useRef} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type {DesignTokens} from '../designTokens';
import type {ToastState} from '../store';
import {StoreIcon, type StoreIconName} from './StoreIcon';

const ENTER_MS = 220;
const VISIBLE_MS = 3400;
const EXIT_MS = 160;

interface Props {
  toast: ToastState;
  tokens: DesignTokens;
  topInset: number;
  onDismiss: () => void;
}

function toneIcon(tone: ToastState['tone']): StoreIconName {
  if (tone === 'success') return 'check';
  if (tone === 'error') return 'fault';
  return 'book';
}

export function ResultToast({toast, tokens, topInset, onDismiss}: Props) {
  const visibility = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let active = true;
    let exitTimer: ReturnType<typeof setTimeout> | null = null;
    let animation: Animated.CompositeAnimation | null = null;

    visibility.stopAnimation();
    visibility.setValue(0);
    AccessibilityInfo.isReduceMotionEnabled().then(reduceMotion => {
      if (!active) return;
      animation = Animated.timing(visibility, {
        toValue: 1,
        duration: reduceMotion ? EXIT_MS : ENTER_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });
      animation.start();
      exitTimer = setTimeout(() => {
        if (!active) return;
        animation = Animated.timing(visibility, {
          toValue: 0,
          duration: EXIT_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        });
        animation.start(({finished}) => {
          if (active && finished) onDismiss();
        });
      }, VISIBLE_MS);
    });

    return () => {
      active = false;
      if (exitTimer) clearTimeout(exitTimer);
      animation?.stop();
      visibility.stopAnimation();
    };
  }, [onDismiss, toast, visibility]);

  const toneColor =
    toast.tone === 'error'
      ? tokens.colors.danger
      : toast.tone === 'success'
        ? tokens.colors.success
        : tokens.colors.accent;

  return (
    <Animated.View
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      pointerEvents="none"
      testID="result-toast"
      style={[
        styles.toast,
        {
          top: topInset + 10,
          backgroundColor: toneColor,
          borderColor: toneColor,
          opacity: visibility,
          transform: [
            {
              translateY: visibility.interpolate({
                inputRange: [0, 1],
                outputRange: [-14, 0],
              }),
            },
            {
              scale: visibility.interpolate({
                inputRange: [0, 1],
                outputRange: [0.98, 1],
              }),
            },
          ],
        },
      ]}>
      <View
        testID="result-toast-icon"
        style={styles.icon}
        accessibilityElementsHidden>
        <StoreIcon
          name={toneIcon(toast.tone)}
          color={tokens.colors.onAccent}
          size={22}
        />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.title, {color: tokens.colors.onAccent}]}>
          {toast.title}
        </Text>
        <Text style={styles.detail}>{toast.detail}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: 14,
    right: 14,
    zIndex: 100,
    minHeight: 72,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderWidth: 1,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    elevation: 12,
    shadowColor: '#24152f',
    shadowOffset: {width: 0, height: 8},
    shadowOpacity: 0.18,
    shadowRadius: 16,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  copy: {flex: 1, minWidth: 0},
  title: {fontSize: 15, lineHeight: 20, fontWeight: '900'},
  detail: {
    marginTop: 3,
    color: 'rgba(255,255,255,0.82)',
    fontSize: 11,
    lineHeight: 17,
    fontWeight: '600',
  },
});
