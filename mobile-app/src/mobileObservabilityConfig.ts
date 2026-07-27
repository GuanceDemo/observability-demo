import type {MobilePlatform, MobileRumConfig} from './types';

export const nativeRumFeatureConfig = {
  enableAutoTrackUserAction: true,
  enableAutoTrackError: true,
  enableTrackNativeCrash: true,
  enableTrackNativeAppANR: true,
  enableTrackNativeFreeze: true,
  nativeFreezeDurationMs: 1000,
  enableNativeUserAction: true,
  enableNativeUserView: true,
  enableNativeUserViewInFragment: true,
  enableNativeUserResource: true,
} as const;

export const logFeatureConfig = {
  sampleRate: 1,
  enableLinkRumData: true,
  enableCustomLog: true,
  enableConsoleLog: true,
  consoleLogPrefix: 'mall-mobile',
} as const;

export const traceFeatureConfig = {
  enableLinkRUMData: true,
  enableNativeAutoTrace: true,
} as const;

export function isMobileRumConfigured(
  config: MobileRumConfig,
  platform: MobilePlatform,
): boolean {
  return config.enabled && Boolean(config.applicationIds[platform]?.trim());
}
