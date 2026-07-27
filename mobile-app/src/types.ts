export type MobilePlatform = 'android' | 'ios';
export type FaultPlatform = MobilePlatform | 'web';
export type StoreScreen = 'home' | 'detail' | 'purchase';
export type ThemeName = 'colorful' | 'white';

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

export interface OrderResult {
  status?: string;
  orderId?: string;
  traceId?: string;
  businessRequestId?: string;
  message?: string;
  [key: string]: unknown;
}
