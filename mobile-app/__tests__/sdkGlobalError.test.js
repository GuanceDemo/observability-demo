const fs = require('fs');
const vm = require('vm');

describe('pinned RN SDK global error integration', () => {
  it('reports the original uncaught error once and invokes the saved runtime handler', async () => {
    const addError = jest.fn(() => Promise.resolve());
    const addErrorWithType = jest.fn();
    const runtimeHandler = jest.fn();
    let handler = runtimeHandler;
    const sandbox = {
      exports: {},
      require: () => ({FTReactNativeRUM: {addError, addErrorWithType}}),
      console: {error: jest.fn()},
      ErrorUtils: {getGlobalHandler: () => handler, setGlobalHandler: next => { handler = next; }},
    };
    vm.runInNewContext(fs.readFileSync(require.resolve('@cloudcare/react-native-mobile/lib/commonjs/rum/FTRumErrorTracking'), 'utf8'), sandbox);
    sandbox.exports.FTRumErrorTracking.startTracking();
    const error = new TypeError('Missing book description');
    handler(error, true);
    await Promise.resolve();
    expect(addError).toHaveBeenCalledWith(error.stack, error.message);
    expect(addError).toHaveBeenCalledTimes(1);
    expect(addErrorWithType).not.toHaveBeenCalled();
    expect(runtimeHandler).toHaveBeenCalledWith(error, true);
  });
  it('observes fatal exceptions from the C++ runtime without intercepting default handling', async () => {
    const addError = jest.fn(() => Promise.resolve());
    let listener;
    const sandbox = {
      exports: {}, require: () => ({FTReactNativeRUM: {addError}}),
      console: {error: jest.fn()},
      ErrorUtils: {getGlobalHandler: () => jest.fn(), setGlobalHandler: jest.fn()},
      RN$useAlwaysAvailableJSErrorHandling: true,
      RN$registerExceptionListener: jest.fn(fn => { listener = fn; }),
    };
    vm.runInNewContext(fs.readFileSync(require.resolve('@cloudcare/react-native-mobile/lib/commonjs/rum/FTRumErrorTracking'), 'utf8'), sandbox);
    sandbox.exports.FTRumErrorTracking.startTracking();
    sandbox.exports.FTRumErrorTracking.startTracking();
    expect(sandbox.RN$registerExceptionListener).toHaveBeenCalledTimes(1);
    const preventDefault = jest.fn();
    listener({isFatal: false, message: 'handled error', preventDefault});
    expect(addError).not.toHaveBeenCalled();
    listener({isFatal: true, message: 'TypeError', extraData: {rawStack: 'original@1:778617'}, preventDefault});
    await Promise.resolve();
    expect(addError).toHaveBeenCalledWith('original@1:778617', 'TypeError');
    expect(preventDefault).not.toHaveBeenCalled();
  });

});
