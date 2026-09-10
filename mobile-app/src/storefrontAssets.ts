import type {ImageSourcePropType} from 'react-native';

export const primaryCoverAssets: Record<'zh' | 'en', ImageSourcePropType> = {
  zh: require('./assets/storefront/observability-engineering-zh.png'),
  en: require('./assets/storefront/observability-engineering-en.png'),
};

export const personaAvatarAssets: Record<string, ImageSourcePropType> = {
  'demo-reader-001': require('./assets/storefront/avatars/demo-reader-a.png'),
  'demo-reader-002': require('./assets/storefront/avatars/demo-reader-b.png'),
  'demo-reader-003': require('./assets/storefront/avatars/demo-reader-c.png'),
};
