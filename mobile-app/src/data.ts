import {storefrontCatalog} from './generated/storefrontData.generated';
import type {StoreLanguage} from './types';

export const PRODUCTS = storefrontCatalog.products;
export const TOPICS = storefrontCatalog.topics;
export const READING_STAGES = storefrontCatalog.readingStages;
export const STORE_MESSAGES = storefrontCatalog.storeMessages;

export type StorefrontProduct = (typeof PRODUCTS)[number];
export type StorefrontProductText = StorefrontProduct[StoreLanguage];
export type StorefrontTopic = (typeof TOPICS)[number];
export type StoreMessageKey = keyof typeof STORE_MESSAGES.zh;

export const DEFAULT_PRODUCT_ID = 'observability-engineering';
export const ORDER_BACKEND_SKU = 'sku-1001';

export function getProduct(productId: string): StorefrontProduct {
  return PRODUCTS.find(product => product.id === productId) ?? PRODUCTS[0];
}

export function getProductText(
  product: StorefrontProduct,
  language: StoreLanguage,
): StorefrontProductText {
  return product[language];
}

export function getTopicText(
  topic: StorefrontTopic,
  language: StoreLanguage,
): {title: string; subtitle: string} {
  return language === 'en'
    ? {title: topic.en, subtitle: topic.enSubtitle}
    : {title: topic.zh, subtitle: topic.zhSubtitle};
}

export function formatPrice(
  amountCent: number,
  language: StoreLanguage,
): string {
  const amount = Math.max(0, Number(amountCent) || 0) / 100;
  return language === 'en'
    ? `CNY ${amount.toFixed(2)}`
    : `￥${amount.toFixed(2)}`;
}

export function storeText(
  language: StoreLanguage,
  key: StoreMessageKey,
  params: Record<string, string | number> = {},
): string {
  const table = STORE_MESSAGES[language];
  const template = String(table[key] ?? STORE_MESSAGES.zh[key] ?? key);
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name)
      ? String(params[name])
      : '',
  );
}

export function topicLabel(
  topicId: string,
  language: StoreLanguage,
): string {
  const topic = TOPICS.find(item => item.id === topicId);
  return topic ? getTopicText(topic, language).title : topicId;
}

// Compatibility projection for native fault helpers and older tests. New
// storefront code consumes PRODUCTS and localized accessors above.
const firstProduct = PRODUCTS[0];
const firstText = firstProduct.zh;
export const BOOK = Object.freeze({
  sku: firstProduct.sku,
  name: firstText.title,
  badge: firstText.badge,
  tagline: firstText.description,
  price: formatPrice(firstProduct.amountCent, 'zh'),
  amountCent: firstProduct.amountCent,
  note: '纸质书',
  author: firstText.authorShort,
  edition: '中文版',
  bullets: firstText.learn.map(item => item[0]),
});

export const EDITORIAL_CARDS = Object.freeze(
  firstText.learn.map((item, index) => ({
    mark: `0${index + 1}`,
    title: item[0],
    description: item[1],
  })),
);
