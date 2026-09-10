import React, {memo, useLayoutEffect, useRef} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  PRODUCTS,
  TOPICS,
  formatPrice,
  getProductText,
  getTopicText,
  storeText,
  type StorefrontProduct,
} from '../data';
import type {DesignTokens} from '../designTokens';
import {MIN_TOUCH_TARGET_SIZE} from '../layout';
import type {StoreLanguage, StoreSort} from '../types';
import {AppButton} from '../components/AppButton';
import {BookCover} from '../components/BookCover';
import {ProductCard} from '../components/Commerce';
import {StoreIcon} from '../components/StoreIcon';

export interface HomeScrollPosition {key: string; y: number}

interface Props {
  tokens: DesignTokens;
  language: StoreLanguage;
  products: StorefrontProduct[];
  activeTopic: string;
  sort: StoreSort;
  cart: Record<string, number>;
  query?: string;
  scrollPosition?: React.RefObject<HomeScrollPosition>;
  onTopicChange: (topicId: string) => void;
  onSortChange: (sort: StoreSort) => void;
  onOpenBook: (bookId: string) => void;
  onAddBook: (bookId: string) => void;
}

const SORT_OPTIONS: Array<{
  value: StoreSort;
  key: 'sortRecommended' | 'sortRating' | 'sortPrice';
}> = [
  {value: 'recommended', key: 'sortRecommended'},
  {value: 'rating', key: 'sortRating'},
  {value: 'price-asc', key: 'sortPrice'},
];

