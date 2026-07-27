import {NativeModules} from 'react-native';

interface DemoFaultsConstants {
  gatewayUrl?: string;
  dangerousFaultsEnabled?: boolean;
}

export const DEFAULT_GATEWAY_URL = 'http://120.79.13.13:31080';

const nativeConfig = (NativeModules.DemoFaults ?? {}) as DemoFaultsConstants;

export const dangerousFaultsEnabled =
  nativeConfig.dangerousFaultsEnabled === true;

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
