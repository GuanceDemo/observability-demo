jest.mock('@cloudcare/react-native-mobile', () => ({
  FTLogStatus: {info: 'info', warning: 'warning'},
  TraceType: {ddTrace: 'ddtrace'},
  FTMobileReactNative: {
    sdkConfig: jest.fn(async () => undefined),
    bindRUMUserData: jest.fn(async () => undefined),
    unbindRUMUserData: jest.fn(async () => undefined),
    appendRUMGlobalContext: jest.fn(async () => undefined),
    appendLogGlobalContext: jest.fn(async () => undefined),
  },
  FTReactNativeRUM: {
    setConfig: jest.fn(async () => undefined),
    startView: jest.fn(async () => undefined),
    stopView: jest.fn(async () => undefined),
    startAction: jest.fn(async () => undefined),
    addAction: jest.fn(async () => undefined),
    addErrorWithType: jest.fn(async () => undefined),
  },
  FTReactNativeLog: {
    logConfig: jest.fn(async () => undefined),
    logging: jest.fn(async () => undefined),
  },
  FTReactNativeTrace: {
    setConfig: jest.fn(async () => undefined),
    getTraceHeaderFields: jest.fn(async () => ({})),
  },
}));

jest.mock('@cloudcare/react-native-session-replay', () => ({
  FTReactNativeSessionReplay: {
    sessionReplayConfig: jest.fn(async () => undefined),
  },
  SessionReplayPrivacy: {ALLOW: 1},
}));

jest.mock('../src/config', () => ({...jest.requireActual('../src/config'), nativeAppVersion: '2.3.10'}));

jest.mock('../src/storage', () => ({
  consumeCrashMarker: jest.fn(async () => null),
}));

import {addError, bindUser, initializeObservability, recordFaultEvent, setFaultObservationContext} from '../src/observability';
import {FTMobileReactNative, FTReactNativeRUM, FTReactNativeLog} from '@cloudcare/react-native-mobile';
import {
  FTReactNativeSessionReplay,
  SessionReplayPrivacy,
} from '@cloudcare/react-native-session-replay';

const mockBindUser = FTMobileReactNative.bindRUMUserData as jest.Mock;
const mockUnbindUser = FTMobileReactNative.unbindRUMUserData as jest.Mock;
const mockSessionReplayConfig =
  FTReactNativeSessionReplay.sessionReplayConfig as jest.Mock;

describe('native RUM auth identity', () => {
  beforeAll(async () => {
    await initializeObservability(
      {
        enabled: true,
        applicationIds: {android: 'android-app', ios: 'ios-app'},
        project: 'mall-demo',
        service: 'mall-mobile',
        env: 'demo',
        version: '1.0.0',
        datakitPath: '/rum-proxy',
        sampleRates: {session: 1, sessionOnError: 1, trace: 1, replay: 1},
        sessionReplayEnabled: true,
        traceType: 'ddtrace',
      },
      'https://demo.example',
    );
  });

  it('uses the installed APK version in proxy-mode RUM context', () => {
    expect(FTReactNativeRUM.setConfig).toHaveBeenCalledWith(expect.objectContaining({
      globalContext: expect.objectContaining({app_version: '2.3.10'}),
    }));
  });

  it('records every controlled demo surface without app-level masking', () => {
    expect(mockSessionReplayConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        privacy: SessionReplayPrivacy.ALLOW,
      }),
    );
    const replayConfig = mockSessionReplayConfig.mock.calls[0][0];
    expect(replayConfig).not.toHaveProperty('touchPrivacy');
    expect(replayConfig).not.toHaveProperty('textAndInputPrivacy');
    expect(replayConfig).not.toHaveProperty('imagePrivacy');
  });

  it('binds the persona and correlation context', async () => {
    await bindUser(
      {
        id: 'demo-reader-003',
        name: 'Demo Reader C',
        email: 'reader-c@example.invalid',
        tier: 'vip',
      },
      'visitor-test',
    );
    expect(mockBindUser).toHaveBeenCalledWith(
      'demo-reader-003',
      'Demo Reader C',
      'reader-c@example.invalid',
      {
        user_tier: 'vip',
        visitor_id: 'visitor-test',
        auth_state: 'authenticated',
      },
    );
  });

  it('unbinds RUM user data on logout or session expiry', async () => {
    await bindUser(null, 'visitor-test');
    expect(mockUnbindUser).toHaveBeenCalledTimes(1);
  });

  it('preserves the original error stack and clears fault context without changing SDK identity', async () => {
    const fault = {fault_run_id: 'fault-real-stack', fault_phase: 'triggered'};
    await setFaultObservationContext(fault);
    const error = new TypeError('Missing description');
    await addError(error.name, error.message, {book_id: 'book-1'}, error);
    expect(FTReactNativeRUM.addErrorWithType).toHaveBeenLastCalledWith('TypeError', error.stack,
      error.message, {...fault, book_id: 'book-1'});
    recordFaultEvent('cart_update_missing', {expected_quantity: 1, actual_quantity: 0});
    expect(FTReactNativeRUM.addAction).toHaveBeenLastCalledWith('cart_update_missing', 'custom',
      {...fault, expected_quantity: 1, actual_quantity: 0});
    expect(FTReactNativeLog.logging).toHaveBeenLastCalledWith('cart_update_missing', 'info',
      {...fault, expected_quantity: 1, actual_quantity: 0});
    const bindCount = mockBindUser.mock.calls.length;
    await setFaultObservationContext(null);
    expect(FTMobileReactNative.appendRUMGlobalContext).toHaveBeenLastCalledWith(expect.objectContaining({fault_run_id: '', fault_phase: 'baseline'}));
    expect(FTMobileReactNative.appendLogGlobalContext).toHaveBeenLastCalledWith(expect.objectContaining({fault_run_id: ''}));
    expect(mockBindUser).toHaveBeenCalledTimes(bindCount);
    await addError('Business validation', 'No exception occurred');
    expect(FTReactNativeRUM.addErrorWithType).toHaveBeenLastCalledWith('Business validation', '', 'No exception occurred', expect.any(Object));
  });
});
