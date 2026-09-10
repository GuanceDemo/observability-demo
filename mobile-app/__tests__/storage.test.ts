jest.mock(
  '@react-native-async-storage/async-storage',
  () =>
    require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  consumeCrashMarker,
  loadPersistedStore,
  persistStore,
  writeCrashMarker,
} from '../src/storage';

describe('persistent mobile state', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('round-trips v2 catalog and shopping-cart preferences', async () => {
    const value = {
      language: 'en' as const,
      currentBookId: 'implementing-slo',
      activeTopic: 'reliability',
      sort: 'rating' as const,
      cart: {'implementing-slo': 2, 'sre-workbook': 1},
      selectedCartIds: ['implementing-slo'],
      visitorId: 'visitor-00000000-0000-4000-a000-000000000000',
    };
    await persistStore(value);
    await expect(loadPersistedStore()).resolves.toEqual({version: 2, ...value});
  });

  it('migrates the v1 single-book cart without overwriting the legacy key', async () => {
    const legacy = JSON.stringify({cartQuantity: 1, selectedSku: 'sku-1001'});
    await AsyncStorage.setItem('mall-demo-mobile:store:v1', legacy);
    await expect(loadPersistedStore()).resolves.toMatchObject({
      version: 2,
      cart: {'observability-engineering': 1},
      selectedCartIds: ['observability-engineering'],
    });
    await expect(AsyncStorage.getItem('mall-demo-mobile:store:v1')).resolves.toBe(legacy);
  });

  it('consumes the native crash restart marker only once', async () => {
    await writeCrashMarker('mobile_native_crash');
    await expect(consumeCrashMarker()).resolves.toMatchObject({
      scenarioId: 'mobile_native_crash',
    });
    await expect(consumeCrashMarker()).resolves.toBeNull();
  });
});
