import React from 'react';
import {Image, Platform, Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {storeText} from '../data';
import type {DesignTokens} from '../designTokens';
import {
  MIN_TOUCH_TARGET_SIZE,
  STOREFRONT_HEADER_ACTION_SIZE,
  STOREFRONT_SHELL_HORIZONTAL_INSET,
} from '../layout';
import type {DemoUser, StoreLanguage, StoreScreen} from '../types';
import {StoreIcon, type StoreIconName} from './StoreIcon';

interface HeaderProps {
  tokens: DesignTokens;
  language: StoreLanguage;
  query: string;
  user: DemoUser | null;
  faultControl?: React.ReactNode;
  onQueryChange: (query: string) => void;
  onToggleLanguage: () => void;
  onAccount: () => void;
}

export function StoreHeader({
  tokens,
  language,
  query,
  user,
  faultControl,
  onQueryChange,
  onToggleLanguage,
  onAccount,
}: HeaderProps) {
  return (
    <View
      testID="store-header"
      style={[
        styles.header,
        {backgroundColor: tokens.colors.surface, borderBottomColor: tokens.colors.line},
      ]}>
      <View style={styles.brandRow}>
        <BrandMark />
        <View style={styles.brandCopy}>
          <Text style={[styles.brandTitle, {color: tokens.colors.text}]}>
            {storeText(language, 'brandTitle')}
          </Text>
          <Text style={[styles.brandSubtitle, {color: tokens.colors.muted}]}>
            {storeText(language, 'brandSubtitle')}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={storeText(language, 'switchLanguage')}
          onPress={onToggleLanguage}
          style={({pressed}) => [
            styles.languageButton,
            {backgroundColor: tokens.colors.accentSoft, borderColor: tokens.colors.line},
            pressed && styles.pressed,
          ]}>
          <Text style={[styles.languageText, {color: tokens.colors.accent}]}>
            {language === 'zh' ? 'EN' : '中'}
          </Text>
        </Pressable>
        {faultControl}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={storeText(language, 'account')}
          onPress={onAccount}
          style={({pressed}) => [
            styles.accountButton,
            {
              backgroundColor: tokens.colors.surface,
              borderColor: tokens.colors.line,
            },
            pressed && styles.pressed,
          ]}>
          <StoreIcon name="user" color={tokens.colors.muted} size={19} />
          {user && <View style={[styles.userDot, {backgroundColor: tokens.colors.success}]} />}
        </Pressable>
      </View>
      <View
        style={[
          styles.search,
          {backgroundColor: tokens.colors.surfaceSoft, borderColor: tokens.colors.line},
        ]}>
        <StoreIcon name="search" color={tokens.colors.muted} size={18} />
        <TextInput
          testID="store-search"
          accessibilityLabel={storeText(language, 'searchLabel')}
          value={query}
          onChangeText={onQueryChange}
          placeholder={storeText(language, 'searchPlaceholder')}
          placeholderTextColor={tokens.colors.muted}
          returnKeyType="search"
          style={[styles.searchInput, {color: tokens.colors.text}]}
        />
        {query.length > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={language === 'en' ? 'Clear search' : '清空搜索'}
            onPress={() => onQueryChange('')}
            style={styles.clearButton}>
            <StoreIcon name="close" color={tokens.colors.muted} size={16} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

function BrandMark() {
  return (
    <View style={styles.mark} accessibilityElementsHidden>
      <Image
        testID="store-brand-mark"
        source={require('../assets/storefront/icons/brand-mark.png')}
        defaultSource={require('../assets/storefront/icons/brand-mark.png')}
        resizeMode="contain"
        fadeDuration={0}
        style={styles.markImage}
      />
    </View>
  );
}

interface BottomNavProps {
  tokens: DesignTokens;
  language: StoreLanguage;
  screen: StoreScreen;
  cartQuantity: number;
  onNavigate: (screen: StoreScreen) => void;
}

const NAV_ITEMS: Array<{
  screen: Extract<StoreScreen, 'home' | 'path' | 'cart'>;
  key: 'navHome' | 'navPath' | 'navCart';
  icon: StoreIconName;
}> = [
  {screen: 'home', key: 'navHome', icon: 'home'},
  {screen: 'path', key: 'navPath', icon: 'path'},
  {screen: 'cart', key: 'navCart', icon: 'cart'},
];

export function StoreBottomNav({
  tokens,
  language,
  screen,
  cartQuantity,
  onNavigate,
}: BottomNavProps) {
  const insets = useSafeAreaInsets();
  const navigationInset = Platform.OS === 'android' ? insets.bottom : 0;
  return (
    <View
      testID="store-bottom-nav"
      accessibilityRole="tablist"
      style={[
        styles.bottomNav,
        {
          backgroundColor: tokens.colors.surface,
          borderTopColor: tokens.colors.line,
          height: 56 + navigationInset,
          paddingBottom: 6 + navigationInset,
        },
      ]}>
      {NAV_ITEMS.map(item => {
        const active = item.screen === screen;
        const color = active ? tokens.colors.accent : tokens.colors.muted;
        return (
          <Pressable
            key={item.screen}
            accessibilityRole="tab"
            accessibilityState={{selected: active}}
            onPress={() => onNavigate(item.screen)}
            style={({pressed}) => [styles.navItem, pressed && styles.pressed]}>
            <View style={styles.navIcon}>
              <StoreIcon name={item.icon} color={color} size={21} />
              {item.screen === 'cart' && cartQuantity > 0 && (
                <View style={[styles.badge, {backgroundColor: tokens.colors.accent}]}>
                  <Text style={styles.badgeText}>
                    {cartQuantity > 99 ? '99+' : cartQuantity}
                  </Text>
                </View>
              )}
            </View>
            <Text style={[styles.navLabel, {color}, active && styles.navLabelActive]}>
              {storeText(language, item.key)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 9,
  },
  brandRow: {
    height: 56,
    paddingHorizontal: STOREFRONT_SHELL_HORIZONTAL_INSET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mark: {
    width: 32,
    height: 32,
    borderRadius: 10,
    overflow: 'hidden',
  },
  markImage: {width: 32, height: 32},
  brandCopy: {flex: 1, minWidth: 0},
  brandTitle: {fontSize: 13, lineHeight: 16, fontWeight: '900'},
  brandSubtitle: {fontSize: 8, lineHeight: 11, fontWeight: '600'},
  languageButton: {
    width: STOREFRONT_HEADER_ACTION_SIZE,
    height: STOREFRONT_HEADER_ACTION_SIZE,
    borderWidth: 1,
    borderRadius: STOREFRONT_HEADER_ACTION_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  languageText: {fontSize: 9, fontWeight: '900'},
  accountButton: {
    width: STOREFRONT_HEADER_ACTION_SIZE,
    height: STOREFRONT_HEADER_ACTION_SIZE,
    borderWidth: 1,
    borderRadius: STOREFRONT_HEADER_ACTION_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userDot: {
    position: 'absolute',
    right: 2,
    top: 3,
    width: 6,
    height: 6,
    borderRadius: 4,
  },
  search: {
    height: MIN_TOUCH_TARGET_SIZE,
    marginHorizontal: STOREFRONT_SHELL_HORIZONTAL_INSET,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    height: MIN_TOUCH_TARGET_SIZE,
    paddingVertical: 0,
    fontSize: 12,
  },
  clearButton: {
    width: MIN_TOUCH_TARGET_SIZE,
    height: MIN_TOUCH_TARGET_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomNav: {
    height: 56,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingTop: 2,
    paddingBottom: 6,
  },
  navItem: {
    flex: 1,
    height: MIN_TOUCH_TARGET_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  navIcon: {position: 'relative'},
  navLabel: {fontSize: 7, lineHeight: 10, fontWeight: '700'},
  navLabelActive: {fontWeight: '900'},
  badge: {
    position: 'absolute',
    left: 14,
    top: -5,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {color: '#fff', fontSize: 8, lineHeight: 10, fontWeight: '900'},
  pressed: {opacity: 0.72, transform: [{scale: 0.97}]},
});
