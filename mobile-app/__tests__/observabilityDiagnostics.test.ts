import type {MobileRumConfig} from '../src/types';

const config: MobileRumConfig = {
  enabled: true,
  applicationIds: {android: 'android-app', ios: 'ios-app'},
  project: 'mall-demo', service: 'mall-mobile', env: 'demo', version: '2.3.12',
  datakitPath: '/rum-proxy',
  sampleRates: {session: 1, sessionOnError: 1, trace: 1, replay: 1},
  sessionReplayEnabled: true, traceType: 'ddtrace',
};

it.each([
  ['android', false, false, true],
  ['android', true, false, false],
  ['android', true, true, false],
  ['ios', true, false, true],
])('keeps RUM when platform=%s disableReplay=%s direct=%s', async (os, disabled, direct, recordsReplay) => {
  jest.resetModules();
  const rum = jest.fn();
  const replay = jest.fn();
  const trace = jest.fn();
  const logs = jest.fn();
  jest.doMock('react-native', () => ({Platform: {OS: os}}));
  jest.doMock('../src/config', () => ({
    androidRumBuildConfig: direct ? {appId: 'android-direct', service: 'mall-mobile', env: 'demo', version: '2.3.12'} : null,
    nativeAppVersion: '2.3.12', replayDisabledForDiagnostics: disabled,
    joinGatewayPath: (base: string, path: string) => base + path,
  }));
  jest.doMock('../src/storage', () => ({consumeCrashMarker: jest.fn(async () => null)}));
  jest.doMock('@cloudcare/react-native-mobile', () => ({
    FTMobileReactNative: {sdkConfig: jest.fn()},
    FTReactNativeRUM: {setConfig: rum},
    FTReactNativeLog: {logConfig: logs},
    FTReactNativeTrace: {setConfig: trace},
    TraceType: {ddTrace: 'ddtrace'},
  }));
  jest.doMock('@cloudcare/react-native-session-replay', () => ({
    FTReactNativeSessionReplay: {sessionReplayConfig: replay},
    SessionReplayPrivacy: {ALLOW: 1},
  }));
  const {initializeObservability} = require('../src/observability');
  await expect(initializeObservability(config, 'https://demo.example')).resolves.toBe(true);
  await initializeObservability(config, 'https://demo.example');
  expect(rum).toHaveBeenCalledTimes(1);
  expect(logs).toHaveBeenCalledTimes(1);
  expect(trace).toHaveBeenCalledTimes(1);
  expect(rum).toHaveBeenCalledWith(expect.objectContaining({sampleRate: 1, sessionOnErrorSampleRate: 1}));
  expect(replay).toHaveBeenCalledTimes(recordsReplay ? 1 : 0);
});
