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

  it('round-trips theme and shopping bag preferences', async () => {
    await persistStore({
      theme: 'white',
      cartQuantity: 1,
      selectedSku: 'sku-1001',
    });
    await expect(loadPersistedStore()).resolves.toEqual({
      theme: 'white',
      cartQuantity: 1,
      selectedSku: 'sku-1001',
    });
  });

  it('consumes the native crash restart marker only once', async () => {
    await writeCrashMarker('mobile_native_crash');
    await expect(consumeCrashMarker()).resolves.toMatchObject({
      scenarioId: 'mobile_native_crash',
    });
    await expect(consumeCrashMarker()).resolves.toBeNull();
  });
});
