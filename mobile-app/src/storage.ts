import AsyncStorage from '@react-native-async-storage/async-storage';

const STORE_KEY = 'mall-demo-mobile:store:v1';
const CRASH_MARKER_KEY = 'mall-demo-mobile:crash-marker:v1';

export interface PersistedStore {
  cartQuantity: number;
  selectedSku: string;
}

export interface CrashMarker {
  scenarioId: string;
  createdAt: string;
}

export async function loadPersistedStore(): Promise<PersistedStore> {
  const raw = await AsyncStorage.getItem(STORE_KEY);
  if (!raw) {
    return {cartQuantity: 0, selectedSku: 'sku-1001'};
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedStore>;
    return {
      cartQuantity: parsed.cartQuantity === 1 ? 1 : 0,
      selectedSku:
        typeof parsed.selectedSku === 'string' ? parsed.selectedSku : 'sku-1001',
    };
  } catch {
    return {cartQuantity: 0, selectedSku: 'sku-1001'};
  }
}

export async function persistStore(store: PersistedStore): Promise<void> {
  await AsyncStorage.setItem(STORE_KEY, JSON.stringify(store));
}

export async function writeCrashMarker(scenarioId: string): Promise<void> {
  const marker: CrashMarker = {scenarioId, createdAt: new Date().toISOString()};
  await AsyncStorage.setItem(CRASH_MARKER_KEY, JSON.stringify(marker));
}

export async function consumeCrashMarker(): Promise<CrashMarker | null> {
  const raw = await AsyncStorage.getItem(CRASH_MARKER_KEY);
  if (!raw) {
    return null;
  }
  await AsyncStorage.removeItem(CRASH_MARKER_KEY);
  try {
    const marker = JSON.parse(raw) as CrashMarker;
    return typeof marker.scenarioId === 'string' ? marker : null;
  } catch {
    return null;
  }
}
