export const STOREFRONT_PAGE_HORIZONTAL_INSET = 10;
export const STOREFRONT_HERO_HORIZONTAL_PADDING = 18;
export const STOREFRONT_BOOK_COVER_WIDTH = 180;
export const STOREFRONT_BAG_COVER_WIDTH = 72;
export const BOOK_COVER_ASPECT_RATIO = 0.75;
export const FAULT_EDGE_TAG_WIDTH = 30;
export const FAULT_EDGE_TAG_MIN_HEIGHT = 64;

const FAULT_DRAWER_HEADER_BASE_HEIGHT = 64;
const FAULT_DRAWER_HEADER_TOP_PADDING = 10;
const FAULT_DRAWER_CONTENT_BOTTOM_PADDING = 40;

export interface FaultDrawerInsets {
  top: number;
  right: number;
  bottom: number;
}

export function bookCoverArtLayout(width: number) {
  const normalizedWidth = Math.max(0, width);
  const scale = normalizedWidth / STOREFRONT_BOOK_COVER_WIDTH;
  const scaled = (value: number) => value * scale;
  return {
    width: normalizedWidth,
    height: normalizedWidth / BOOK_COVER_ASPECT_RATIO,
    scale,
    accent: {top: scaled(20), height: scaled(5)},
    label: {top: scaled(34), lineHeight: scaled(12)},
    title: {top: scaled(76), lineHeight: scaled(34), lines: 2},
    subtitle: {top: scaled(156), lineHeight: scaled(12)},
    graph: {top: scaled(178), height: scaled(32)},
    footer: {top: scaled(215), lineHeight: scaled(10)},
  };
}

export function storefrontLayoutForWidth(viewportWidth: number) {
  const width = Math.max(0, viewportWidth);
  const pageWidth = Math.max(
    0,
    width - STOREFRONT_PAGE_HORIZONTAL_INSET * 2,
  );
  const heroContentWidth = Math.max(
    0,
    pageWidth - STOREFRONT_HERO_HORIZONTAL_PADDING * 2,
  );
  return {
    pageWidth,
    heroContentWidth,
    bookCoverWidth: Math.min(
      STOREFRONT_BOOK_COVER_WIDTH,
      heroContentWidth * 0.7,
    ),
    homeTitleFontSize: Math.min(34, Math.max(25, width * 0.09)),
  };
}

export function faultDrawerSafeSpacing(insets: FaultDrawerInsets) {
  const top = Math.max(0, insets.top);
  const right = Math.max(0, insets.right);
  const bottom = Math.max(0, insets.bottom);
  return {
    headerMinHeight: FAULT_DRAWER_HEADER_BASE_HEIGHT + top,
    headerPaddingTop: FAULT_DRAWER_HEADER_TOP_PADDING + top,
    headerPaddingRight: 14 + right,
    contentPaddingRight: 14 + right,
    contentPaddingBottom: FAULT_DRAWER_CONTENT_BOTTOM_PADDING + bottom,
  };
}
