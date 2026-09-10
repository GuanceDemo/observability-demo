import React, {memo} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {
  formatPrice,
  getProductText,
  topicLabel,
  type StorefrontProduct,
} from '../data';
import type {DesignTokens} from '../designTokens';
import {MIN_TOUCH_TARGET_SIZE} from '../layout';
import type {StoreLanguage} from '../types';
import {BookCover} from './BookCover';
import {StoreIcon} from './StoreIcon';

interface ProductCardProps {
  product: StorefrontProduct;
  language: StoreLanguage;
  tokens: DesignTokens;
  inCart: boolean;
  width: number;
  onOpen: (bookId: string) => void;
  onAdd: (bookId: string) => void;
}

export const ProductCard = memo(function ProductCardView({
  product,
  language,
  tokens,
  inCart,
  width,
  onOpen,
  onAdd,
}: ProductCardProps) {
  const text = getProductText(product, language);
  return (
    <View
      testID={`product-card-${product.id}`}
      style={[
        styles.productCard,
        {width, backgroundColor: tokens.colors.surface, borderColor: tokens.colors.line},
      ]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={text.title}
        onPress={() => onOpen(product.id)}
        style={({pressed}) => [styles.coverButton, pressed && styles.pressed]}>
        <BookCover
          tokens={tokens}
          product={product}
          language={language}
          width={Math.min(92, width - 18)}
        />
      </Pressable>
      <View style={styles.cardCopy}>
        <View style={styles.tags}>
          {product.tags.slice(0, 2).map(tag => (
            <Text
              key={tag}
              numberOfLines={1}
              style={[styles.tag, {color: tokens.colors.accent}]}>
              {topicLabel(tag, language)}
            </Text>
          ))}
        </View>
        <Pressable onPress={() => onOpen(product.id)} style={({pressed}) => pressed && styles.pressed}>
          <Text
            numberOfLines={2}
            style={[styles.cardTitle, {color: tokens.colors.text}]}>
            {text.title}
          </Text>
        </Pressable>
        <Text numberOfLines={1} style={[styles.author, {color: tokens.colors.muted}]}>
          {text.authorShort}
        </Text>
        <View style={styles.ratingRow}>
          <Text style={[styles.stars, {color: tokens.colors.orange}]}>★★★★★</Text>
          <Text style={[styles.rating, {color: tokens.colors.muted}]}>
            {product.rating}
          </Text>
        </View>
        <View style={styles.cardFooter}>
          <Text style={[styles.price, {color: tokens.colors.text}]}>
            {formatPrice(product.amountCent, language)}
          </Text>
          <Pressable
            testID={`add-${product.id}`}
            accessibilityRole="button"
            accessibilityLabel={inCart ? 'in cart' : 'add to cart'}
            onPress={() => onAdd(product.id)}
            style={({pressed}) => [
              styles.addButton,
              {backgroundColor: inCart ? tokens.colors.success : tokens.colors.accent},
              pressed && styles.pressed,
            ]}>
            <StoreIcon
              name={inCart ? 'check' : 'plus'}
              color={tokens.colors.onAccent}
              size={16}
            />
          </Pressable>
        </View>
      </View>
    </View>
  );
});

interface QuantityStepperProps {
  quantity: number;
  tokens: DesignTokens;
  decreaseLabel: string;
  increaseLabel: string;
  onChange: (quantity: number) => void;
  compact?: boolean;
}

export function QuantityStepper({
  quantity,
  tokens,
  decreaseLabel,
  increaseLabel,
  onChange,
  compact = false,
}: QuantityStepperProps) {
  return (
    <View
      style={[
        styles.stepper,
        compact && styles.stepperCompact,
        {borderColor: tokens.colors.line, backgroundColor: tokens.colors.surface},
      ]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={decreaseLabel}
        onPress={() => onChange(quantity - 1)}
        style={[styles.stepperButton, {borderColor: tokens.colors.line, backgroundColor: tokens.colors.surface}]}>
        <StoreIcon name="minus" color={tokens.colors.text} size={15} />
      </Pressable>
      <Text style={[styles.stepperValue, {color: tokens.colors.text}]}>{quantity}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={increaseLabel}
        onPress={() => onChange(quantity + 1)}
        style={[styles.stepperButton, {borderColor: tokens.colors.line, backgroundColor: tokens.colors.surface}]}>
        <StoreIcon name="plus" color={tokens.colors.text} size={15} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  productCard: {
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  coverButton: {
    padding: 9,
    alignItems: 'center',
  },
  cardCopy: {
    paddingHorizontal: 9,
    paddingBottom: 9,
  },
  tags: {
    minHeight: 15,
    flexDirection: 'row',
    gap: 5,
  },
  tag: {
    flexShrink: 1,
    fontSize: 7,
    lineHeight: 10,
    fontWeight: '800',
  },
  cardTitle: {
    minHeight: 30,
    marginTop: 2,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
  },
  author: {
    marginTop: 2,
    fontSize: 8,
    lineHeight: 11,
  },
  ratingRow: {
    marginTop: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  stars: {
    fontSize: 8,
    letterSpacing: -1,
  },
  rating: {
    fontSize: 8,
    fontWeight: '700',
  },
  cardFooter: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  price: {
    flex: 1,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
  },
  addButton: {
    width: MIN_TOUCH_TARGET_SIZE,
    height: MIN_TOUCH_TARGET_SIZE,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.78,
    transform: [{scale: 0.97}],
  },
  stepper: {
    height: MIN_TOUCH_TARGET_SIZE,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stepperCompact: {
    height: MIN_TOUCH_TARGET_SIZE,
  },
  stepperButton: {
    width: MIN_TOUCH_TARGET_SIZE,
    height: '100%',
    borderWidth: 1,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: {
    minWidth: 18,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '900',
  },
});
