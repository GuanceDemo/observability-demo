import React from 'react';
import {Image} from 'react-native';

export type StoreIconName =
  | 'home'
  | 'path'
  | 'cart'
  | 'search'
  | 'user'
  | 'close'
  | 'back'
  | 'book'
  | 'fault'
  | 'check'
  | 'minus'
  | 'plus';

interface Props {
  name: StoreIconName;
  color: string;
  size?: number;
}

type IconTone =
  | 'accent'
  | 'muted'
  | 'text'
  | 'white'
  | 'success'
  | 'danger'
  | 'avatar';

type IconAssetSet = {
  default: number;
} & Partial<Record<IconTone, number>>;

const ICON_TONE_BY_COLOR: Record<string, IconTone> = {
  '#ff3856': 'accent',
  '#71666f': 'muted',
  '#24152f': 'text',
  '#ffffff': 'white',
  '#12805c': 'success',
  '#d92d20': 'danger',
  '#735f77': 'avatar',
};

// These are ordinary bundled image resources instead of an SvgView tree.
// The Android Session Replay bridge records ReactImageView but does not map
// react-native-svg's SvgView/PathView hierarchy.
const ICON_ASSETS: Record<StoreIconName, IconAssetSet> = {
  home: {
    default: require('../assets/storefront/icons/home-muted.png'),
    accent: require('../assets/storefront/icons/home-accent.png'),
    muted: require('../assets/storefront/icons/home-muted.png'),
  },
  path: {
    default: require('../assets/storefront/icons/path-muted.png'),
    accent: require('../assets/storefront/icons/path-accent.png'),
    muted: require('../assets/storefront/icons/path-muted.png'),
  },
  cart: {
    default: require('../assets/storefront/icons/cart-muted.png'),
    accent: require('../assets/storefront/icons/cart-accent.png'),
    muted: require('../assets/storefront/icons/cart-muted.png'),
  },
  search: {
    default: require('../assets/storefront/icons/search-muted.png'),
    accent: require('../assets/storefront/icons/search-accent.png'),
    muted: require('../assets/storefront/icons/search-muted.png'),
  },
  user: {
    default: require('../assets/storefront/icons/user-muted.png'),
    muted: require('../assets/storefront/icons/user-muted.png'),
    avatar: require('../assets/storefront/icons/user-avatar.png'),
  },
  close: {
    default: require('../assets/storefront/icons/close-text.png'),
    muted: require('../assets/storefront/icons/close-muted.png'),
    text: require('../assets/storefront/icons/close-text.png'),
  },
  back: {
    default: require('../assets/storefront/icons/back-muted.png'),
    muted: require('../assets/storefront/icons/back-muted.png'),
  },
  book: {
    default: require('../assets/storefront/icons/book-muted.png'),
    accent: require('../assets/storefront/icons/book-accent.png'),
    muted: require('../assets/storefront/icons/book-muted.png'),
    white: require('../assets/storefront/icons/book-white.png'),
  },
  fault: {
    default: require('../assets/storefront/icons/fault-accent.png'),
    accent: require('../assets/storefront/icons/fault-accent.png'),
    danger: require('../assets/storefront/icons/fault-danger.png'),
    white: require('../assets/storefront/icons/fault-white.png'),
  },
  check: {
    default: require('../assets/storefront/icons/check-success.png'),
    success: require('../assets/storefront/icons/check-success.png'),
    white: require('../assets/storefront/icons/check-white.png'),
  },
  minus: {
    default: require('../assets/storefront/icons/minus-text.png'),
    text: require('../assets/storefront/icons/minus-text.png'),
  },
  plus: {
    default: require('../assets/storefront/icons/plus-text.png'),
    text: require('../assets/storefront/icons/plus-text.png'),
    white: require('../assets/storefront/icons/plus-white.png'),
  },
};

export function StoreIcon({name, color, size = 22}: Props) {
  const assets = ICON_ASSETS[name];
  const tone = ICON_TONE_BY_COLOR[color.toLowerCase()];
  const source = (tone && assets[tone]) || assets.default;

  return (
    <Image
      testID={`store-icon-${name}`}
      source={source}
      defaultSource={source}
      resizeMode="contain"
      fadeDuration={0}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{width: size, height: size}}
    />
  );
}
