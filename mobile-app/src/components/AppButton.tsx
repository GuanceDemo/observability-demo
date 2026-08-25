import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
} from 'react-native';
import type {DesignTokens} from '../designTokens';

interface Props extends PressableProps {
  label: string;
  tokens: DesignTokens;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  compact?: boolean;
  busy?: boolean;
}

export function AppButton({
  label,
  tokens,
  variant = 'primary',
  compact = false,
  busy = false,
  disabled,
  style,
  ...props
}: Props) {
  const primary = variant === 'primary';
  const danger = variant === 'danger';
  const ghost = variant === 'ghost';
  const foreground = primary
    ? tokens.colors.onAccent
    : danger
      ? tokens.colors.danger
      : tokens.colors.text;
  const background = primary
    ? tokens.colors.accent
    : ghost
      ? 'transparent'
      : tokens.colors.surface;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      style={({pressed}) => [
        styles.base,
        compact && styles.compact,
        {
          backgroundColor: background,
          borderColor: danger
            ? tokens.colors.danger
            : primary
              ? tokens.colors.accent
              : tokens.colors.line,
          opacity: disabled || busy ? 0.5 : pressed ? 0.78 : 1,
        },
        typeof style === 'function' ? style({pressed}) : style,
      ]}
      {...props}>
      {busy ? (
        <ActivityIndicator size="small" color={foreground} />
      ) : (
        <Text style={[styles.label, {color: foreground}]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compact: {
    minHeight: 34,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  label: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
});
