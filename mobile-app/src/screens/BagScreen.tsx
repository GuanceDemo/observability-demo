import React from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {
  formatPrice,
  getProductText,
  storeText,
} from '../data';
import type {DesignTokens} from '../designTokens';
import type {CartLine} from '../store';
import type {StoreLanguage} from '../types';
import {AppButton} from '../components/AppButton';
import {BookCover} from '../components/BookCover';
import {QuantityStepper} from '../components/Commerce';
import {StoreIcon} from '../components/StoreIcon';

interface Props {
  tokens: DesignTokens;
  language: StoreLanguage;
  lines: CartLine[];
  selectedCopies: number;
  amountCent: number;
  busy: boolean;
  onBrowse: () => void;
  onOpenBook: (bookId: string) => void;
  onToggleSelection: (bookId: string) => void;
  onSelectAll: (selected: boolean) => void;
  onRemoveSelected: () => void;
  onQuantityChange: (bookId: string, quantity: number) => void;
  onRemove: (bookId: string) => void;
  onPurchase: () => void;
  onBatchPurchase: () => void;
  onPreview?: () => void;
  checkoutBlocked?: boolean;
  onRefreshTotal?: () => void;
}

export function BagScreen({
  tokens,
  language,
  lines,
  selectedCopies,
  amountCent,
  busy,
  onBrowse,
  onOpenBook,
  onToggleSelection,
  onSelectAll,
  onRemoveSelected,
  onQuantityChange,
  onRemove,
  onPurchase,
  onBatchPurchase,
  onPreview,
  checkoutBlocked = false,
  onRefreshTotal,
}: Props) {
  const hasItems = lines.length > 0;
  const allSelected = hasItems && lines.every(line => line.selected);
  return (
    <ScrollView
      testID="bag-screen"
      style={{backgroundColor: tokens.colors.background}}
      contentContainerStyle={styles.content}
      overScrollMode="never"
      showsVerticalScrollIndicator={false}>
      <View
        style={[
          styles.cartHero,
          {backgroundColor: tokens.colors.surfaceSoft, borderColor: tokens.colors.line},
        ]}>
        <View style={[styles.heroOrb, {borderColor: tokens.colors.purple}]} />
        <Text style={[styles.eyebrow, {color: tokens.colors.accent}]}>
          {storeText(language, 'cartEyebrow')}
        </Text>
        <Text style={[styles.title, {color: tokens.colors.text}]}>
          {storeText(language, 'cartTitle')}
        </Text>
        <Text style={[styles.description, {color: tokens.colors.muted}]}>
          {storeText(language, 'cartDescription')}
        </Text>
      </View>

      {!hasItems ? (
        <View
          testID="cart-empty"
          style={[
            styles.empty,
            {backgroundColor: tokens.colors.surface, borderColor: tokens.colors.line},
          ]}>
          <View style={[styles.emptyIcon, {backgroundColor: tokens.colors.accentSoft}]}>
            <StoreIcon name="cart" color={tokens.colors.accent} size={32} />
          </View>
          <Text style={[styles.emptyTitle, {color: tokens.colors.text}]}>
            {storeText(language, 'cartEmpty')}
          </Text>
          <Text style={[styles.emptyHint, {color: tokens.colors.muted}]}>
            {storeText(language, 'cartEmptyHint')}
          </Text>
          <AppButton
            label={storeText(language, 'continueShopping')}
            tokens={tokens}
            onPress={onBrowse}
            style={styles.browseButton}
          />
        </View>
      ) : (
        <>
          <View
            style={[
              styles.commerce,
              {backgroundColor: tokens.colors.surface, borderColor: tokens.colors.line},
            ]}>
            <View style={styles.items}>
              {lines.map(line => {
              const text = getProductText(line.product, language);
              return (
                <View
                  key={line.product.id}
                  testID={`cart-line-${line.product.id}`}
                  style={[
                    styles.item,
                    {
                      backgroundColor: tokens.colors.surface,
                      borderColor: tokens.colors.line,
                    },
                  ]}>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{checked: line.selected}}
                    onPress={() => onToggleSelection(line.product.id)}
                    style={styles.selectBoxWrap}>
                    <SelectionBox selected={line.selected} tokens={tokens} />
                  </Pressable>
                  <View style={styles.itemCopy}>
                    <Pressable onPress={() => onOpenBook(line.product.id)}>
                      <Text numberOfLines={2} style={[styles.itemTitle, {color: tokens.colors.text}]}>
                        {text.title}
                      </Text>
                    </Pressable>
                    <Text numberOfLines={2} style={[styles.itemMeta, {color: tokens.colors.muted}]}>
                      {text.authorShort} · {storeText(language, 'format')} · {text.badge}
                    </Text>
                    <View style={styles.stockRow}>
                      <View style={[styles.stockDot, {backgroundColor: tokens.colors.success}]} />
                      <Text style={[styles.stockText, {color: tokens.colors.success}]}>
                        {storeText(language, 'inStockShort')}
                      </Text>
                    </View>
                  </View>
                  <Pressable
                    onPress={() => onOpenBook(line.product.id)}
                    style={({pressed}) => [styles.itemCover, pressed && styles.pressed]}>
                    <BookCover
                      tokens={tokens}
                      product={line.product}
                      language={language}
                      compact
                      width={62}
                    />
                  </Pressable>
                  <View style={styles.stepperWrap}>
                    <QuantityStepper
                      compact
                      quantity={line.quantity}
                      tokens={tokens}
                      decreaseLabel={storeText(language, 'decrease')}
                      increaseLabel={storeText(language, 'increase')}
                      onChange={quantity => onQuantityChange(line.product.id, quantity)}
                    />
                  </View>
                  <Text style={[styles.itemPrice, {color: tokens.colors.danger}]}>
                    {formatPrice(line.lineAmountCent, language)}
                  </Text>
                  <Pressable
                    onPress={() => onRemove(line.product.id)}
                    style={({pressed}) => [styles.removeAction, pressed && styles.pressed]}>
                    <Text style={[styles.remove, {color: tokens.colors.muted}]}>
                      {storeText(language, 'remove')}
                    </Text>
                  </Pressable>
                </View>
              );
              })}
            </View>
            <View style={[styles.toolbar, {borderTopColor: tokens.colors.line}]}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{checked: allSelected}}
                onPress={() => onSelectAll(!allSelected)}
                style={styles.toolbarAction}>
                <SelectionBox selected={allSelected} tokens={tokens} />
                <Text style={[styles.toolbarText, {color: tokens.colors.text}]}>
                  {storeText(language, 'selectAll')}
                </Text>
              </Pressable>
              <Pressable
                disabled={!lines.some(line => line.selected)}
                onPress={onRemoveSelected}
                style={({pressed}) => [styles.toolbarAction, pressed && styles.pressed]}>
                <Text style={[styles.removeSelected, {color: tokens.colors.muted}]}>
                  {storeText(language, 'removeSelected')}
                </Text>
              </Pressable>
              <Pressable
                onPress={onBrowse}
                style={({pressed}) => [styles.continueAction, pressed && styles.pressed]}>
                <Text style={[styles.continueShopping, {color: tokens.colors.accent}]}>
                  {storeText(language, 'continueShopping')}
                </Text>
              </Pressable>
            </View>
          </View>

          <View
            style={[
              styles.summary,
              {backgroundColor: tokens.colors.surface, borderColor: tokens.colors.line},
            ]}>
            <View
              style={[
                styles.promotion,
                {backgroundColor: tokens.colors.accentSoft, borderColor: tokens.colors.line},
              ]}>
              <StoreIcon name="cart" color={tokens.colors.accent} size={18} />
              <View style={styles.promotionCopy}>
                <Text style={[styles.promotionTitle, {color: tokens.colors.accent}]}>
                  {storeText(language, 'promotionTitle')}
                </Text>
                <Text style={[styles.promotionDescription, {color: tokens.colors.muted}]}>
                  {storeText(language, 'promotionDescription')}
                </Text>
              </View>
            </View>
            <Text style={[styles.summaryTitle, {color: tokens.colors.text}]}>
              {storeText(language, 'summary')}
            </Text>
            <SummaryRow
              label={storeText(language, 'selectedBooks')}
              value={storeText(language, 'copies', {count: selectedCopies})}
              tokens={tokens}
            />
            <SummaryRow
              label={storeText(language, 'subtotal')}
              value={formatPrice(amountCent, language)}
              tokens={tokens}
            />
            <SummaryRow
              label={storeText(language, 'shipping')}
              value={storeText(language, 'free')}
              tokens={tokens}
            />
            <View style={[styles.totalRow, {borderTopColor: tokens.colors.line}]}>
              <Text style={[styles.totalLabel, {color: tokens.colors.text}]}>
                {storeText(language, 'total')}
              </Text>
              <Text testID="cart-total" style={[styles.total, {color: tokens.colors.text}]}>
                {formatPrice(amountCent, language)}
              </Text>
            </View>
            {checkoutBlocked && <AppButton
              tokens={tokens}
              label={language === 'en' ? 'Recalculate total' : '重新计算合计'}
              variant="secondary"
              onPress={onRefreshTotal ?? onBrowse}
              style={styles.checkout}
            />}
            {onPreview && <AppButton
              tokens={tokens}
              label={language === 'en' ? 'Review checkout' : '查看结算明细'}
              variant="secondary"
              disabled={selectedCopies < 1 || busy}
              onPress={onPreview}
              style={styles.checkout}
            />}
            <AppButton
              label={storeText(language, 'checkout', {count: selectedCopies})}
              tokens={tokens}
              busy={busy}
              disabled={selectedCopies < 1 || checkoutBlocked}
              onPress={onPurchase}
              style={styles.checkout}
            />
          </View>
        </>
      )}

      <View
        style={[
          styles.demo,
          {backgroundColor: tokens.colors.surfaceSoft, borderColor: tokens.colors.line},
        ]}>
        <Text style={[styles.demoTitle, {color: tokens.colors.text}]}>
          {storeText(language, 'demoActions')}
        </Text>
        <Text style={[styles.demoHint, {color: tokens.colors.muted}]}>
          {storeText(language, 'demoHint')}
        </Text>
        <AppButton
          label={storeText(language, 'batchOrder')}
          tokens={tokens}
          variant="secondary"
          busy={busy}
          disabled={selectedCopies < 1 || checkoutBlocked}
          onPress={onBatchPurchase}
          style={styles.batchButton}
        />
      </View>
    </ScrollView>
  );
}

