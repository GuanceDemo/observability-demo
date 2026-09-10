import React from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {
  formatPrice,
  getProductText,
  storeText,
  type StorefrontProduct,
} from '../data';
import type {DesignTokens} from '../designTokens';
import {MIN_TOUCH_TARGET_SIZE} from '../layout';
import type {BookContentState, DetailTab, StoreLanguage} from '../types';
import {AppButton} from '../components/AppButton';
import {BookCover} from '../components/BookCover';
import {QuantityStepper} from '../components/Commerce';
import {StoreIcon} from '../components/StoreIcon';

interface Props {
  tokens: DesignTokens;
  language: StoreLanguage;
  product: StorefrontProduct;
  tab: DetailTab;
  quantity: number;
  inCart: boolean;
  content?: BookContentState;
  onContentRetry?: () => void;
  onBack: () => void;
  onTabChange: (tab: DetailTab) => void;
  onQuantityChange: (quantity: number) => void;
  onAdd: () => void;
  onBuy: () => void;
}

const TABS: Array<{
  tab: DetailTab;
  key: 'overview' | 'contents' | 'audience';
}> = [
  {tab: 'overview', key: 'overview'},
  {tab: 'chapters', key: 'contents'},
  {tab: 'audience', key: 'audience'},
];

export function DetailScreen({
  tokens,
  language,
  product,
  tab,
  quantity,
  inCart,
  content,
  onContentRetry,
  onBack,
  onTabChange,
  onQuantityChange,
  onAdd,
  onBuy,
}: Props) {
  const text = getProductText(product, language);
  const description = text.description.trim();
  const loaded = content?.status === 'ready' && content.bookId === product.id ? content.data : null;
  const waiting = content && (content.status === 'loading' || content.status === 'error') && content.bookId === product.id;
  return (
    <ScrollView
      testID="detail-screen"
      style={{backgroundColor: tokens.colors.background}}
      contentContainerStyle={styles.content}
      overScrollMode="never"
      showsVerticalScrollIndicator={false}>
      <Pressable
        accessibilityRole="button"
        onPress={onBack}
        style={({pressed}) => [styles.back, pressed && styles.pressed]}>
        <StoreIcon name="back" color={tokens.colors.muted} size={18} />
        <Text style={[styles.backText, {color: tokens.colors.muted}]}>
          {storeText(language, 'navHome')}
        </Text>
      </Pressable>

      {waiting && (
        <View testID={`book-content-${content.status}`} style={[styles.panel, {backgroundColor: tokens.colors.surfaceSoft}]}>
          <Text style={[styles.panelLead, {color: tokens.colors.text}]}>
            {content.status === 'loading'
              ? (language === 'en' ? 'Loading book content…' : '正在加载图书内容…')
              : (language === 'en' ? 'Content could not be loaded. Please try again.' : '图书内容加载失败，请重新加载。')}
          </Text>
          {content.status === 'error' && <AppButton tokens={tokens} label={language === 'en' ? 'Reload content' : '重新加载内容'} onPress={onContentRetry ?? onBack} />}
        </View>
      )}

      <View
        style={[
          styles.product,
          {backgroundColor: tokens.colors.surface, borderColor: tokens.colors.line},
        ]}>
        <View style={styles.productTop}>
          <View style={styles.coverWrap}>
            <BookCover
              tokens={tokens}
              product={product}
              language={language}
              width={118}
            />
          </View>
          <View style={styles.detailCopy}>
            <Text
              style={[
                styles.badge,
                {color: tokens.colors.accent, backgroundColor: tokens.colors.accentSoft},
              ]}>
              {text.badge}
            </Text>
            <Text style={[styles.title, {color: tokens.colors.text}]}>{text.title}</Text>
            <Text style={[styles.englishTitle, {color: tokens.colors.muted}]}>
              {text.englishTitle}
            </Text>
            <View style={styles.ratingRow}>
              <Text style={[styles.stars, {color: tokens.colors.orange}]}>★★★★★</Text>
              <Text style={[styles.rating, {color: tokens.colors.orange}]}>
                {storeText(language, 'rating', {rating: product.rating})}
              </Text>
              <Text style={[styles.pick, {color: tokens.colors.muted}]}>
                {storeText(language, 'editorPick')}
              </Text>
            </View>
            <Text style={[styles.description, {color: tokens.colors.muted}]}>
              {waiting ? '…' : loaded?.description ?? description}
            </Text>
            <Text style={[styles.author, {color: tokens.colors.text}]}>
              {storeText(language, 'authorPrefix')}: {text.author}
            </Text>
            <View style={[styles.metaGrid, {borderTopColor: tokens.colors.line}]}>
              {[
                [storeText(language, 'published'), text.published],
                [storeText(language, 'pages'), text.pages],
                [storeText(language, 'level'), text.level],
                [storeText(language, 'publisher'), text.publisher],
                [storeText(language, 'isbn'), text.isbn],
                ['SKU', `obs-${product.id}`],
              ].map(([label, value]) => (
                <View key={label} style={styles.meta}>
                  <Text style={[styles.metaLabel, {color: tokens.colors.muted}]}>{label}</Text>
                  <Text numberOfLines={1} style={[styles.metaValue, {color: tokens.colors.text}]}>
                    {value}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        <View
          style={[
            styles.purchasePanel,
            {backgroundColor: tokens.colors.surfaceSoft, borderColor: tokens.colors.line},
          ]}>
          <Text style={[styles.format, {color: tokens.colors.muted}]}>
            {storeText(language, 'format')} · {storeText(language, 'commerceProduct')}
          </Text>
          <Text style={[styles.price, {color: tokens.colors.danger}]}>
            {formatPrice(product.amountCent, language)}
          </Text>
          <View style={styles.benefits}>
            {[storeText(language, 'inStock'), storeText(language, 'authenticity')].map(item => (
              <View key={item} style={styles.benefit}>
                <View
                  style={[
                    styles.benefitIcon,
                    {backgroundColor: `${tokens.colors.success}12`},
                  ]}>
                  <StoreIcon name="check" color={tokens.colors.success} size={12} />
                </View>
                <Text style={[styles.benefitText, {color: tokens.colors.muted}]}>{item}</Text>
              </View>
            ))}
          </View>
          <View style={[styles.quantityRow, {borderTopColor: tokens.colors.line}]}>
            <Text style={[styles.quantityLabel, {color: tokens.colors.text}]}>
              {storeText(language, 'quantityHeader')}
            </Text>
            <QuantityStepper
              quantity={quantity}
              tokens={tokens}
              decreaseLabel={storeText(language, 'decrease')}
              increaseLabel={storeText(language, 'increase')}
              onChange={onQuantityChange}
            />
          </View>
          <View style={styles.actions}>
            <AppButton
              label={inCart ? storeText(language, 'inCart') : storeText(language, 'addCart')}
              tokens={tokens}
              onPress={onAdd}
              style={styles.action}
            />
            <AppButton
              label={storeText(language, 'buyNow')}
              tokens={tokens}
              variant="secondary"
              onPress={onBuy}
              style={styles.action}
            />
          </View>
        </View>
      </View>

      <View
        style={[
          styles.tabCard,
          {backgroundColor: tokens.colors.surface, borderColor: tokens.colors.line},
        ]}>
        <View style={[styles.tabs, {borderBottomColor: tokens.colors.line}]} accessibilityRole="tablist">
          {TABS.map(item => {
            const active = item.tab === tab;
            return (
              <Pressable
                key={item.tab}
                accessibilityRole="tab"
                accessibilityState={{selected: active}}
                onPress={() => onTabChange(item.tab)}
                style={({pressed}) => [
                  styles.tab,
                  active && {borderBottomColor: tokens.colors.accent},
                  pressed && styles.pressed,
                ]}>
                <Text style={[styles.tabText, {color: active ? tokens.colors.accent : tokens.colors.muted}]}>
                  {storeText(language, item.key)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View testID={`detail-tab-${tab}`} accessibilityRole="summary" style={styles.panel}>
          {!waiting && tab === 'overview' && (
            <>
              <Text style={[styles.panelLead, {color: tokens.colors.muted}]}>{loaded?.description ?? description}</Text>
              {text.learn.map((item, index) => (
                <PanelRow key={item[0]} index={`0${index + 1}`} title={item[0]} detail={item[1]} tokens={tokens} />
              ))}
            </>
          )}
          {!waiting && tab === 'chapters' && (loaded?.parts ?? text.parts).map(item => (
            <PanelRow key={item[0]} index={item[0]} title={item[1]} detail={item[2]} tokens={tokens} />
          ))}
          {tab === 'audience' && text.audience.map((item, index) => (
            <PanelRow key={item[0]} index={`◎${index + 1}`} title={item[0]} detail={item[1]} tokens={tokens} />
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

function PanelRow({
  index,
  title,
  detail,
  tokens,
}: {
  index: string;
  title: string;
  detail: string;
  tokens: DesignTokens;
}) {
  return (
    <View style={[styles.panelRow, {borderColor: tokens.colors.line}]}>
      <Text style={[styles.panelIndex, {color: tokens.colors.accent}]}>{index}</Text>
      <View style={styles.panelCopy}>
        <Text style={[styles.panelTitle, {color: tokens.colors.text}]}>{title}</Text>
        <Text style={[styles.panelDetail, {color: tokens.colors.muted}]}>{detail}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {paddingHorizontal: 10, paddingTop: 8, paddingBottom: 18},
  back: {height: MIN_TOUCH_TARGET_SIZE, minWidth: MIN_TOUCH_TARGET_SIZE, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-start'},
  backText: {fontSize: 9, fontWeight: '800'},
  product: {paddingHorizontal: 16, paddingVertical: 24, borderTopWidth: 1, borderBottomWidth: 1},
  productTop: {flexDirection: 'row', alignItems: 'flex-start', gap: 17},
  coverWrap: {alignItems: 'center'},
  detailCopy: {flex: 1, minWidth: 0},
  badge: {alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999, fontSize: 9, fontWeight: '900'},
  title: {marginTop: 10, fontSize: 24, lineHeight: 29, fontWeight: '900', letterSpacing: -0.4},
  englishTitle: {marginTop: 3, fontSize: 9, lineHeight: 13},
  ratingRow: {marginTop: 10, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 5},
  stars: {fontSize: 9, letterSpacing: -1},
  rating: {fontSize: 8, fontWeight: '800'},
  pick: {fontSize: 8, fontWeight: '800'},
  description: {marginTop: 9, fontSize: 11, lineHeight: 19},
  author: {marginTop: 9, fontSize: 10, lineHeight: 16, fontWeight: '800'},
  metaGrid: {marginTop: 15, paddingTop: 13, borderTopWidth: 1, flexDirection: 'row', flexWrap: 'wrap', rowGap: 9},
  meta: {width: '50%', minHeight: 35, paddingRight: 6},
  metaLabel: {fontSize: 8, lineHeight: 11},
  metaValue: {marginTop: 3, fontSize: 9, lineHeight: 13, fontWeight: '800'},
  purchasePanel: {marginTop: 16, padding: 16, borderWidth: 1, borderRadius: 14},
  format: {fontSize: 9, lineHeight: 12},
  price: {marginTop: 7, fontSize: 29, lineHeight: 35, fontWeight: '900'},
  benefits: {marginTop: 10, gap: 8},
  benefit: {flexDirection: 'row', alignItems: 'center', gap: 4},
  benefitIcon: {width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center'},
  benefitText: {fontSize: 9, lineHeight: 13},
  quantityRow: {marginTop: 14, paddingTop: 13, borderTopWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  quantityLabel: {fontSize: 10, lineHeight: 14, fontWeight: '800'},
  actions: {marginTop: 12, gap: 8},
  action: {width: '100%'},
  tabCard: {marginTop: 13, borderTopWidth: 1, borderBottomWidth: 1, overflow: 'hidden'},
  tabs: {height: 49, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row'},
  tab: {flex: 1, borderBottomWidth: 2, borderBottomColor: 'transparent', alignItems: 'center', justifyContent: 'center'},
  tabText: {fontSize: 10, fontWeight: '900'},
  panel: {paddingHorizontal: 15, paddingBottom: 23},
  panelLead: {marginBottom: 11, fontSize: 11, lineHeight: 18},
  panelRow: {paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 11},
  panelIndex: {width: 28, fontSize: 10, lineHeight: 15, fontWeight: '900'},
  panelCopy: {flex: 1},
  panelTitle: {fontSize: 12, lineHeight: 17, fontWeight: '900'},
  panelDetail: {marginTop: 3, fontSize: 10, lineHeight: 16},
  pressed: {opacity: 0.72, transform: [{scale: 0.97}]},
});
