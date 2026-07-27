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
  ImagePrivacyLevel,
  TextAndInputPrivacyLevel,
  TouchPrivacyLevel,
} from '@cloudcare/react-native-session-replay';
import type {MobileRumConfig} from './types';
import {joinGatewayPath} from './config';
import {consumeCrashMarker} from './storage';
import {
  isMobileRumConfigured,
  logFeatureConfig,
  nativeRumFeatureConfig,
  traceFeatureConfig,
} from './mobileObservabilityConfig';

let initialized = false;

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
  if (
    !isMobileRumConfigured(
      config,
      Platform.OS === 'ios' ? 'ios' : 'android',
    )
  ) {
    return false;
  }

  await FTMobileReactNative.sdkConfig({
    datakitUrl: joinGatewayPath(gatewayBaseUrl, config.datakitPath),
    service: config.service,
    env: config.env,
    debug: __DEV__,
    compressIntakeRequests: true,
    globalContext: {
      project: config.project,
      app_version: config.version,
    },
  });
  await FTReactNativeRUM.setConfig({
    androidAppId: config.applicationIds.android,
    iOSAppId: config.applicationIds.ios,
    sampleRate: config.sampleRates.session,
    sessionOnErrorSampleRate: config.sampleRates.sessionOnError,
    ...nativeRumFeatureConfig,
    globalContext: {project: config.project, app_version: config.version},
  });
  await FTReactNativeLog.logConfig({
    ...logFeatureConfig,
  });
  await FTReactNativeTrace.setConfig({
    sampleRate: config.sampleRates.trace,
    traceType: TraceType.ddTrace,
    ...traceFeatureConfig,
  });
  if (config.sessionReplayEnabled) {
    await FTReactNativeSessionReplay.sessionReplayConfig({
      sampleRate: config.sampleRates.replay,
      sessionReplayOnErrorSampleRate: config.sampleRates.sessionOnError,
      touchPrivacy: TouchPrivacyLevel.SHOW,
      textAndInputPrivacy: TextAndInputPrivacyLevel.MASK_SENSITIVE_INPUTS,
      imagePrivacy: ImagePrivacyLevel.MASK_NON_BUNDLED_ONLY,
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
    runSafely(() => FTReactNativeRUM.startAction(name, 'click', context));
  }
}

export async function addError(
  type: string,
  message: string,
  context?: object,
): Promise<void> {
  if (initialized) {
    await safely(() =>
      FTReactNativeRUM.addErrorWithType(type, message, message, context),
    );
  }
}

export async function log(
  message: string,
  status: FTLogStatus = FTLogStatus.info,
  context?: object,
): Promise<void> {
  if (initialized) {
    await safely(() => FTReactNativeLog.logging(message, status, context));
  }
}
