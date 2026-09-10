import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import type {StorefrontProduct} from '../data';
import type {DesignTokens} from '../designTokens';
import type {StoreLanguage} from '../types';
import {AppButton} from './AppButton';

interface Props {
  children: React.ReactNode;
  tokens: DesignTokens;
  language: StoreLanguage;
  onBack: () => void;
  onRetry: () => void;
  onError: (error: Error, componentStack: string) => void;
}

export class DetailFaultBoundary extends React.Component<Props, {failed: boolean}> {
  state = {failed: false};

  static getDerivedStateFromError() { return {failed: true}; }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // React Native's caught-error handler already feeds the SDK console hook.
    // Keep the original stack in a business log without duplicating the RUM error.
    this.props.onError(error, info.componentStack ?? '');
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const {tokens, language, onBack, onRetry} = this.props;
    return (
      <View testID="detail-error" style={[styles.card, {backgroundColor: tokens.colors.surface, borderColor: tokens.colors.line}]}>
        <Text style={[styles.title, {color: tokens.colors.text}]}>
          {language === 'en' ? 'This book could not be displayed' : '这本图书暂时无法显示'}
        </Text>
        <Text style={[styles.body, {color: tokens.colors.muted}]}>
          {language === 'en' ? 'Reload the details or return to the bookstore.' : '请重新加载详情，或返回书店继续浏览。'}
        </Text>
        <AppButton tokens={tokens} label={language === 'en' ? 'Reload details' : '重新加载详情'} onPress={onRetry} />
        <AppButton tokens={tokens} variant="secondary" label={language === 'en' ? 'Back to bookstore' : '返回书店'} onPress={onBack} />
      </View>
    );
  }
}

export function withMissingDetailDescription(product: StorefrontProduct, language: StoreLanguage): StorefrontProduct {
  // Deliberately violate the business model only for the armed render scenario.
  // The normal DetailScreen access produces the actual TypeError and its stack.
  return {...product, [language]: {...product[language], description: undefined}} as unknown as StorefrontProduct;
}

const styles = StyleSheet.create({
  card: {margin: 16, padding: 20, borderWidth: 1, borderRadius: 12, gap: 14},
  title: {fontSize: 18, lineHeight: 25, fontWeight: '800'},
  body: {fontSize: 13, lineHeight: 21},
});
