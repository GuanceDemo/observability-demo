import {NativeModules} from 'react-native';
import type {DemoApi} from './api';
import {addError, log} from './observability';
import {writeCrashMarker} from './storage';
import type {FaultScenario, MobilePlatform} from './types';

interface NativeFaultsModule {
  crash(message: string): Promise<void>;
  blockMainThread(durationMs: number): Promise<void>;
}

const nativeFaults = NativeModules.DemoFaults as
  | NativeFaultsModule
  | undefined;

export const dangerousScenarioIds = new Set([
  'mobile_native_crash',
  'mobile_android_anr',
  'mobile_ios_freeze',
]);

export function filterFaultsForPlatform(
  scenarios: FaultScenario[],
  platform: MobilePlatform,
): FaultScenario[] {
  return scenarios.filter(scenario => scenario.platforms.includes(platform));
}

export function findActiveServerFault(
  scenarios: FaultScenario[],
  active: Record<string, unknown>,
): FaultScenario | null {
  const activeModes = new Set(
    Object.values(active)
      .map(value =>
        typeof value === 'object' &&
        value !== null &&
        'mode' in value &&
        typeof value.mode === 'string'
          ? value.mode
          : '',
      )
      .filter(mode => mode && mode !== 'none'),
  );
  return (
    scenarios.find(
      scenario =>
        scenario.execution === 'server' && activeModes.has(scenario.mode),
    ) ?? null
  );
}

export type ClientFaultKind =
  | 'whiteScreen'
  | 'jsError'
  | 'nativeCrash'
  | 'mainThreadBlock'
  | 'slowNetwork';

export function resolveClientFaultKind(
  scenarioId: string,
): ClientFaultKind | null {
  switch (scenarioId) {
    case 'mobile_white_screen':
      return 'whiteScreen';
    case 'mobile_js_error':
      return 'jsError';
    case 'mobile_native_crash':
      return 'nativeCrash';
    case 'mobile_android_anr':
    case 'mobile_ios_freeze':
      return 'mainThreadBlock';
    case 'mobile_slow_network':
      return 'slowNetwork';
    default:
      return null;
  }
}

export function scheduleWhiteScreenRecovery(
  setActive: (active: boolean) => void,
  durationMs = 5000,
  schedule: typeof setTimeout = setTimeout,
): ReturnType<typeof setTimeout> {
  setActive(true);
  return schedule(() => setActive(false), durationMs);
}

export interface ClientFaultContext {
  api: DemoApi;
  project: string;
  setWhiteScreen: (active: boolean) => void;
  schedule?: typeof setTimeout;
  nativeModule?: NativeFaultsModule;
}

export async function injectClientFault(
  scenario: FaultScenario,
  context: ClientFaultContext,
): Promise<void> {
  const kind = resolveClientFaultKind(scenario.id);
  switch (kind) {
    case 'whiteScreen':
      await addError('WhiteScreen', scenario.description, {
        fault_id: scenario.id,
      });
      scheduleWhiteScreenRecovery(
        context.setWhiteScreen,
        5000,
        context.schedule,
      );
      return;
    case 'jsError': {
      await addError('ReactNativeJavaScriptError', scenario.description, {
        fault_id: scenario.id,
      });
      const schedule = context.schedule ?? setTimeout;
      schedule(() => {
        throw new TypeError(
          'Injected React Native JavaScript fault: checkout result is null',
        );
      }, 0);
      return;
    }
    case 'slowNetwork':
      await context.api.slowResource(context.project);
      return;
    case 'nativeCrash': {
      const module = context.nativeModule ?? nativeFaults;
      if (!module) {
        throw new Error('DemoFaults native module is unavailable');
      }
      await writeCrashMarker(scenario.id);
      await log('Injecting real native crash', undefined, {
        fault_id: scenario.id,
      });
      await module.crash(`Injected fault: ${scenario.id}`);
      return;
    }
    case 'mainThreadBlock': {
      const module = context.nativeModule ?? nativeFaults;
      if (!module) {
        throw new Error('DemoFaults native module is unavailable');
      }
      await log('Blocking native main thread', undefined, {
        fault_id: scenario.id,
        duration_ms: 8000,
      });
      await module.blockMainThread(8000);
      return;
    }
    case null:
      throw new Error(`Unsupported mobile client fault: ${scenario.id}`);
  }
}
