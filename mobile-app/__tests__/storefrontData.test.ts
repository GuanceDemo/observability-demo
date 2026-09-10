import {
  PRODUCTS,
  READING_STAGES,
  STORE_MESSAGES,
  TOPICS,
  formatPrice,
  storeText,
} from '../src/data';

describe('generated storefront data contract', () => {
  it('contains the complete bilingual canonical catalog', () => {
    expect(PRODUCTS).toHaveLength(6);
    expect(TOPICS).toHaveLength(6);
    expect(READING_STAGES).toHaveLength(3);
    expect(PRODUCTS.every(product => product.zh.title && product.en.title)).toBe(true);
    expect(Object.keys(STORE_MESSAGES.zh)).toEqual(Object.keys(STORE_MESSAGES.en));
  });

  it('formats localized prices and interpolated storefront copy', () => {
    expect(formatPrice(9900, 'zh')).toBe('￥99.00');
    expect(formatPrice(9900, 'en')).toBe('CNY 99.00');
    expect(storeText('zh', 'resultCount', {count: 6})).toContain('6');
  });
});
