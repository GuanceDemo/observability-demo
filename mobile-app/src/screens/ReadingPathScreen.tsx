import React from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {
  READING_STAGES,
  getProduct,
  getProductText,
  storeText,
} from '../data';
import type {DesignTokens} from '../designTokens';
import type {StoreLanguage} from '../types';
import {BookCover} from '../components/BookCover';

interface Props {
  tokens: DesignTokens;
  language: StoreLanguage;
  onOpenBook: (bookId: string) => void;
}

export function ReadingPathScreen({tokens, language, onOpenBook}: Props) {
  return (
    <ScrollView
      testID="reading-path-screen"
      style={{backgroundColor: tokens.colors.background}}
      contentContainerStyle={styles.content}
      overScrollMode="never"
      showsVerticalScrollIndicator={false}>
      <View
        style={[
          styles.hero,
          {backgroundColor: tokens.colors.surfaceSoft, borderColor: tokens.colors.line},
        ]}>
        <View style={[styles.heroOrb, {borderColor: tokens.colors.purple}]} />
        <Text style={[styles.eyebrow, {color: tokens.colors.accent}]}>
          {storeText(language, 'pathEyebrow')}
        </Text>
        <Text style={[styles.title, {color: tokens.colors.text}]}>
          {storeText(language, 'pathTitle')}
        </Text>
        <Text style={[styles.description, {color: tokens.colors.muted}]}>
          {storeText(language, 'pathDescription')}
        </Text>
      </View>
      {READING_STAGES.map((stage, index) => {
        const copy = stage[language];
        return (
          <View
            key={stage.books.join('-')}
            style={[
              styles.stage,
              {backgroundColor: tokens.colors.surface, borderColor: tokens.colors.line},
            ]}>
            <View style={styles.stageTop}>
              <View style={[styles.stageNumber, {backgroundColor: tokens.colors.accent}]}>
                <Text style={[styles.stageNumberText, {color: tokens.colors.onAccent}]}>
                  0{index + 1}
                </Text>
              </View>
              <View style={styles.stageCopy}>
                <Text style={[styles.stageTitle, {color: tokens.colors.text}]}>
                  {storeText(language, 'stage', {index: index + 1})} · {copy[0]}
                </Text>
                <Text style={[styles.stageDescription, {color: tokens.colors.muted}]}>
                  {copy[1]}
                </Text>
              </View>
            </View>
            <View style={styles.books}>
              {stage.books.map(bookId => {
                const product = getProduct(bookId);
                const text = getProductText(product, language);
                return (
                  <Pressable
                    key={bookId}
                    onPress={() => onOpenBook(bookId)}
                    style={({pressed}) => [styles.book, pressed && styles.pressed]}>
                    <BookCover
                      tokens={tokens}
                      product={product}
                      language={language}
                      compact
                      width={34}
                    />
                    <Text
                      numberOfLines={2}
                      style={[styles.bookTitle, {color: tokens.colors.text}]}>
                      {text.title}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {paddingHorizontal: 10, paddingTop: 10, paddingBottom: 18, gap: 8},
  hero: {minHeight: 150, padding: 20, borderWidth: 1, borderRadius: 16, overflow: 'hidden', justifyContent: 'center'},
  heroOrb: {
    position: 'absolute',
    width: 210,
    height: 210,
    right: -92,
    bottom: -122,
    borderWidth: 1,
    borderRadius: 105,
    opacity: 0.13,
  },
  eyebrow: {fontSize: 9, lineHeight: 13, fontWeight: '900', letterSpacing: 1},
  title: {marginTop: 8, fontSize: 25, lineHeight: 31, fontWeight: '900', letterSpacing: -0.4},
  description: {marginTop: 7, fontSize: 9, lineHeight: 15},
  stage: {padding: 13, borderWidth: 1, borderRadius: 13},
  stageTop: {flexDirection: 'row', alignItems: 'flex-start', gap: 12},
  stageNumber: {width: 52, height: 52, borderRadius: 15, alignItems: 'center', justifyContent: 'center'},
  stageNumberText: {fontSize: 10, fontWeight: '900'},
  stageCopy: {flex: 1, minWidth: 0, paddingTop: 2},
  stageTitle: {fontSize: 14, lineHeight: 19, fontWeight: '900'},
  stageDescription: {marginTop: 4, fontSize: 8, lineHeight: 13},
  books: {marginTop: 10, gap: 6},
  book: {width: '100%', minHeight: 60, padding: 7, borderWidth: 1, borderColor: '#e8dfdc', borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff'},
  bookTitle: {flex: 1, fontSize: 9, lineHeight: 13, fontWeight: '800'},
  pressed: {opacity: 0.75, transform: [{scale: 0.97}]},
});
