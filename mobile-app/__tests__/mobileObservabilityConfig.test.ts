import {
  isMobileRumConfigured,
  logFeatureConfig,
  nativeRumFeatureConfig,
  traceFeatureConfig,
} from '../src/mobileObservabilityConfig';
import type {MobileRumConfig} from '../src/types';

const config: MobileRumConfig = {
  enabled: true,
  applicationIds: {
    android: 'observability_demo_android',
    ios: '',
  },
  project: 'mall-demo',
  service: 'mall-mobile',
  env: 'demo',
  version: '2.2.1',
  datakitPath: '/rum-proxy',
  sampleRates: {
    session: 1,
    sessionOnError: 1,
    trace: 1,
    replay: 1,
  },
  sessionReplayEnabled: true,
  traceType: 'ddtrace',
};

describe('mobile observability feature configuration', () => {
  it('enables the configured platform without requiring the other App ID', () => {
    expect(isMobileRumConfigured(config, 'android')).toBe(true);
    expect(isMobileRumConfigured(config, 'ios')).toBe(false);
  });

  it('enables all requested native RUM, log and trace features', () => {
    expect(nativeRumFeatureConfig).toMatchObject({
      enableNativeUserAction: true,
      enableNativeUserView: true,
      enableNativeUserViewInFragment: true,
      enableNativeUserResource: true,
      enableTrackNativeFreeze: true,
      enableTrackNativeAppANR: true,
      enableTrackNativeCrash: true,
    });
    expect(logFeatureConfig).toEqual({
      sampleRate: 1,
      enableLinkRumData: true,
      enableCustomLog: true,
      enableConsoleLog: true,
      consoleLogPrefix: 'mall-mobile',
    });
    expect(traceFeatureConfig).toEqual({
      enableLinkRUMData: true,
      enableNativeAutoTrace: true,
    });
  });
});
