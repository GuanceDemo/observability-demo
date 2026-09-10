import AsyncStorage from '@react-native-async-storage/async-storage';
import {DEFAULT_PRODUCT_ID, PRODUCTS} from './data';
import type {HydratedStoreState} from './store';
import type {StoreLanguage, StoreSort} from './types';

const LEGACY_STORE_KEY = 'mall-demo-mobile:store:v1';
const STORE_KEY = 'mall-demo-mobile:store:v2';
const CRASH_MARKER_KEY = 'mall-demo-mobile:crash-marker:v1';

export interface PersistedStoreV2 extends HydratedStoreState {
  version: 2;
}

interface LegacyPersistedStore {
  cartQuantity?: number;
  selectedSku?: string;
}

export interface CrashMarker {
  scenarioId: string;
  createdAt: string;
}

function createVisitorId(random = Math.random): string {
  const section = (length: number) =>
    Array.from({length}, () => Math.floor(random() * 16).toString(16)).join('');
  return `visitor-${section(8)}-${section(4)}-4${section(3)}-a${section(3)}-${section(12)}`;
}

function defaultStore(): PersistedStoreV2 {
  return {
    version: 2,
    language: 'zh',
    currentBookId: DEFAULT_PRODUCT_ID,
    activeTopic: 'all',
    sort: 'recommended',
    cart: {[DEFAULT_PRODUCT_ID]: 1},
    selectedCartIds: [DEFAULT_PRODUCT_ID],
    visitorId: createVisitorId(),
  };
}

function isLanguage(value: unknown): value is StoreLanguage {
  return value === 'zh' || value === 'en';
}

function isSort(value: unknown): value is StoreSort {
  return value === 'recommended' || value === 'rating' || value === 'price-asc';
}

function normalizeV2(value: unknown): PersistedStoreV2 | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<PersistedStoreV2>;
  if (raw.version !== 2) return null;
  const ids = new Set<string>(PRODUCTS.map(product => product.id));
  const cart = Object.fromEntries(
    Object.entries(raw.cart ?? {})
      .filter(([bookId, quantity]) => ids.has(bookId) && Number(quantity) > 0)
      .map(([bookId, quantity]) => [
        bookId,
        Math.max(1, Math.min(99, Math.floor(Number(quantity)))),
      ]),
  );
  const currentBookId = ids.has(String(raw.currentBookId))
    ? String(raw.currentBookId)
    : DEFAULT_PRODUCT_ID;
  return {
    version: 2,
    language: isLanguage(raw.language) ? raw.language : 'zh',
    currentBookId,
    activeTopic:
      typeof raw.activeTopic === 'string' ? raw.activeTopic : 'all',
    sort: isSort(raw.sort) ? raw.sort : 'recommended',
    cart,
    selectedCartIds: Array.isArray(raw.selectedCartIds)
      ? raw.selectedCartIds.filter(
          (bookId): bookId is string =>
            typeof bookId === 'string' && cart[bookId] > 0,
        )
      : [],
    visitorId:
      typeof raw.visitorId === 'string' && raw.visitorId.startsWith('visitor-')
        ? raw.visitorId
        : createVisitorId(),
  };
}

function migrateLegacy(value: unknown): PersistedStoreV2 {
  const next = defaultStore();
  if (!value || typeof value !== 'object') return next;
  const legacy = value as LegacyPersistedStore;
  if (legacy.cartQuantity === 1) {
    next.cart = {[DEFAULT_PRODUCT_ID]: 1};
    next.selectedCartIds = [DEFAULT_PRODUCT_ID];
  } else {
    next.cart = {};
    next.selectedCartIds = [];
  }
  return next;
}

export async function loadPersistedStore(): Promise<PersistedStoreV2> {
  const rawV2 = await AsyncStorage.getItem(STORE_KEY);
  if (rawV2) {
    try {
      const normalized = normalizeV2(JSON.parse(rawV2));
      if (normalized) return normalized;
    } catch {
      // Fall through to the legacy record or fresh defaults.
    }
  }

  const legacyRaw = await AsyncStorage.getItem(LEGACY_STORE_KEY);
  if (!legacyRaw) return defaultStore();
  try {
    return migrateLegacy(JSON.parse(legacyRaw));
  } catch {
    return defaultStore();
  }
}

export async function persistStore(store: HydratedStoreState): Promise<void> {
  const persisted: PersistedStoreV2 = {...store, version: 2};
  await AsyncStorage.setItem(STORE_KEY, JSON.stringify(persisted));
}

export async function writeCrashMarker(scenarioId: string): Promise<void> {
  const marker: CrashMarker = {scenarioId, createdAt: new Date().toISOString()};
  await AsyncStorage.setItem(CRASH_MARKER_KEY, JSON.stringify(marker));
}

export async function consumeCrashMarker(): Promise<CrashMarker | null> {
  const raw = await AsyncStorage.getItem(CRASH_MARKER_KEY);
  if (!raw) return null;
  await AsyncStorage.removeItem(CRASH_MARKER_KEY);
  try {
    const marker = JSON.parse(raw) as CrashMarker;
    return typeof marker.scenarioId === 'string' ? marker : null;
  } catch {
    return null;
  }
}
