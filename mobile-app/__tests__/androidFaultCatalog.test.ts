import {NativeModules} from 'react-native';
import {androidFaultCatalog, BUSINESS_FAULT_IDS, crashCheckout, faultLayerGroup} from '../src/businessFaults';
import type {FaultScenario} from '../src/types';

test('replaces only client entries, retains server contracts, and groups infrastructure', () => {
  NativeModules.DemoFaults = {checkoutCrashEnabled: true};
  const server = {id: 'order_slow', layer: 'service', execution: 'server'} as FaultScenario;
  const legacy = {id: 'mobile_native_crash', execution: 'client'} as FaultScenario;
  const catalog = androidFaultCatalog([server, legacy], 'zh');
  expect(catalog.map(item => item.id)).toEqual([...Object.values(BUSINESS_FAULT_IDS), server.id]);
  expect(catalog.at(-1)).toBe(server);
  expect(catalog.slice(0, 3).every(item => item.layer === 'android')).toBe(true);
  expect(['android', 'service', 'dependency', 'jvm'].map(faultLayerGroup)).toEqual(['android', 'backend', 'infrastructure', 'infrastructure']);
});

test('normal builds disable checkout crash and never call the bridge', async () => {
  NativeModules.DemoFaults = {checkoutCrashEnabled: false, crashCheckout: jest.fn()};
  expect(androidFaultCatalog([], 'zh').find(item => item.id === BUSINESS_FAULT_IDS.crash)).toMatchObject({disabled: true});
  await expect(crashCheckout()).rejects.toThrow('demonstration build');
  expect(NativeModules.DemoFaults.crashCheckout).not.toHaveBeenCalled();
});
