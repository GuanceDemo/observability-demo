import React from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {AppButton} from '../components/AppButton';
import {BookCover} from '../components/BookCover';
import {BOOK} from '../data';
import {STOREFRONT_PAGE_HORIZONTAL_INSET} from '../layout';
import type {ThemeTokens} from '../theme';

interface Props {
  tokens: ThemeTokens;
  cartQuantity: number;
  busy: boolean;
  onBrowse: () => void;
  onRemove: () => void;
  onPurchase: () => void;
  onBatchPurchase: () => void;
}

export function BagScreen({
  tokens,
  cartQuantity,
  busy,
  onBrowse,
  onRemove,
  onPurchase,
  onBatchPurchase,
}: Props) {
  const hasItem = cartQuantity > 0;
  return (
    <ScrollView
      testID="bag-screen"
      contentContainerStyle={styles.content}
      style={{backgroundColor: tokens.colors.background}}
      showsVerticalScrollIndicator={false}>
      <Text style={[styles.eyebrow, {color: tokens.colors.accent}]}>
        已选图书
      </Text>
      <Text style={[styles.title, {color: tokens.colors.text}]}>购物袋</Text>
      <Text style={[styles.description, {color: tokens.colors.muted}]}>
        检查已选图书和金额，然后完成购买。
      </Text>

      {!hasItem ? (
        <View
          style={[
            styles.empty,
            {
              backgroundColor: tokens.colors.surface,
              borderColor: tokens.colors.line,
            },
          ]}>
          <View
            style={[
              styles.emptyMark,
              {
                borderColor: tokens.colors.line,
                backgroundColor: tokens.colors.surfaceSoft,
              },
            ]}>
            <Text style={[styles.emptyGlyph, {color: tokens.colors.accent}]}>
              BAG
            </Text>
          </View>
          <Text style={[styles.emptyTitle, {color: tokens.colors.text}]}>
            购物袋还是空的
          </Text>
          <Text style={[styles.emptyDescription, {color: tokens.colors.muted}]}>
            浏览本周推荐，把想读的书加入购物袋。
          </Text>
          <AppButton
            label="查看本书"
            tokens={tokens}
            onPress={onBrowse}
            style={styles.emptyButton}
          />
        </View>
      ) : (
        <>
          <View
            testID="bag-item"
            style={[
              styles.item,
              {
                backgroundColor: tokens.colors.surface,
                borderColor: tokens.colors.line,
              },
            ]}>
            <BookCover tokens={tokens} compact />
            <View style={styles.itemCopy}>
              <Text style={[styles.itemTitle, {color: tokens.colors.text}]}>
                {BOOK.name}
              </Text>
              <Text style={[styles.itemMeta, {color: tokens.colors.muted}]}>
                {BOOK.author} · {BOOK.note}
              </Text>
              <Text style={[styles.itemPrice, {color: tokens.colors.text}]}>
                {BOOK.price}
              </Text>
              <AppButton
                label="移出购物袋"
                tokens={tokens}
                variant="ghost"
                compact
                onPress={onRemove}
                style={styles.removeButton}
              />
            </View>
          </View>
          <View
            style={[
              styles.summary,
              {
                backgroundColor: tokens.colors.surface,
                borderColor: tokens.colors.line,
              },
            ]}>
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, {color: tokens.colors.muted}]}>
                已选商品
              </Text>
              <Text style={[styles.summaryValue, {color: tokens.colors.text}]}>
                {BOOK.name}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, {color: tokens.colors.muted}]}>
                小计
              </Text>
              <Text style={[styles.total, {color: tokens.colors.text}]}>
                {BOOK.price}
              </Text>
            </View>
            <AppButton
              label="购买这本书"
              tokens={tokens}
              busy={busy}
              onPress={onPurchase}
              style={styles.purchaseButton}
            />
          </View>
        </>
      )}

      <View
        style={[
          styles.demoActions,
          {
            backgroundColor: tokens.colors.surfaceSoft,
            borderColor: tokens.colors.line,
          },
        ]}>
        <Text style={[styles.demoTitle, {color: tokens.colors.text}]}>
          演示流量
        </Text>
        <Text style={[styles.demoDescription, {color: tokens.colors.muted}]}>
          不改变正常购买流程，一次生成 5 条可观测链路。
        </Text>
        <AppButton
          label="批量购买 5 次"
          tokens={tokens}
          variant="secondary"
          busy={busy}
          onPress={onBatchPurchase}
          style={styles.batchButton}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: 14,
    paddingHorizontal: STOREFRONT_PAGE_HORIZONTAL_INSET,
    paddingBottom: 80,
  },
  eyebrow: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  title: {
    marginTop: 6,
    fontSize: 30,
    lineHeight: 38,
    fontWeight: '900',
  },
  description: {
    marginTop: 7,
    fontSize: 14,
    lineHeight: 21,
  },
  empty: {
    marginTop: 22,
    padding: 28,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: 'center',
  },
  emptyMark: {
    width: 72,
    height: 72,
    borderWidth: 1,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyGlyph: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
  },
  emptyTitle: {
    marginTop: 18,
    fontSize: 19,
    fontWeight: '900',
  },
  emptyDescription: {
    marginTop: 7,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  emptyButton: {
    marginTop: 18,
    minWidth: 150,
  },
  item: {
    marginTop: 22,
    padding: 18,
    borderWidth: 1,
    borderRadius: 14,
    flexDirection: 'row',
    gap: 12,
  },
  itemCopy: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '900',
  },
  itemMeta: {
    marginTop: 5,
    fontSize: 11,
    lineHeight: 16,
  },
  itemPrice: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: '900',
  },
  removeButton: {
    alignSelf: 'flex-start',
    marginTop: 5,
    marginLeft: -10,
  },
  summary: {
    marginTop: 12,
    padding: 18,
    borderWidth: 1,
    borderRadius: 14,
  },
  summaryRow: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  summaryLabel: {
    fontSize: 12,
  },
  summaryValue: {
    flex: 1,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'right',
  },
  total: {
    fontSize: 19,
    fontWeight: '900',
  },
  purchaseButton: {
    marginTop: 14,
  },
  demoActions: {
    marginTop: 18,
    padding: 16,
    borderWidth: 1,
    borderRadius: 14,
  },
  demoTitle: {
    fontSize: 15,
    fontWeight: '900',
  },
  demoDescription: {
    marginTop: 5,
    fontSize: 12,
    lineHeight: 18,
  },
  batchButton: {
    marginTop: 13,
  },
});