function SelectionBox({selected, tokens}: {selected: boolean; tokens: DesignTokens}) {
  return (
    <View
      style={[
        styles.selection,
        {
          backgroundColor: selected ? tokens.colors.accent : tokens.colors.surface,
          borderColor: selected ? tokens.colors.accent : tokens.colors.line,
        },
      ]}>
      {selected && <StoreIcon name="check" color={tokens.colors.onAccent} size={13} />}
    </View>
  );
}

function SummaryRow({label, value, tokens}: {label: string; value: string; tokens: DesignTokens}) {
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.summaryLabel, {color: tokens.colors.muted}]}>{label}</Text>
      <Text style={[styles.summaryValue, {color: tokens.colors.text}]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {paddingHorizontal: 10, paddingTop: 10, paddingBottom: 18},
  cartHero: {minHeight: 126, paddingHorizontal: 16, paddingVertical: 22, borderWidth: 1, overflow: 'hidden', justifyContent: 'center'},
  heroOrb: {position: 'absolute', width: 200, height: 200, right: -72, top: -92, borderWidth: 1, borderRadius: 100, opacity: 0.12},
  eyebrow: {fontSize: 9, lineHeight: 13, fontWeight: '900', letterSpacing: 0.8},
  title: {marginTop: 7, fontSize: 25, lineHeight: 31, fontWeight: '900', letterSpacing: -0.4},
  description: {marginTop: 5, fontSize: 9, lineHeight: 15},
  empty: {marginTop: 18, padding: 28, borderWidth: 1, borderRadius: 17, alignItems: 'center'},
  emptyIcon: {width: 70, height: 70, borderRadius: 35, alignItems: 'center', justifyContent: 'center'},
  emptyTitle: {marginTop: 14, fontSize: 18, lineHeight: 23, fontWeight: '900'},
  emptyHint: {marginTop: 5, fontSize: 11, lineHeight: 17, textAlign: 'center'},
  browseButton: {marginTop: 16, minWidth: 160},
  commerce: {marginTop: 16, borderTopWidth: 1, borderBottomWidth: 1},
  toolbar: {minHeight: 54, paddingHorizontal: 13, borderTopWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 14},
  toolbarAction: {height: 38, flexDirection: 'row', alignItems: 'center', gap: 7},
  toolbarText: {fontSize: 10, fontWeight: '800'},
  removeSelected: {fontSize: 9, fontWeight: '800'},
  continueAction: {marginLeft: 'auto'},
  continueShopping: {fontSize: 9, fontWeight: '900'},
  selection: {width: 18, height: 18, borderWidth: 1, borderRadius: 4, alignItems: 'center', justifyContent: 'center'},
  items: {},
  item: {height: 305, borderBottomWidth: 1},
  selectBoxWrap: {position: 'absolute', left: 13, top: 20},
  itemCopy: {position: 'absolute', left: 48, right: 90, top: 16},
  itemTitle: {fontSize: 12, lineHeight: 17, fontWeight: '900'},
  itemMeta: {marginTop: 4, fontSize: 9, lineHeight: 14},
  stockRow: {marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 5},
  stockDot: {width: 5, height: 5, borderRadius: 3},
  stockText: {fontSize: 8, lineHeight: 11, fontWeight: '800'},
  itemCover: {position: 'absolute', right: 13, top: 126},
  itemPrice: {position: 'absolute', right: 13, top: 231, fontSize: 13, lineHeight: 18, fontWeight: '900'},
  remove: {fontSize: 9, lineHeight: 13, fontWeight: '900'},
  stepperWrap: {position: 'absolute', left: 48, top: 222},
  removeAction: {position: 'absolute', left: 48, bottom: 15, paddingVertical: 4},
  summary: {marginTop: 12, paddingHorizontal: 20, paddingVertical: 20, borderTopWidth: 1, borderBottomWidth: 1},
  promotion: {marginBottom: 18, padding: 11, borderWidth: 1, borderRadius: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 9},
  promotionCopy: {flex: 1, minWidth: 0},
  promotionTitle: {fontSize: 9, lineHeight: 13, fontWeight: '900'},
  promotionDescription: {marginTop: 2, fontSize: 9, lineHeight: 14},
  summaryTitle: {fontSize: 16, lineHeight: 21, fontWeight: '900'},
  summaryRow: {minHeight: 31, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12},
  summaryLabel: {fontSize: 10},
  summaryValue: {fontSize: 10, fontWeight: '800'},
  totalRow: {marginTop: 5, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  totalLabel: {fontSize: 12, fontWeight: '900'},
  total: {fontSize: 20, lineHeight: 25, fontWeight: '900'},
  checkout: {marginTop: 13},
  demo: {marginTop: 12, padding: 15, borderWidth: 1, borderRadius: 16},
  demoTitle: {fontSize: 14, lineHeight: 19, fontWeight: '900'},
  demoHint: {marginTop: 4, fontSize: 10, lineHeight: 16},
  batchButton: {marginTop: 11},
  pressed: {opacity: 0.72, transform: [{scale: 0.97}]},
});
