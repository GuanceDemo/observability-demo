import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {
  BOOK_COVER_ASPECT_RATIO,
  STOREFRONT_BAG_COVER_WIDTH,
  STOREFRONT_BOOK_COVER_WIDTH,
  bookCoverArtLayout,
} from '../layout';
import type {ThemeTokens} from '../theme';

interface Props {
  tokens: ThemeTokens;
  compact?: boolean;
  width?: number;
}

export function BookCover({tokens, compact = false, width}: Props) {
  const white = tokens.name === 'white';
  const coverWidth =
    width ??
    (compact ? STOREFRONT_BAG_COVER_WIDTH : STOREFRONT_BOOK_COVER_WIDTH);
  const art = bookCoverArtLayout(coverWidth);
  const scaled = (value: number) => value * art.scale;
  const nodeSize = scaled(12);
  const nodeBorderWidth = Math.max(1, scaled(2));
  return (
    <View
      testID={compact ? 'bag-book-cover' : 'book-cover'}
      accessibilityLabel="《可观测性工程》中文版封面"
      style={[
        styles.cover,
        compact && styles.compact,
        {width: coverWidth},
        white ? styles.whiteCover : styles.colorfulCover,
        {
          borderColor: tokens.colors.accent,
        },
      ]}>
      <View
        testID="book-cover-accent"
        style={[
          styles.accentBar,
          {
            left: scaled(16),
            right: scaled(16),
            top: art.accent.top,
            height: Math.max(2, art.accent.height),
            borderRadius: scaled(4),
            backgroundColor: tokens.colors.accent,
          },
        ]}
      />
      <Text
        allowFontScaling={false}
        style={[
          styles.label,
          {
            left: scaled(16),
            top: art.label.top,
            fontSize: Math.max(4, scaled(9)),
            lineHeight: Math.max(5, art.label.lineHeight),
            letterSpacing: scaled(1.5),
            color: tokens.colors.accent,
          },
        ]}>
        MALL DEMO
      </Text>
      <View
        testID="book-cover-title"
        style={[
          styles.titleGroup,
          {
            left: scaled(16),
            right: scaled(12),
            top: art.title.top,
          },
        ]}>
        <Text
          allowFontScaling={false}
          style={[
            styles.title,
            {
              fontSize: scaled(27),
              lineHeight: art.title.lineHeight,
              color: tokens.colors.text,
            },
          ]}>
          可观测性
        </Text>
        <Text
          allowFontScaling={false}
          style={[
            styles.title,
            {
              fontSize: scaled(27),
              lineHeight: art.title.lineHeight,
              color: tokens.colors.text,
            },
          ]}>
          工程
        </Text>
      </View>
      <Text
        allowFontScaling={false}
        numberOfLines={1}
        style={[
          styles.subtitle,
          {
            left: scaled(16),
            right: scaled(12),
            top: art.subtitle.top,
            fontSize: Math.max(4, scaled(8)),
            lineHeight: Math.max(5, art.subtitle.lineHeight),
            color: tokens.colors.muted,
          },
        ]}>
        指标 · 日志 · 链路 · 用户体验
      </Text>
      <View
        testID="book-cover-graph"
        style={[
          styles.graph,
          {
            left: scaled(16),
            right: scaled(16),
            top: art.graph.top,
            height: art.graph.height,
          },
        ]}>
        <GraphLine
          left={scaled(9)}
          top={scaled(14)}
          width={scaled(34)}
          angle="-20deg"
          height={Math.max(1, scaled(2))}
          color={tokens.colors.accent}
        />
        <GraphLine
          left={scaled(47)}
          top={scaled(13)}
          width={scaled(34)}
          angle="24deg"
          height={Math.max(1, scaled(2))}
          color={tokens.colors.accent}
        />
        <GraphLine
          left={scaled(88)}
          top={scaled(14)}
          width={scaled(36)}
          angle="-18deg"
          height={Math.max(1, scaled(2))}
          color={tokens.colors.accent}
        />
        {[0, 1, 2, 3].map((item, index) => (
          <View
            key={item}
            style={[
              styles.node,
              {
                left: `${index * 27}%`,
                top: index % 2 === 0 ? scaled(11) : 0,
                width: nodeSize,
                height: nodeSize,
                borderWidth: nodeBorderWidth,
                borderRadius: nodeSize / 2,
                borderColor: tokens.colors.accent,
                backgroundColor: tokens.colors.surface,
              },
            ]}
          />
        ))}
      </View>
      <Text
        testID="book-cover-footer"
        allowFontScaling={false}
        numberOfLines={1}
        style={[
          styles.footer,
          {
            left: scaled(16),
            right: scaled(12),
            top: art.footer.top,
            fontSize: Math.max(4, scaled(8)),
            lineHeight: Math.max(5, art.footer.lineHeight),
            color: tokens.colors.accent,
          },
        ]}>
        可观测性实践演示版
      </Text>
    </View>
  );
}

function GraphLine({
  left,
  top,
  width,
  height,
  angle,
  color,
}: {
  left: number;
  top: number;
  width: number;
  height: number;
  angle: string;
  color: string;
}) {
  return (
    <View
      style={[
        styles.graphLine,
        {
          left,
          top,
          width,
          height,
          borderRadius: height / 2,
          backgroundColor: color,
          transform: [{rotate: angle}],
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  cover: {
    width: STOREFRONT_BOOK_COVER_WIDTH,
    aspectRatio: BOOK_COVER_ASPECT_RATIO,
    borderWidth: 3,
    borderRadius: 14,
    overflow: 'hidden',
  },
  compact: {
    width: STOREFRONT_BAG_COVER_WIDTH,
    borderWidth: 2,
    borderRadius: 8,
  },
  whiteCover: {
    backgroundColor: '#fff',
  },
  colorfulCover: {
    backgroundColor: '#fff4f1',
  },
  accentBar: {
    position: 'absolute',
  },
  label: {
    position: 'absolute',
    fontWeight: '900',
  },
  titleGroup: {
    position: 'absolute',
  },
  title: {
    fontWeight: '900',
  },
  subtitle: {
    position: 'absolute',
  },
  graph: {
    position: 'absolute',
  },
  graphLine: {
    position: 'absolute',
  },
  node: {
    position: 'absolute',
  },
  footer: {
    position: 'absolute',
    fontWeight: '800',
  },
});
