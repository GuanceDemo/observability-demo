import React from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';
import {PRODUCTS, getProductText, type StorefrontProduct} from '../data';
import type {DesignTokens} from '../designTokens';
import type {StoreLanguage} from '../types';
import {primaryCoverAssets} from '../storefrontAssets';

interface Props {
  tokens: DesignTokens;
  product?: StorefrontProduct;
  language?: StoreLanguage;
  compact?: boolean;
  width?: number;
}

export function BookCover({
  tokens,
  product = PRODUCTS[0],
  language = 'zh',
  compact = false,
  width,
}: Props) {
  const coverWidth = width ?? (compact ? 64 : 180);
  const small = coverWidth <= 100;
  const tiny = coverWidth <= 48;
  const text = getProductText(product, language);
  if (product.id === 'observability-engineering') {
    return (
      <Image
        testID={compact ? 'bag-book-cover' : 'book-cover'}
        accessibilityLabel={
          language === 'en'
            ? `${text.title} book cover`
            : `《${text.title}》封面`
        }
        source={primaryCoverAssets[language]}
        resizeMode="cover"
        style={[
          styles.cover,
          compact && styles.compact,
          small && styles.smallCover,
          {width: coverWidth, height: coverWidth / 0.75},
        ]}
      />
    );
  }

  const palette =
    'cover' in product && Array.isArray(product.cover)
      ? product.cover
      : ['#30283d', '#fff8f0', tokens.colors.accent];
  const background = String(palette[0]);
  const foreground = String(palette[1]);
  const accent = String(palette[2]);
  return (
    <View
      testID={compact ? 'bag-book-cover' : 'book-cover'}
      accessibilityRole="image"
      accessibilityLabel={text.title}
      style={[
        styles.cover,
        styles.generated,
        compact && styles.compact,
        small && styles.smallCover,
        small && styles.generatedSmall,
        tiny && styles.generatedTiny,
        {
          width: coverWidth,
          height: coverWidth / 0.75,
          backgroundColor: background,
          borderColor: accent,
        },
      ]}>
      <View style={[styles.orb, {backgroundColor: accent}]} />
      <View style={[styles.slash, {backgroundColor: foreground}]} />
      <Text
        allowFontScaling={false}
        numberOfLines={1}
        style={[styles.kicker, {color: accent}]}>
        {text.badge.toUpperCase()}
      </Text>
      <Text
        allowFontScaling={false}
        numberOfLines={compact ? 3 : 4}
        style={[
          styles.generatedTitle,
          compact && styles.compactTitle,
          small && styles.smallTitle,
          tiny && styles.tinyTitle,
          {color: foreground},
        ]}>
        {text.shortTitle}
      </Text>
      {!compact && (
        <Text
          allowFontScaling={false}
          numberOfLines={2}
          style={[styles.author, small && styles.smallAuthor, {color: foreground}]}>
          {text.authorShort}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#fff4f1',
  },
  compact: {
    borderRadius: 7,
  },
  smallCover: {
    borderRadius: 8,
  },
  generated: {
    borderWidth: 2,
    padding: 12,
  },
  generatedSmall: {
    padding: 8,
    borderWidth: 1.5,
  },
  generatedTiny: {
    padding: 4,
    borderWidth: 1,
  },
  orb: {
    position: 'absolute',
    width: '62%',
    aspectRatio: 1,
    right: '-18%',
    bottom: '-6%',
    borderRadius: 999,
    opacity: 0.52,
  },
  slash: {
    position: 'absolute',
    width: '120%',
    height: 2,
    left: '-10%',
    top: '62%',
    opacity: 0.23,
    transform: [{rotate: '-24deg'}],
  },
  kicker: {
    fontSize: 7,
    lineHeight: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  generatedTitle: {
    marginTop: 25,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '900',
  },
  compactTitle: {
    marginTop: 8,
    fontSize: 8,
    lineHeight: 10,
  },
  smallTitle: {
    marginTop: 15,
    fontSize: 12,
    lineHeight: 15,
  },
  tinyTitle: {
    marginTop: 4,
    fontSize: 5,
    lineHeight: 6,
  },
  author: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 14,
    fontSize: 8,
    lineHeight: 11,
    fontWeight: '700',
    opacity: 0.82,
  },
  smallAuthor: {
    left: 8,
    right: 8,
    bottom: 8,
    fontSize: 6,
    lineHeight: 8,
  },
});
