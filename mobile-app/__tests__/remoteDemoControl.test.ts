jest.mock('../src/observability', () => ({addError: jest.fn(), log: jest.fn()}));
jest.mock('../src/storage', () => ({writeCrashMarker: jest.fn()}));
import {executeRemoteCommand} from '../src/useRemoteDemoControl';
import type {FaultScenario} from '../src/types';
const fault = {id: 'android_detail_render_error'} as FaultScenario;
const options = () => ({faults: [fault], busy: false, inject: jest.fn(async () => {}), recover: jest.fn(async () => {})});
test('executes the actual injection and recovery callbacks', async () => {
  const value = options();
  await executeRemoteCommand({action: 'inject', faultId: fault.id}, value);
  expect(value.inject).toHaveBeenCalledWith(fault);
  await executeRemoteCommand({action: 'recover'}, value);
  expect(value.recover).toHaveBeenCalledTimes(1);
});
test('does not bypass dangerous confirmation, accept unknown faults, or overlap commands', async () => {
  const value = options();
  value.faults.push({id: 'mobile_native_crash'} as FaultScenario);
  for (const id of ['mobile_native_crash', 'unknown']) {
    await expect(executeRemoteCommand({action: 'inject', faultId: id}, value)).rejects.toThrow();
  }
  await expect(executeRemoteCommand({action: 'inject', faultId: fault.id}, {...value, busy: true})).rejects.toThrow('busy');
  expect(value.inject).not.toHaveBeenCalled();
});
test('reports execution failure rather than confirming a sent command', async () => {
  const value = options();
  value.inject.mockRejectedValueOnce(new Error('backend_failed'));
  await expect(executeRemoteCommand({action: 'inject', faultId: fault.id}, value)).rejects.toThrow('backend_failed');
});

test('cold-start catalog absence is distinguishable from dangerous fault confirmation', async () => {
  await expect(executeRemoteCommand({action: 'inject', faultId: fault.id}, {...options(), faults: []})).rejects.toThrow('catalog_not_ready');
});

test('rejects unavailable build capabilities but allows arming the checkout business scenario', async () => {
  const value = options();
  const crash = {id: 'android_checkout_crash', disabled: true} as FaultScenario;
  value.faults = [crash];
  await expect(executeRemoteCommand({action: 'inject', faultId: crash.id}, value)).rejects.toThrow('scenario_unavailable');
  expect(value.inject).not.toHaveBeenCalled();
  crash.disabled = false;
  await executeRemoteCommand({action: 'inject', faultId: crash.id}, value);
  expect(value.inject).toHaveBeenCalledWith(crash);
});
