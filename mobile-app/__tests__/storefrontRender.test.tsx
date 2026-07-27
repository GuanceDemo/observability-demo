import React from 'react';
import {StyleSheet, Text} from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';
import {BagScreen} from '../src/screens/BagScreen';
import {HomeScreen} from '../src/screens/HomeScreen';
import {themeFor} from '../src/theme';

const tokens = themeFor('colorful');
const noop = () => undefined;

function flattenedStyle(node: TestRenderer.ReactTestInstance) {
  return StyleSheet.flatten(node.props.style);
}

describe('native storefront render', () => {
  it('renders the mobile home hero as one website-aligned card', () => {
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <HomeScreen
          tokens={tokens}
          inCart={false}
          onViewBook={noop}
          onToggleCart={noop}
        />,
      );
    });

    const hero = tree!.root.findByProps({testID: 'home-hero'});
    const cover = tree!.root.findByProps({testID: 'book-cover'});
    const graph = tree!.root.findByProps({testID: 'book-cover-graph'});
    const footer = tree!.root.findByProps({testID: 'book-cover-footer'});
    const actions = tree!.root.findByProps({testID: 'home-actions'});
    const visibleText = tree!.root
      .findAllByType(Text)
      .map(node => node.props.children)
      .flat(Infinity)
      .filter(value => typeof value === 'string')
      .join(' ');

    expect(flattenedStyle(hero)).toMatchObject({
      paddingHorizontal: 18,
      paddingVertical: 22,
      borderWidth: 1,
      borderRadius: 14,
      gap: 22,
    });
    expect(flattenedStyle(cover).width).toBe(180);
    expect(flattenedStyle(graph)).toMatchObject({top: 178, height: 32});
    expect(flattenedStyle(footer)).toMatchObject({top: 215, lineHeight: 10});
    expect(flattenedStyle(actions).flexDirection).toBeUndefined();
    expect(visibleText).toContain('可观测性工程');
    expect(visibleText).toContain('￥99.00');

    act(() => tree!.unmount());
  });

  it('renders the filled bag with website mobile spacing and cover size', () => {
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <BagScreen
          tokens={tokens}
          cartQuantity={1}
          busy={false}
          onBrowse={noop}
          onRemove={noop}
          onPurchase={noop}
          onBatchPurchase={noop}
        />,
      );
    });

    const item = tree!.root.findByProps({testID: 'bag-item'});
    const cover = tree!.root.findByProps({testID: 'bag-book-cover'});
    const title = tree!.root.findByProps({testID: 'book-cover-title'});
    const graph = tree!.root.findByProps({testID: 'book-cover-graph'});
    const footer = tree!.root.findByProps({testID: 'book-cover-footer'});

    expect(flattenedStyle(item)).toMatchObject({
      padding: 18,
      gap: 12,
    });
    expect(flattenedStyle(cover).width).toBe(72);
    expect(flattenedStyle(title).top).toBeCloseTo(30.4);
    expect(flattenedStyle(graph)).toMatchObject({
      top: 71.2,
      height: 12.8,
    });
    expect(flattenedStyle(footer)).toMatchObject({
      top: 86,
      lineHeight: 5,
    });

    act(() => tree!.unmount());
  });
});
