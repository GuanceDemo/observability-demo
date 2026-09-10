import React from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {formatPrice, getProductText} from '../data';
import type {DesignTokens} from '../designTokens';
import type {CartLine} from '../store';
import type {StoreLanguage} from '../types';
import {AppButton} from './AppButton';

export function CheckoutPreview({visible, lines, amountCent, tokens, language, onClose}: {
  visible: boolean; lines: CartLine[]; amountCent: number; tokens: DesignTokens;
  language: StoreLanguage; onClose: () => void;
}) {
  if (!visible) return null;
  return (
    <View testID="checkout-preview" style={[styles.overlay, {backgroundColor: tokens.colors.overlay}]} accessibilityViewIsModal>
      <View style={[styles.card, {backgroundColor: tokens.colors.surface}]}>
        <Text style={[styles.title, {color: tokens.colors.text}]}>{language === 'en' ? 'Review checkout' : '结算明细'}</Text>
        <ScrollView>
          {lines.map(({product, quantity, lineAmountCent}) => (
            <View key={product.id} style={styles.line}>
              <Text style={[styles.label, {color: tokens.colors.text}]}>{getProductText(product, language).title} × {quantity}</Text>
              <Text style={{color: tokens.colors.muted}}>{formatPrice(lineAmountCent, language)}</Text>
            </View>
          ))}
        </ScrollView>
        <Text style={[styles.title, {color: tokens.colors.text}]}>{formatPrice(amountCent, language)}</Text>
        <AppButton tokens={tokens} label={language === 'en' ? 'Return to cart' : '返回购物车'} onPress={onClose} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, justifyContent: 'center', padding: 20},
  card: {padding: 20, borderRadius: 14, gap: 18, maxHeight: '80%'},
  title: {fontSize: 18, fontWeight: '800'},
  line: {paddingVertical: 10, gap: 6},
  label: {fontSize: 13, lineHeight: 20},
});
