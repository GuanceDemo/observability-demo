import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import type {DesignTokens} from '../designTokens';
import type {StoreLanguage} from '../types';
import {AppButton} from './AppButton';

// Ordinary Views keep confirmation in the same input window and Replay tree.
export function CheckoutCrashConfirmation({visible, tokens, language, onCancel, onConfirm}: {
  visible: boolean; tokens: DesignTokens; language: StoreLanguage;
  onCancel: () => void; onConfirm: () => void;
}) {
  if (!visible) return null;
  return (
    <View testID="checkout-crash-confirmation" style={[styles.overlay, {backgroundColor: tokens.colors.overlay}]} accessibilityViewIsModal>
      <View style={[styles.card, {backgroundColor: tokens.colors.surface}]}>
        <Text accessibilityRole="header" style={[styles.title, {color: tokens.colors.text}]}>
          {language === 'en' ? 'Demonstrate checkout crash?' : '触发结算闪退？'}
        </Text>
        <Text style={{color: tokens.colors.muted}}>
          {language === 'en' ? 'The app will exit before placing an order. Restart to inspect the crash.' : 'App 将在提交订单前退出。重启后可查看崩溃记录。'}
        </Text>
        <AppButton tokens={tokens} label={language === 'en' ? 'Confirm crash' : '确认闪退'} onPress={onConfirm} />
        <AppButton tokens={tokens} variant="secondary" label={language === 'en' ? 'Cancel' : '取消'} onPress={onCancel} />
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  overlay: {position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, justifyContent: 'center', padding: 20},
  card: {padding: 20, borderRadius: 14, gap: 18},
  title: {fontSize: 18, fontWeight: '800'},
});
