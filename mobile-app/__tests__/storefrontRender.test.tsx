import React from 'react';
import {AccessibilityInfo, Image, ScrollView, StyleSheet, Text} from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';
import {PRODUCTS} from '../src/data';
import {storefrontTokens} from '../src/designTokens';
import {AuthOverlay} from '../src/components/AuthOverlay';
import {BookCover} from '../src/components/BookCover';
import {BagScreen} from '../src/screens/BagScreen';
import {DetailScreen} from '../src/screens/DetailScreen';
import {HomeScreen} from '../src/screens/HomeScreen';
import {ReadingPathScreen} from '../src/screens/ReadingPathScreen';
import {ResultToast} from '../src/components/ResultToast';
import {StoreIcon, type StoreIconName} from '../src/components/StoreIcon';
import {cartLines, checkoutSnapshot, initialStoreState} from '../src/store';

const tokens = storefrontTokens;
const noop = () => undefined;

function visibleText(tree: TestRenderer.ReactTestRenderer): string {
  return tree.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat(Infinity)
    .filter(value => typeof value === 'string' || typeof value === 'number')
    .join(' ');
}

describe('native storefront render', () => {
  it('renders critical controls as replay-safe bundled images', () => {
    const criticalIcons: StoreIconName[] = [
      'home',
      'path',
      'cart',
      'fault',
      'user',
      'check',
      'plus',
    ];
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <>
          {criticalIcons.map(name => (
            <StoreIcon key={name} name={name} color="#ff3856" size={21} />
          ))}
        </>,
      );
    });

    const images = tree!.root.findAllByType(Image);
    expect(images).toHaveLength(criticalIcons.length);
    criticalIcons.forEach(name => {
      const icon = tree!.root.findByProps({testID: `store-icon-${name}`});
      expect(icon.props.defaultSource).toBe(icon.props.source);
      expect(icon.props.resizeMode).toBe('contain');
      expect(icon.props.fadeDuration).toBe(0);
      expect(StyleSheet.flatten(icon.props.style)).toEqual({width: 21, height: 21});
      expect(StyleSheet.flatten(icon.props.style).tintColor).toBeUndefined();
    });
    act(() => tree!.unmount());
  });

  it('renders purchase confirmation as a prominent top result alert', async () => {
    const reduceMotion = jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <ResultToast
          toast={{
            tone: 'success',
            title: '购买成功',
            detail: '订单 abc123 已确认。',
          }}
          tokens={tokens}
          topInset={24}
          onDismiss={noop}
        />,
      );
      await Promise.resolve();
    });
    const alert = tree!.root.findByProps({testID: 'result-toast'});
    const style = StyleSheet.flatten(alert.props.style);
    expect(alert.props.accessibilityRole).toBe('alert');
    expect(alert.props.accessibilityLiveRegion).toBe('assertive');
    expect(style.position).toBe('absolute');
    expect(style.top).toBe(34);
    expect(style.bottom).toBeUndefined();
    expect(style.backgroundColor).toBe(tokens.colors.success);
    expect(style.zIndex).toBe(100);
    expect(tree!.root.findByProps({testID: 'result-toast-icon'})).toBeTruthy();
    act(() => tree!.unmount());
    reduceMotion.mockResolvedValue(false);
  });

  it('renders the canonical hero, topic rail, and six-product catalog', () => {
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <HomeScreen
          tokens={tokens}
          language="zh"
          products={[...PRODUCTS]}
          activeTopic="all"
          sort="recommended"
          cart={initialStoreState.cart}
          onTopicChange={noop}
          onSortChange={noop}
          onOpenBook={noop}
          onAddBook={noop}
        />,
      );
    });
    expect(tree!.root.findByProps({testID: 'home-hero'})).toBeTruthy();
    expect(
      tree!.root
        .findAllByType(ScrollView)
        .every(scrollView => scrollView.props.overScrollMode === 'never'),
    ).toBe(true);
    expect(
      PRODUCTS.every(product =>
        Boolean(tree!.root.findByProps({testID: `product-card-${product.id}`})),
      ),
    ).toBe(true);
    expect(visibleText(tree!)).toContain('可观测性工程');
    expect(visibleText(tree!)).toContain('分布式系统可观测性');
    act(() => tree!.unmount());
  });

  it('renders the full reading path and detail tabs', () => {
    let pathTree: TestRenderer.ReactTestRenderer;
    let detailTree: TestRenderer.ReactTestRenderer;
    act(() => {
      pathTree = TestRenderer.create(
        <ReadingPathScreen tokens={tokens} language="en" onOpenBook={noop} />,
      );
      detailTree = TestRenderer.create(
        <DetailScreen
          tokens={tokens}
          language="en"
          product={PRODUCTS[0]}
          tab="chapters"
          quantity={2}
          inCart
          onBack={noop}
          onTabChange={noop}
          onQuantityChange={noop}
          onAdd={noop}
          onBuy={noop}
        />,
      );
    });
    expect(visibleText(pathTree!)).toContain('Shared vocabulary');
    expect(visibleText(pathTree!)).toContain('Scale the practice');
    expect(
      pathTree!.root.findByProps({testID: 'reading-path-screen'}).props
        .overScrollMode,
    ).toBe('never');
    expect(
      detailTree!.root.findByProps({testID: 'detail-screen'}).props
        .overScrollMode,
    ).toBe('never');
    expect(detailTree!.root.findByProps({testID: 'detail-tab-chapters'})).toBeTruthy();
    expect(visibleText(detailTree!)).toContain('The path to observability');
    act(() => {
      pathTree!.unmount();
      detailTree!.unmount();
    });
  });

  it('renders a selected, quantity-aware multi-item cart', () => {
    const state = {
      ...initialStoreState,
      cart: {'observability-engineering': 2, 'distributed-observability': 3},
      selectedCartIds: ['observability-engineering', 'distributed-observability'],
    };
    const snapshot = checkoutSnapshot(state);
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <BagScreen
          tokens={tokens}
          language="zh"
          lines={cartLines(state)}
          selectedCopies={snapshot.totalCopies}
          amountCent={snapshot.amountCent}
          busy={false}
          onBrowse={noop}
          onOpenBook={noop}
          onToggleSelection={noop}
          onSelectAll={noop}
          onRemoveSelected={noop}
          onQuantityChange={noop}
          onRemove={noop}
          onPurchase={noop}
          onBatchPurchase={noop}
        />,
      );
    });
    expect(tree!.root.findByProps({testID: 'cart-line-observability-engineering'})).toBeTruthy();
    expect(tree!.root.findByProps({testID: 'cart-line-distributed-observability'})).toBeTruthy();
    expect(
      tree!.root.findByProps({testID: 'bag-screen'}).props.overScrollMode,
    ).toBe('never');
    expect(visibleText(tree!)).toContain('5 册');
    act(() => tree!.unmount());
  });

  it('renders empty-cart and persona-auth states without native dialogs', () => {
    let emptyTree: TestRenderer.ReactTestRenderer;
    let authTree: TestRenderer.ReactTestRenderer;
    act(() => {
      emptyTree = TestRenderer.create(
        <BagScreen
          tokens={tokens}
          language="zh"
          lines={[]}
          selectedCopies={0}
          amountCent={0}
          busy={false}
          onBrowse={noop}
          onOpenBook={noop}
          onToggleSelection={noop}
          onSelectAll={noop}
          onRemoveSelected={noop}
          onQuantityChange={noop}
          onRemove={noop}
          onPurchase={noop}
          onBatchPurchase={noop}
        />,
      );
      authTree = TestRenderer.create(
        <AuthOverlay
          visible
          tokens={tokens}
          language="en"
          user={null}
          personas={[
            {
              id: 'demo-reader-001',
              name: 'Demo Reader A',
              email: 'reader-a@example.invalid',
              tier: 'standard',
            },
            {
              id: 'demo-reader-002',
              name: 'Demo Reader B',
              email: 'reader-b@example.invalid',
              tier: 'pro',
            },
          ]}
          busy={false}
          error={null}
          onClose={noop}
          onLogin={noop}
          onLogout={noop}
        />,
      );
    });
    expect(emptyTree!.root.findByProps({testID: 'cart-empty'})).toBeTruthy();
    expect(visibleText(emptyTree!)).toContain('购物车还是空的');
    expect(authTree!.root.findByProps({testID: 'auth-overlay'})).toBeTruthy();
    expect(visibleText(authTree!)).toContain('Choose a demo persona');
    expect(visibleText(authTree!)).toContain('Demo Reader B');
    act(() => {
      emptyTree!.unmount();
      authTree!.unmount();
    });
  });

  it('locks bundled artwork to the native 3:4 cover frame', () => {
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <BookCover
          tokens={tokens}
          language="zh"
          product={PRODUCTS[0]}
          width={76}
        />,
      );
    });
    const style = StyleSheet.flatten(
      tree!.root.findByProps({testID: 'book-cover'}).props.style,
    );
    expect(style.width).toBe(76);
    expect(style.height).toBeCloseTo(76 / 0.75);
    act(() => tree!.unmount());
  });
});
