import {
  Platform,
} from 'react-native';
import {
  FTLogStatus,
  FTMobileReactNative,
  FTReactNativeLog,
  FTReactNativeRUM,
  FTReactNativeTrace,
  TraceType,
} from '@cloudcare/react-native-mobile';
import {
  FTReactNativeSessionReplay,
  SessionReplayPrivacy,
} from '@cloudcare/react-native-session-replay';
import type {DemoUser, MobileRumConfig} from './types';
import {
  androidRumBuildConfig,
  joinGatewayPath,
  nativeAppVersion,
  replayDisabledForDiagnostics,
} from './config';
import {consumeCrashMarker} from './storage';
import {
  isMobileRumConfigured,
  logFeatureConfig,
  nativeRumFeatureConfig,
  traceFeatureConfig,
} from './mobileObservabilityConfig';

let initialized = false;
let initialization: Promise<boolean> | null = null;
let faultContext: Record<string, string | number> = {};
let contextUpdate = Promise.resolve();

async function safely(task: () => Promise<unknown>): Promise<void> {
  try {
    await task();
  } catch {
    // Observability is intentionally non-fatal for the demo storefront.
  }
}

function runSafely(task: () => Promise<unknown>): void {
  safely(task).catch(() => undefined);
}

export async function initializeObservability(
  config: MobileRumConfig,
  gatewayBaseUrl: string,
): Promise<boolean> {
  if (initialized) return true;

  const directAndroidConfig =
    Platform.OS === 'android' ? androidRumBuildConfig : null;
  const effectiveConfig: MobileRumConfig = directAndroidConfig
    ? {
        ...config,
        enabled: true,
        applicationIds: {
          ...config.applicationIds,
          android: directAndroidConfig.appId,
        },
        service: directAndroidConfig.service,
        env: directAndroidConfig.env,
        version: directAndroidConfig.version,
      }
    : {...config, version: nativeAppVersion || config.version};

  if (
    !isMobileRumConfigured(
      effectiveConfig,
      Platform.OS === 'ios' ? 'ios' : 'android',
    )
  ) {
    return false;
  }

  if (initialization) return initialization;
  initialization = (async () => {
    if (!directAndroidConfig) {
      await FTMobileReactNative.sdkConfig({
        datakitUrl: joinGatewayPath(
          gatewayBaseUrl,
          effectiveConfig.datakitPath,
        ),
        service: effectiveConfig.service,
        env: effectiveConfig.env,
        debug: __DEV__,
        compressIntakeRequests: true,
        globalContext: {
          project: effectiveConfig.project,
          app_version: effectiveConfig.version,
          ...faultContext,
        },
      });
    }
    await FTReactNativeRUM.setConfig({
      androidAppId: effectiveConfig.applicationIds.android,
      iOSAppId: effectiveConfig.applicationIds.ios,
      sampleRate: effectiveConfig.sampleRates.session,
      sessionOnErrorSampleRate: effectiveConfig.sampleRates.sessionOnError,
      ...nativeRumFeatureConfig,
      globalContext: {
        project: effectiveConfig.project,
        app_version: effectiveConfig.version,
        ...faultContext,
      },
    });
    await FTReactNativeLog.logConfig({...logFeatureConfig});
    await FTReactNativeTrace.setConfig({
      sampleRate: effectiveConfig.sampleRates.trace,
      traceType: TraceType.ddTrace,
      ...traceFeatureConfig,
    });
    // Skip initialization entirely: zero sampling can still retain error replay buffers.
    if (effectiveConfig.sessionReplayEnabled &&
        !(Platform.OS === 'android' && replayDisabledForDiagnostics)) {
      await FTReactNativeSessionReplay.sessionReplayConfig({
        sampleRate: effectiveConfig.sampleRates.replay,
        sessionReplayOnErrorSampleRate:
          effectiveConfig.sampleRates.sessionOnError,
        privacy: SessionReplayPrivacy.ALLOW,
        enableLinkRUMKeys: ['project', 'app_version'],
      });
    }
    initialized = true;

    const crashMarker = await consumeCrashMarker();
    if (crashMarker) {
      await log(
        'App restarted after injected native crash',
        FTLogStatus.warning,
        crashMarker,
      );
      await addError(
        'InjectedNativeCrashRecovery',
        `Recovered on restart from ${crashMarker.scenarioId}`,
        crashMarker,
      );
    }
    return true;
  })();
  try {
    return await initialization;
  } catch (error) {
    initialization = null;
    throw error;
  }
}

