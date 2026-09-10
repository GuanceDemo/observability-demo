import {NativeModules} from 'react-native';

interface DemoFaultsConstants {
  gatewayUrl?: string;
  dangerousFaultsEnabled?: boolean;
  replayDisabledForDiagnostics?: boolean;
  rumDirectEnabled?: boolean;
  rumAndroidAppId?: string;
  rumService?: string;
  rumEnv?: string;
  appVersion?: string;
  rumNativeCoreInitialized?: boolean;
}

export interface AndroidRumBuildConfig {
  appId: string;
  service: string;
  env: string;
  version: string;
  nativeCoreInitialized: boolean;
}

export const DEFAULT_GATEWAY_URL = 'http://120.79.13.13:31080';

const nativeConfig = (NativeModules.DemoFaults ?? {}) as DemoFaultsConstants;

export const dangerousFaultsEnabled =
  nativeConfig.dangerousFaultsEnabled === true;

export const replayDisabledForDiagnostics =
  nativeConfig.replayDisabledForDiagnostics === true;

// Proxy-based RUM must also identify the APK actually installed on the device.
export const nativeAppVersion = nativeConfig.appVersion?.trim() ?? '';

function normalized(value: string | undefined): string {
  return value?.trim() ?? '';
}

export function resolveAndroidRumBuildConfig(
  constants: DemoFaultsConstants,
): AndroidRumBuildConfig | null {
  const appId = normalized(constants.rumAndroidAppId);
  if (constants.rumDirectEnabled !== true || !appId) return null;
  return {
    appId,
    service: normalized(constants.rumService) || 'mall-app-android',
    env: normalized(constants.rumEnv) || 'prod',
    version: normalized(constants.appVersion) || '2.3.9',
    nativeCoreInitialized: constants.rumNativeCoreInitialized === true,
  };
}

export const androidRumBuildConfig =
  resolveAndroidRumBuildConfig(nativeConfig);

export function resolveGatewayUrl(
  nativeGatewayUrl: string | undefined = nativeConfig.gatewayUrl,
): string {
  const configured = nativeGatewayUrl?.trim().replace(/\/+$/, '');
  if (configured) {
    return configured;
  }
  return DEFAULT_GATEWAY_URL;
}

export const gatewayUrl = resolveGatewayUrl();

export function joinGatewayPath(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