export const HomeScreen = memo(function HomeScreenView({
  tokens,
  language,
  products,
  activeTopic,
  sort,
  cart,
  query = '',
  scrollPosition,
  onTopicChange,
  onSortChange,
  onOpenBook,
  onAddBook,
}: Props) {
  const localPosition = useRef<HomeScrollPosition>({key: '', y: 0});
  const position = scrollPosition ?? localPosition;
  const catalogKey = JSON.stringify([language, query, activeTopic, sort]);
  const scrollView = useRef<ScrollView>(null);
  const initialY = useRef(position.current.key === catalogKey ? position.current.y : 0);
  const restorePending = useRef(true);
  const viewportHeight = useRef(0);
  const contentHeight = useRef(0);
  useLayoutEffect(() => {
    if (position.current.key !== catalogKey) {
      position.current = {key: catalogKey, y: 0};
      initialY.current = 0;
      scrollView.current?.scrollTo({y: 0, animated: false});
    }
  }, [catalogKey, position]);
  const restorePosition = () => {
    if (!restorePending.current || !viewportHeight.current || !contentHeight.current) { return; }
    restorePending.current = false;
    const y = Math.min(initialY.current, Math.max(0, contentHeight.current - viewportHeight.current));
    scrollView.current?.scrollTo({y, animated: false});
  };
  const rememberPosition = (y: number) => {
    position.current = {key: catalogKey, y: Math.max(0, y)};
  };
  const {width} = useWindowDimensions();
  const cardWidth = Math.floor((Math.min(width, 430) - 20 - 8) / 2);
  const hero = PRODUCTS[0];
  const heroText = getProductText(hero, language);
  const titleLines = storeText(language, 'heroTitleLines').split('|');
  const sortIndex = SORT_OPTIONS.findIndex(option => option.value === sort);
  const activeSort = SORT_OPTIONS[Math.max(sortIndex, 0)];
  const nextSort = SORT_OPTIONS[(Math.max(sortIndex, 0) + 1) % SORT_OPTIONS.length];
  return (
    <ScrollView
      testID="home-screen"
      ref={scrollView}
      contentOffset={{x: 0, y: initialY.current}}
      onLayout={event => { viewportHeight.current = event.nativeEvent.layout.height; restorePosition(); }}
      onContentSizeChange={(_, height) => { contentHeight.current = height; restorePosition(); }}
      onScrollEndDrag={event => rememberPosition(event.nativeEvent.contentOffset.y)}
      onMomentumScrollEnd={event => rememberPosition(event.nativeEvent.contentOffset.y)}
      style={{backgroundColor: tokens.colors.background}}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      overScrollMode="never"
      showsVerticalScrollIndicator={false}>
      <View
        testID="home-hero"
        style={[
          styles.hero,
          {backgroundColor: tokens.colors.surfaceSoft, borderColor: tokens.colors.line},
        ]}>
        <View style={[styles.heroGlowOne, {backgroundColor: tokens.colors.orange}]} />
        <View style={[styles.heroGlowTwo, {backgroundColor: tokens.colors.purple}]} />
        <View style={styles.heroCopy}>
          <View style={styles.eyebrowRow}>
            <View style={[styles.eyebrowLine, {backgroundColor: tokens.colors.accent}]} />
            <Text style={[styles.eyebrow, {color: tokens.colors.accent}]}>
              {storeText(language, 'heroEyebrow')}
            </Text>
          </View>
          <Text style={[styles.heroTitle, {color: tokens.colors.text}]}>
            {titleLines.join('\n')}
          </Text>
          <Text numberOfLines={3} style={[styles.heroDescription, {color: tokens.colors.muted}]}>
            {storeText(language, 'heroDescription')}
          </Text>
          <Text style={[styles.heroMeta, {color: tokens.colors.muted}]}>
            {heroText.authorShort} · {formatPrice(hero.amountCent, language)}
          </Text>
          <View style={styles.heroActions}>
            <AppButton
              label={storeText(language, 'viewBook')}
              tokens={tokens}
              compact
              onPress={() => onOpenBook(hero.id)}
            />
            <AppButton
              label={
                cart[hero.id]
                  ? storeText(language, 'inCart')
                  : storeText(language, 'addCart')
              }
              tokens={tokens}
              variant="secondary"
              compact
              onPress={() => onAddBook(hero.id)}
            />
          </View>
        </View>
        <View style={styles.heroVisual}>
          <BookCover
            tokens={tokens}
            product={hero}
            language={language}
            width={76}
          />
        </View>
      </View>

      <ScrollView
        horizontal
        style={styles.topicScroller}
        contentContainerStyle={styles.topics}
        overScrollMode="never"
        showsHorizontalScrollIndicator={false}>
        {TOPICS.map(topic => {
          const active = topic.id === activeTopic;
          const copy = getTopicText(topic, language);
          return (
            <Pressable
              key={topic.id}
              accessibilityRole="button"
              accessibilityState={{selected: active}}
              onPress={() => onTopicChange(topic.id)}
              style={({pressed}) => [
                styles.topic,
                {
                  backgroundColor: active
                    ? tokens.colors.accentSoft
                    : tokens.colors.surface,
                  borderColor: active ? tokens.colors.accent : tokens.colors.line,
                },
                pressed && styles.pressed,
              ]}>
              <View
                style={[
                  styles.topicIcon,
                  {backgroundColor: active ? tokens.colors.surface : tokens.colors.surfaceSoft},
                ]}>
                <StoreIcon
                  name={topic.id === 'all' ? 'book' : 'path'}
                  color={active ? tokens.colors.accent : tokens.colors.muted}
                  size={16}
                />
              </View>
              <View style={styles.topicCopy}>
                <Text numberOfLines={2} style={[styles.topicTitle, {color: tokens.colors.text}]}>
                  {copy.title}
                </Text>
                <Text numberOfLines={1} style={[styles.topicSubtitle, {color: tokens.colors.muted}]}>
                  {copy.subtitle}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={[styles.catalog, {borderTopColor: tokens.colors.line}]}>
        <View style={styles.catalogHeader}>
          <View style={styles.catalogCopy}>
            <View style={[styles.sectionMark, {backgroundColor: tokens.colors.accent}]} />
            <Text numberOfLines={1} style={[styles.sectionTitle, {color: tokens.colors.text}]}>
              {activeTopic === 'all'
                ? storeText(language, 'shelfTitle')
                : getTopicText(
                    TOPICS.find(topic => topic.id === activeTopic) ?? TOPICS[0],
                    language,
                  ).title}
            </Text>
            <Text style={[styles.resultCount, {color: tokens.colors.muted}]}>
              {storeText(language, 'resultCount', {count: products.length})}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={storeText(language, activeSort.key)}
            accessibilityHint={storeText(language, nextSort.key)}
            onPress={() => onSortChange(nextSort.value)}
            style={({pressed}) => [
              styles.sortButton,
              {backgroundColor: tokens.colors.surface, borderColor: tokens.colors.line},
              pressed && styles.pressed,
            ]}>
            <Text numberOfLines={1} style={[styles.sortText, {color: tokens.colors.text}]}>
              {storeText(language, activeSort.key)}
            </Text>
            <Text style={[styles.sortChevron, {color: tokens.colors.muted}]}>⌄</Text>
          </Pressable>
        </View>

        {products.length > 0 ? (
          <View style={styles.grid}>
            {products.map(product => (
              <ProductCard
                key={product.id}
                product={product}
                language={language}
                tokens={tokens}
                inCart={Number(cart[product.id] ?? 0) > 0}
                width={cardWidth}
                onOpen={onOpenBook}
                onAdd={onAddBook}
              />
            ))}
          </View>
        ) : (
          <View
            testID="catalog-empty"
            style={[
              styles.empty,
              {backgroundColor: tokens.colors.surface, borderColor: tokens.colors.line},
            ]}>
            <StoreIcon name="search" color={tokens.colors.accent} size={28} />
            <Text style={[styles.emptyTitle, {color: tokens.colors.text}]}>
              {storeText(language, 'noResults')}
            </Text>
            <Text style={[styles.emptyHint, {color: tokens.colors.muted}]}>
              {storeText(language, 'noResultsHint')}
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  content: {paddingHorizontal: 10, paddingTop: 10, paddingBottom: 18},
  hero: {
    minHeight: 202,
    padding: 18,
    borderWidth: 1,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    overflow: 'hidden',
  },
  heroGlowOne: {
    position: 'absolute',
    width: 150,
    height: 150,
    left: -70,
    bottom: -85,
    borderRadius: 75,
    opacity: 0.13,
  },
  heroGlowTwo: {
    position: 'absolute',
    width: 160,
    height: 160,
    right: -90,
    top: -105,
    borderRadius: 80,
    opacity: 0.12,
  },
  heroCopy: {flex: 1, minWidth: 0},
  heroVisual: {width: 82, minHeight: 160, alignItems: 'center', justifyContent: 'center'},
  eyebrowRow: {flexDirection: 'row', alignItems: 'center', gap: 5},
  eyebrowLine: {width: 14, height: 2, borderRadius: 1},
  eyebrow: {fontSize: 8, lineHeight: 12, fontWeight: '900', letterSpacing: 0.7},
  heroTitle: {marginTop: 7, fontSize: 22, lineHeight: 25, fontWeight: '900', letterSpacing: -0.4},
  heroDescription: {marginTop: 7, fontSize: 9, lineHeight: 14},
  heroMeta: {marginTop: 7, fontSize: 8, lineHeight: 12, fontWeight: '700'},
  heroActions: {marginTop: 9, flexDirection: 'row', gap: 5},
  topicScroller: {marginTop: 13},
  topics: {paddingRight: 4, paddingBottom: 4, gap: 7},
  topic: {
    width: 116,
    minHeight: 54,
    padding: 7,
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  topicIcon: {width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center'},
  topicCopy: {flex: 1, minWidth: 0},
  topicTitle: {fontSize: 9, lineHeight: 11, fontWeight: '900'},
  topicSubtitle: {marginTop: 2, fontSize: 7, lineHeight: 9},
  catalog: {marginTop: 8, paddingTop: 14, paddingBottom: 18, borderTopWidth: 1},
  catalogHeader: {minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8},
  catalogCopy: {flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6},
  sectionMark: {width: 3, height: 22, borderRadius: 2},
  sectionTitle: {maxWidth: 132, fontSize: 16, lineHeight: 21, fontWeight: '900'},
  resultCount: {fontSize: 8, lineHeight: 11},
  sortButton: {width: 86, height: MIN_TOUCH_TARGET_SIZE, paddingHorizontal: 8, borderWidth: 1, borderRadius: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  sortText: {flex: 1, fontSize: 8, fontWeight: '800'},
  sortChevron: {fontSize: 11, lineHeight: 13},
  grid: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  empty: {marginTop: 4, padding: 30, borderWidth: 1, borderRadius: 15, alignItems: 'center'},
  emptyTitle: {marginTop: 12, fontSize: 16, fontWeight: '900'},
  emptyHint: {marginTop: 5, fontSize: 11, lineHeight: 17, textAlign: 'center'},
  pressed: {opacity: 0.76, transform: [{scale: 0.97}]},
});
