jest.mock('../src/observability', () => ({
  addError: jest.fn(async () => undefined),
  log: jest.fn(async () => undefined),
}));
jest.mock('../src/storage', () => ({
  writeCrashMarker: jest.fn(async () => undefined),
}));

import {
  filterFaultsForPlatform,
  findActiveServerFault,
  injectClientFault,
  resolveClientFaultKind,
  scheduleWhiteScreenRecovery,
} from '../src/faults';
import type {FaultScenario} from '../src/types';

const scenarios: FaultScenario[] = [
  scenario('mobile_android_anr', ['android']),
  scenario('mobile_ios_freeze', ['ios']),
  scenario('mobile_white_screen', ['android', 'ios']),
];

function scenario(
  id: string,
  platforms: FaultScenario['platforms'],
): FaultScenario {
  return {
    id,
    title: id,
    layer: 'runtime',
    kind: id,
    service: 'mall-mobile',
    target: 'native-main-thread',
    mode: 'client',
    description: id,
    expectedObservation: id,
    ttlSeconds: 0,
    clientSide: true,
    execution: 'client',
    platforms,
  };
}

describe('fault dispatcher', () => {
  it('filters the shared catalog by platform', () => {
    expect(
      filterFaultsForPlatform(scenarios, 'android').map(item => item.id),
    ).toEqual(['mobile_android_anr', 'mobile_white_screen']);
    expect(filterFaultsForPlatform(scenarios, 'ios').map(item => item.id)).toEqual(
      ['mobile_ios_freeze', 'mobile_white_screen'],
    );
  });

  it('maps every local mobile scenario to one dispatcher branch', () => {
    expect(resolveClientFaultKind('mobile_white_screen')).toBe('whiteScreen');
    expect(resolveClientFaultKind('mobile_js_error')).toBe('jsError');
    expect(resolveClientFaultKind('mobile_native_crash')).toBe('nativeCrash');
    expect(resolveClientFaultKind('mobile_android_anr')).toBe('mainThreadBlock');
    expect(resolveClientFaultKind('mobile_ios_freeze')).toBe('mainThreadBlock');
    expect(resolveClientFaultKind('mobile_slow_network')).toBe('slowNetwork');
  });

  it('restores a matching server fault from the shared active catalog', () => {
    const paymentFault = {
      ...scenario('payment_error', ['android', 'ios']),
      execution: 'server' as const,
      clientSide: false,
      mode: 'payment_error',
    };
    expect(
      findActiveServerFault([...scenarios, paymentFault], {
        order: {mode: 'none'},
        payment: {mode: 'payment_error'},
      }),
    ).toEqual(paymentFault);
    expect(
      findActiveServerFault([...scenarios, paymentFault], {
        payment: {mode: 'none'},
      }),
    ).toBeNull();
  });

  it('automatically restores a real root white-screen state', () => {
    jest.useFakeTimers();
    const setActive = jest.fn();
    scheduleWhiteScreenRecovery(setActive, 5000);
    expect(setActive).toHaveBeenCalledWith(true);
    jest.advanceTimersByTime(4999);
    expect(setActive).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    expect(setActive).toHaveBeenLastCalledWith(false);
    jest.useRealTimers();
  });

  it('dispatches native blocking through the injected bridge', async () => {
    const nativeModule = {
      crash: jest.fn(async () => undefined),
      blockMainThread: jest.fn(async () => undefined),
    };
    await injectClientFault(scenario('mobile_android_anr', ['android']), {
      api: {} as never,
      project: 'mall-demo',
      setWhiteScreen: jest.fn(),
      nativeModule,
    });
    expect(nativeModule.blockMainThread).toHaveBeenCalledWith(8000);
  });
});
