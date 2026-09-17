import React from 'react';
import {StyleSheet, View} from 'react-native';
import type {StorefrontProduct} from '../data';
import type {DesignTokens} from '../designTokens';
import type {StoreLanguage} from '../types';

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
    return <View testID="detail-white-screen" style={styles.blank} />;
  }
}

export function withMissingDetailDescription(product: StorefrontProduct, language: StoreLanguage): StorefrontProduct {
  // Deliberately violate the business model only for the armed render scenario.
  // The normal DetailScreen access produces the actual TypeError and its stack.
  return {...product, [language]: {...product[language], description: undefined}} as unknown as StorefrontProduct;
}

const styles = StyleSheet.create({blank: {flex: 1, backgroundColor: '#ffffff'}});
