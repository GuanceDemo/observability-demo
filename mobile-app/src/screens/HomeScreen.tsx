import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import {AppButton} from '../components/AppButton';
import {BookCover} from '../components/BookCover';
import {BOOK, EDITORIAL_CARDS} from '../data';
import {
  STOREFRONT_HERO_HORIZONTAL_PADDING,
  STOREFRONT_PAGE_HORIZONTAL_INSET,
  storefrontLayoutForWidth,
} from '../layout';
import type {ThemeTokens} from '../theme';

interface Props {
  tokens: ThemeTokens;
  inCart: boolean;
  onViewBook: () => void;
  onToggleCart: () => void;
}

export function HomeScreen({
  tokens,
  inCart,
  onViewBook,
  onToggleCart,
}: Props) {
  const {width} = useWindowDimensions();
  const layout = storefrontLayoutForWidth(width);
  return (
    <ScrollView
      testID="home-screen"
      contentContainerStyle={styles.content}
      style={{backgroundColor: tokens.colors.background}}
      showsVerticalScrollIndicator={false}>
      <View
        testID="home-hero"
        style={[
          styles.hero,
          {
            backgroundColor: tokens.colors.surface,
            borderColor: tokens.colors.line,
          },
        ]}>
        <BookCover tokens={tokens} width={layout.bookCoverWidth} />
        <View style={styles.heroCopy}>
          <Text style={[styles.eyebrow, {color: tokens.colors.accent}]}>
            本周编辑推荐
          </Text>
          <Text
            style={[
              styles.heroTitle,
              {
                color: tokens.colors.text,
                fontSize: layout.homeTitleFontSize,
                lineHeight: layout.homeTitleFontSize * 1.08,
              },
            ]}>
            理解系统，始于提出更好的问题
          </Text>
          <Text style={[styles.bookName, {color: tokens.colors.muted}]}>
            {BOOK.name}
          </Text>
          <Text style={[styles.description, {color: tokens.colors.muted}]}>
            一本写给研发、SRE
            与平台团队的可观测性实践指南，从真实用户体验一路读到后端系统行为。
          </Text>
          <View style={styles.bookMeta}>
            <Text style={[styles.metaText, {color: tokens.colors.muted}]}>
              {BOOK.author}
            </Text>
            <Text style={[styles.metaText, {color: tokens.colors.muted}]}>
              {BOOK.edition}
            </Text>
            <Text style={[styles.metaText, {color: tokens.colors.muted}]}>
              {BOOK.note}
            </Text>
          </View>
          <Text style={[styles.price, {color: tokens.colors.text}]}>
            {BOOK.price}
          </Text>
          <View testID="home-actions" style={styles.buttonRow}>
            <AppButton
              label="查看本书"
              tokens={tokens}
              onPress={onViewBook}
            />
            <AppButton
              label={inCart ? '已在购物袋' : '加入购物袋'}
              tokens={tokens}
              variant="secondary"
              onPress={onToggleCart}
            />
          </View>
        </View>
      </View>

      <View style={styles.editorialHeader}>
        <Text style={[styles.sectionTitle, {color: tokens.colors.text}]}>
          为什么值得读
        </Text>
        <Text style={[styles.description, {color: tokens.colors.muted}]}>
          从概念到日常实践，建立一套能够解释复杂系统的共同语言。
        </Text>
      </View>
      <View style={styles.editorialGrid}>
        {EDITORIAL_CARDS.map(card => (
          <View
            key={card.mark}
            style={[
              styles.editorialCard,
              {
                backgroundColor: tokens.colors.surface,
                borderColor: tokens.colors.line,
              },
            ]}>
            <Text style={[styles.cardMark, {color: tokens.colors.accent}]}>
              {card.mark}
            </Text>
            <View style={styles.cardCopy}>
              <Text style={[styles.cardTitle, {color: tokens.colors.text}]}>
                {card.title}
              </Text>
              <Text style={[styles.cardDescription, {color: tokens.colors.muted}]}>
                {card.description}
              </Text>
            </View>
          </View>
        ))}
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
  hero: {
    paddingVertical: 22,
    paddingHorizontal: STOREFRONT_HERO_HORIZONTAL_PADDING,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: 'center',
    gap: 22,
  },
  heroCopy: {
    width: '100%',
    gap: 12,
  },
  eyebrow: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  heroTitle: {
    fontWeight: '900',
  },
  description: {
    fontSize: 14,
    lineHeight: 24,
  },
  price: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '900',
  },
  bookName: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
  },
  bookMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 14,
    rowGap: 6,
  },
  metaText: {
    fontSize: 12,
    lineHeight: 18,
  },
  buttonRow: {
    gap: 10,
  },
  editorialHeader: {
    marginTop: 34,
  },
  sectionTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '900',
  },
  editorialGrid: {
    marginTop: 16,
    gap: 10,
  },
  editorialCard: {
    padding: 15,
    borderWidth: 1,
    borderRadius: 14,
    flexDirection: 'row',
    gap: 14,
  },
  cardMark: {
    width: 30,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '900',
  },
  cardCopy: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '900',
  },
  cardDescription: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 19,
  },
});
