import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {ThemeTokens} from '../theme';
import type {StoreScreen, ThemeName} from '../types';

interface Props {
  tokens: ThemeTokens;
  screen: StoreScreen;
  cartQuantity: number;
  onNavigate: (screen: StoreScreen) => void;
  onThemeChange: (theme: ThemeName) => void;
}

const NAV_ITEMS: {screen: StoreScreen; label: string}[] = [
  {screen: 'home', label: '首页'},
  {screen: 'detail', label: '本书'},
  {screen: 'purchase', label: '购物袋'},
];

export function StoreHeader({
  tokens,
  screen,
  cartQuantity,
  onNavigate,
  onThemeChange,
}: Props) {
  const nextTheme = tokens.name === 'colorful' ? 'white' : 'colorful';
  return (
    <View
      style={[
        styles.header,
        {
          backgroundColor: tokens.colors.surface,
          borderBottomColor: tokens.colors.line,
        },
      ]}>
      <View style={styles.brandRow}>
        <View
          style={[styles.mark, {backgroundColor: tokens.colors.accent}]}>
          <View style={styles.markLine} />
          <View style={[styles.markDot, styles.dotOne]} />
          <View style={[styles.markDot, styles.dotTwo]} />
          <View style={[styles.markDot, styles.dotThree]} />
        </View>
        <View style={styles.brandCopy}>
          <Text style={[styles.brandTitle, {color: tokens.colors.text}]}>
            商城 Demo
          </Text>
          <Text style={[styles.brandSubtitle, {color: tokens.colors.muted}]}>
            图书商城
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`切换为${nextTheme === 'white' ? '黑白线条' : '绚彩'}主题`}
          onPress={() => onThemeChange(nextTheme)}
          style={({pressed}) => [
            styles.themeButton,
            {
              borderColor: tokens.colors.line,
              backgroundColor: tokens.colors.surface,
              opacity: pressed ? 0.7 : 1,
            },
          ]}>
          <View
            style={[
              styles.themeSwatch,
              {
                backgroundColor:
                  tokens.name === 'colorful'
                    ? tokens.colors.accent
                    : tokens.colors.text,
              },
            ]}
          />
          <Text style={[styles.themeLabel, {color: tokens.colors.text}]}>
            {tokens.name === 'colorful' ? '绚彩' : '黑白'}
          </Text>
        </Pressable>
      </View>
      <View style={styles.nav} accessibilityRole="tablist">
        {NAV_ITEMS.map(item => {
          const active = item.screen === screen;
          return (
            <Pressable
              key={item.screen}
              accessibilityRole="tab"
              accessibilityState={{selected: active}}
              onPress={() => onNavigate(item.screen)}
              style={({pressed}) => [
                styles.navItem,
                {
                  backgroundColor: active
                    ? tokens.colors.accentSoft
                    : 'transparent',
                  opacity: pressed ? 0.72 : 1,
                },
              ]}>
              <Text
                style={[
                  styles.navLabel,
                  {
                    color: active
                      ? tokens.colors.accent
                      : tokens.colors.muted,
                  },
                ]}>
                {item.label}
              </Text>
              {item.screen === 'purchase' && cartQuantity > 0 && (
                <View
                  style={[
                    styles.badge,
                    {backgroundColor: tokens.colors.accent},
                  ]}>
                  <Text style={styles.badgeText}>{cartQuantity}</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  brandRow: {
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mark: {
    width: 32,
    height: 32,
    borderRadius: 9,
    overflow: 'hidden',
  },
  markLine: {
    position: 'absolute',
    left: 7,
    top: 15,
    width: 19,
    height: 2,
    backgroundColor: '#fff',
    transform: [{rotate: '-24deg'}],
  },
  markDot: {
    position: 'absolute',
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#fff',
  },
  dotOne: {left: 6, top: 19},
  dotTwo: {left: 14, top: 12},
  dotThree: {right: 5, top: 8},
  brandCopy: {
    flex: 1,
  },
  brandTitle: {
    fontSize: 15,
    lineHeight: 18,
    fontWeight: '900',
  },
  brandSubtitle: {
    marginTop: 1,
    fontSize: 10,
    lineHeight: 13,
  },
  themeButton: {
    minHeight: 32,
    paddingHorizontal: 9,
    borderWidth: 1,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  themeSwatch: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  themeLabel: {
    fontSize: 11,
    fontWeight: '800',
  },
  nav: {
    minHeight: 42,
    paddingHorizontal: 10,
    paddingBottom: 7,
    flexDirection: 'row',
    gap: 3,
  },
  navItem: {
    flex: 1,
    minHeight: 34,
    borderRadius: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  navLabel: {
    fontSize: 11,
    fontWeight: '800',
  },
  badge: {
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#fff',
    fontSize: 9,
    lineHeight: 11,
    fontWeight: '900',
  },
});
