import {
  BOOK_COVER_ASPECT_RATIO,
  FAULT_EDGE_TAG_WIDTH,
  FAULT_EDGE_TAG_MIN_HEIGHT,
  STOREFRONT_BAG_COVER_WIDTH,
  STOREFRONT_BOOK_COVER_WIDTH,
  bookCoverArtLayout,
  faultDrawerSafeSpacing,
  storefrontLayoutForWidth,
} from '../src/layout';

describe('mobile safe-area layout', () => {
  it('keeps the collapsed fault handle narrow without shrinking the store', () => {
    expect(FAULT_EDGE_TAG_WIDTH).toBe(30);
    expect(FAULT_EDGE_TAG_MIN_HEIGHT).toBeGreaterThan(FAULT_EDGE_TAG_WIDTH);
  });

  it.each([360, 390])(
    'matches the website mobile book layout at %ipx',
    width => {
      const layout = storefrontLayoutForWidth(width);
      expect(layout.pageWidth).toBe(width - 20);
      expect(layout.bookCoverWidth).toBe(STOREFRONT_BOOK_COVER_WIDTH);
      expect(layout.heroContentWidth).toBe(width - 56);
      expect(layout.homeTitleFontSize).toBeGreaterThanOrEqual(32.4);
      expect(layout.homeTitleFontSize).toBeLessThanOrEqual(34);
      expect(STOREFRONT_BAG_COVER_WIDTH).toBe(72);
    },
  );

  it('scales the cover down on unusually narrow screens', () => {
    expect(storefrontLayoutForWidth(240).bookCoverWidth).toBeCloseTo(128.8);
  });

  it.each([
    ['full', STOREFRONT_BOOK_COVER_WIDTH],
    ['bag', STOREFRONT_BAG_COVER_WIDTH],
  ])('keeps every %s cover art section inside its bounds', (_, width) => {
    const art = bookCoverArtLayout(width);
    const titleBottom =
      art.title.top + art.title.lineHeight * art.title.lines;
    const subtitleBottom = art.subtitle.top + art.subtitle.lineHeight;
    const graphBottom = art.graph.top + art.graph.height;
    const footerBottom = art.footer.top + art.footer.lineHeight;

    expect(art.height).toBe(width / BOOK_COVER_ASPECT_RATIO);
    expect(titleBottom).toBeLessThan(art.subtitle.top);
    expect(subtitleBottom).toBeLessThan(art.graph.top);
    expect(graphBottom).toBeLessThan(art.footer.top);
    expect(footerBottom).toBeLessThanOrEqual(art.height);
  });

  it('keeps the drawer header and scroll footer outside system bars', () => {
    expect(
      faultDrawerSafeSpacing({top: 44, right: 6, bottom: 34}),
    ).toEqual({
      headerMinHeight: 108,
      headerPaddingTop: 54,
      headerPaddingRight: 20,
      contentPaddingRight: 20,
      contentPaddingBottom: 74,
    });
  });

  it('normalizes invalid negative insets', () => {
    expect(
      faultDrawerSafeSpacing({top: -1, right: -1, bottom: -1}),
    ).toMatchObject({
      headerMinHeight: 64,
      headerPaddingTop: 10,
      headerPaddingRight: 14,
      contentPaddingRight: 14,
      contentPaddingBottom: 40,
    });
  });
});
