import React from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {AppButton} from '../components/AppButton';
import {BookCover} from '../components/BookCover';
import {BOOK} from '../data';
import {STOREFRONT_PAGE_HORIZONTAL_INSET} from '../layout';
import type {DesignTokens} from '../designTokens';

interface Props {
  tokens: DesignTokens;
  inCart: boolean;
  onBack: () => void;
  onToggleCart: () => void;
  onBuy: () => void;
}

export function DetailScreen({
  tokens,
  inCart,
  onBack,
  onToggleCart,
  onBuy,
}: Props) {
  return (
    <ScrollView
      testID="detail-screen"
      contentContainerStyle={styles.content}
      style={{backgroundColor: tokens.colors.background}}
      showsVerticalScrollIndicator={false}>
      <AppButton
        label="‹ 返回首页"
        tokens={tokens}
        variant="ghost"
        compact
        onPress={onBack}
        style={styles.back}
      />
      <View style={styles.coverWrap}>
        <BookCover tokens={tokens} />
      </View>
      <View style={styles.copy}>
        <View style={styles.metaRow}>
          <Text style={[styles.badge, {color: tokens.colors.accent}]}>
            {BOOK.badge}
          </Text>
          <Text style={[styles.price, {color: tokens.colors.text}]}>
            {BOOK.price}
          </Text>
        </View>
        <Text style={[styles.title, {color: tokens.colors.text}]}>
          {BOOK.name}
        </Text>
        <Text style={[styles.tagline, {color: tokens.colors.muted}]}>
          {BOOK.tagline}
        </Text>
        <View
          style={[
            styles.infoGrid,
            {
              backgroundColor: tokens.colors.surface,
              borderColor: tokens.colors.line,
            },
          ]}>
          <Info label="作者" value={BOOK.author} tokens={tokens} />
          <Info label="版本" value={BOOK.edition} tokens={tokens} />
          <Info label="装帧" value={BOOK.note} tokens={tokens} />
        </View>
        <Text style={[styles.sectionTitle, {color: tokens.colors.text}]}>
          内容简介
        </Text>
        <Text style={[styles.body, {color: tokens.colors.muted}]}>
          这本书从真实系统的不确定性出发，解释如何用高基数事件、分布式链路、日志和用户体验数据理解复杂软件，并将调试能力变成团队的日常工程实践。
        </Text>
        <Text style={[styles.sectionTitle, {color: tokens.colors.text}]}>
          本书亮点
        </Text>
        <View style={styles.bullets}>
          {BOOK.bullets.map(item => (
            <View key={item} style={styles.bulletRow}>
              <View
                style={[styles.bullet, {backgroundColor: tokens.colors.accent}]}
              />
              <Text style={[styles.body, styles.bulletText, {color: tokens.colors.text}]}>
                {item}
              </Text>
            </View>
          ))}
        </View>
        <View style={styles.buttonRow}>
          <AppButton
            label="立即购买"
            tokens={tokens}
            onPress={onBuy}
          />
          <AppButton
            label={inCart ? '已在购物袋' : '加入购物袋'}
            tokens={tokens}
            variant="secondary"
            onPress={onToggleCart}
          />
        </View>
      </View>
    </ScrollView>
  );
}

function Info({
  label,
  value,
  tokens,
}: {
  label: string;
  value: string;
  tokens: DesignTokens;
}) {
  return (
    <View style={styles.info}>
      <Text style={[styles.infoLabel, {color: tokens.colors.muted}]}>
        {label}
      </Text>
      <Text style={[styles.infoValue, {color: tokens.colors.text}]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: 14,
    paddingHorizontal: STOREFRONT_PAGE_HORIZONTAL_INSET,
    paddingBottom: 80,
  },
  back: {
    alignSelf: 'flex-start',
    marginLeft: -10,
  },
  coverWrap: {
    marginTop: 8,
    alignItems: 'center',
  },
  copy: {
    marginTop: 24,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  badge: {
    fontSize: 11,
    fontWeight: '900',
  },
  price: {
    fontSize: 18,
    fontWeight: '900',
  },
  title: {
    marginTop: 10,
    fontSize: 29,
    lineHeight: 36,
    fontWeight: '900',
  },
  tagline: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 22,
  },
  infoGrid: {
    marginTop: 20,
    padding: 14,
    borderWidth: 1,
    borderRadius: 14,
    flexDirection: 'row',
    gap: 10,
  },
  info: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 10,
    lineHeight: 14,
  },
  infoValue: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
  },
  sectionTitle: {
    marginTop: 24,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '900',
  },
  body: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 21,
  },
  bullets: {
    marginTop: 5,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  bullet: {
    width: 6,
    height: 6,
    marginTop: 15,
    borderRadius: 3,
  },
  bulletText: {
    flex: 1,
  },
  buttonRow: {
    marginTop: 26,
    gap: 9,
  },
});