export function initializeBuildTimeObservability(): Promise<boolean> {
  if (Platform.OS !== 'android' || !androidRumBuildConfig) {
    return Promise.resolve(false);
  }
  return initializeObservability(
    {
      enabled: true,
      applicationIds: {android: androidRumBuildConfig.appId, ios: ''},
      project: 'mall-demo',
      service: androidRumBuildConfig.service,
      env: androidRumBuildConfig.env,
      version: androidRumBuildConfig.version,
      datakitPath: '/rum-proxy',
      sampleRates: {session: 1, sessionOnError: 1, trace: 1, replay: 1},
      sessionReplayEnabled: true,
      traceType: 'ddtrace',
    },
    '',
  );
}

export async function getTraceHeaders(
  url: string,
): Promise<Record<string, string>> {
  if (!initialized) {
    return {};
  }
  try {
    const headers = await FTReactNativeTrace.getTraceHeaderFields(url);
    return Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [key, String(value)]),
    );
  } catch {
    return {};
  }
}

export function startView(name: string, context?: object): void {
  if (initialized) {
    runSafely(() => FTReactNativeRUM.startView(name, context));
  }
}

export function stopView(context?: object): void {
  if (initialized) {
    runSafely(() => FTReactNativeRUM.stopView(context));
  }
}

export function action(name: string, context?: object): void {
  if (initialized) {
    runSafely(() => FTReactNativeRUM.startAction(name, 'click', {...faultContext, ...context}));
  }
}

export async function bindUser(
  user: DemoUser | null,
  visitorId: string,
): Promise<void> {
  if (!initialized) return;
  if (!user) {
    await safely(() => FTMobileReactNative.unbindRUMUserData());
    return;
  }
  await safely(() =>
    FTMobileReactNative.bindRUMUserData(
      user.id,
      user.name,
      user.email,
      {
        user_tier: user.tier,
        visitor_id: visitorId,
        auth_state: 'authenticated',
      },
    ),
  );
}

export async function addError(
  type: string,
  message: string,
  context?: object,
  error?: Error,
): Promise<void> {
  if (initialized) {
    await safely(() =>
      FTReactNativeRUM.addErrorWithType(type, error?.stack ?? '', message, {...faultContext, ...context}),
    );
  }
}

export async function log(
  message: string,
  status: FTLogStatus = FTLogStatus.info,
  context?: object,
): Promise<void> {
  if (initialized) {
    await safely(() => FTReactNativeLog.logging(message, status, {...faultContext, ...context}));
  }
}

export function observationApplicationId(config: MobileRumConfig): string {
  return Platform.OS === 'android'
    ? androidRumBuildConfig?.appId || config.applicationIds.android
    : config.applicationIds.ios;
}

export function setFaultObservationContext(context: Record<string, string | number> | null): Promise<void> {
  faultContext = context ?? {fault_run_id: '', fault_id: '', fault_layer: '', fault_phase: 'baseline', fault_started_at: 0};
  const snapshot = {...faultContext};
  // Preserve native SDK ordering when a recovery follows a trigger immediately.
  contextUpdate = contextUpdate.then(async () => {
    if (!initialized) return;
    await safely(() => FTMobileReactNative.appendRUMGlobalContext(snapshot));
    await safely(() => FTMobileReactNative.appendLogGlobalContext(snapshot));
  });
  return contextUpdate;
}

export function recordFaultEvent(name: string, context: object): void {
  const properties = {...faultContext, ...context};
  if (initialized) runSafely(() => FTReactNativeRUM.addAction(name, 'custom', properties));
  runSafely(() => log(name, FTLogStatus.info, properties));
}
