export type MobilePlatform = 'android' | 'ios';
export type FaultPlatform = MobilePlatform | 'web';
export type StoreLanguage = 'zh' | 'en';
export type StoreScreen = 'home' | 'path' | 'detail' | 'cart';
export type StoreSort = 'recommended' | 'rating' | 'price-asc';
export type DetailTab = 'overview' | 'chapters' | 'audience';
export type CheckoutMode = 'single' | 'traffic';

export interface DemoUser {
  id: string;
  name: string;
  email: string;
  tier: 'standard' | 'pro' | 'vip' | string;
}

export interface DemoAuthSession {
  authenticated: boolean;
  user: DemoUser | null;
  personas: DemoUser[];
}

export interface FaultScenario {
  id: string;
  title: string;
  layer: string;
  kind: string;
  service: string;
  target: string;
  mode: string;
  description: string;
  expectedObservation: string;
  ttlSeconds: number;
  clientSide: boolean;
  execution: 'client' | 'server';
  platforms: FaultPlatform[];
}

export interface FaultCatalog {
  timestamp: string;
  items: FaultScenario[];
  active: Record<string, unknown>;
}

export interface BookContent {
  bookId: string;
  title: string;
  description: string;
  parts: ReadonlyArray<readonly [string, string, string]>;
}

export type BookContentState =
  | {status: 'idle'}
  | {status: 'loading'; bookId: string}
  | {status: 'ready'; bookId: string; data: BookContent}
  | {status: 'error'; bookId: string; timeout: boolean};

export interface MobileRumConfig {
  enabled: boolean;
  applicationIds: Record<MobilePlatform, string>;
  project: string;
  service: string;
  env: string;
  version: string;
  datakitPath: string;
  sampleRates: {
    session: number;
    sessionOnError: number;
    trace: number;
    replay: number;
  };
  sessionReplayEnabled: boolean;
  traceType: 'ddtrace';
}

export interface DemoPublicConfig {
  project: string;
  observabilityConsoleUrl?: string;
  workspaceId?: string;
}

export interface TraceLookup {
  traceId?: string;
  traceIds?: string[];
}

export interface FaultHistoryItem {
  id: string;
  scenarioId: string;
  title: string;
  status: 'active' | 'recovered' | 'failed';
  timestamp: string;
  detail?: string;
}

export interface OrderRequest {
  sku: string;
  quantity: number;
  amountCent: number;
}

export interface OrderResult {
  status?: string;
  orderId?: string;
  traceId?: string;
  businessRequestId?: string;
  message?: string;
  [key: string]: unknown;
}
