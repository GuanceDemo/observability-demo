const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('order-service/src/main/resources/static/business.html', 'utf8');
const catalog = html.slice(html.indexOf('    const BUSINESS_SCENARIOS ='), html.indexOf('    const compactViewport ='));
const configLoader = html.slice(html.indexOf('    async function loadDemoConfig()'), html.indexOf('    function sendShopMessage('));
function host(body, requested = 'vehicle-telemetry') {
  const state = {selectedSceneId: 'bookstore', previewMode: 'web'};
  const context = vm.createContext({state, window: {}, location: {hostname: 'demo.example.test'},
    initialUrl: new URL(`https://demo.example.test/business.html?scene=${requested}`),
    requestJson: async () => ({response: {ok: true}, body}),
    renderBusinessScenes() {}, renderPreviewMode() {}, updateWorkbenchUrl() {},
    updateFrameUrls() {}, renderFaultCatalog() {}, updateObservabilityRumViewLink() {},
    updateObservabilityTraceLink() {}, log() {}});
  vm.runInContext(catalog + configLoader, context);
  return context;
}

test('ACK runtime config enables the scene and preserves a direct vehicle URL', async () => {
  const ctx = host({vehicleEnabled: true});
  await vm.runInContext('loadDemoConfig()', ctx);
  await vm.runInContext('loadDemoConfig()', ctx);
  assert.equal(ctx.state.selectedSceneId, 'vehicle-telemetry');
  assert.equal(vm.runInContext('BUSINESS_SCENARIOS.filter(s => s.id === "vehicle-telemetry").length', ctx), 1);
});
test('disabled feature and lookalike boolean do not expose the vehicle scene', async () => {
  for (const flag of [false, undefined, 'true']) {
    const ctx = host({vehicleEnabled: flag});
    await vm.runInContext('loadDemoConfig()', ctx);
    assert.equal(ctx.state.selectedSceneId, 'bookstore');
    assert.equal(vm.runInContext('BUSINESS_SCENARIOS.length', ctx), 3);
  }
});
test('late config does not override a scene already selected by the user', async () => {
  const ctx = host({vehicleEnabled: true});
  vm.runInContext('sceneSelectedByUser = true', ctx);
  ctx.state.selectedSceneId = 'webgl-game';
  await vm.runInContext('loadDemoConfig()', ctx);
  assert.equal(ctx.state.selectedSceneId, 'webgl-game');
});

function sceneSwitcher(resetFaultsForSceneChange) {
  const ctx = host({});
  const effects = [];
  ctx.state.activeGameId = 'active-game';
  ctx.resetFaultsForSceneChange = resetFaultsForSceneChange;
  ctx.updateFrameUrls = () => effects.push('navigate');
  ctx.renderControlSidebarMode = () => effects.push('controls');
  ctx.syncPreviewContext = () => effects.push('sync');
  vm.runInContext(html.slice(html.indexOf('    async function selectBusinessScene('),
    html.indexOf('    function setPreviewMode(')), ctx);
  return {ctx, effects};
}

test('scene switching waits for fault cleanup before changing state or navigating', async () => {
  // Existing mall cleanup returns undefined; vehicle cleanup can return true.
  for (const result of [undefined, true]) {
    let finishCleanup;
    const {ctx, effects} = sceneSwitcher(() => new Promise(resolve => { finishCleanup = resolve; }));
    const switching = vm.runInContext('selectBusinessScene("webgl-game")', ctx);
    assert.equal(ctx.state.selectedSceneId, 'bookstore');
    assert.equal(ctx.state.activeGameId, 'active-game');
    assert.deepEqual(effects, []);
    finishCleanup(result);
    await switching;
    assert.equal(ctx.state.selectedSceneId, 'webgl-game');
    assert.equal(ctx.state.activeGameId, null);
    assert.deepEqual(effects, ['navigate', 'sync']);
  }
});

test('scene switching retains the current scene when cleanup declines the switch', async () => {
  const {ctx, effects} = sceneSwitcher(async () => false);
  await vm.runInContext('selectBusinessScene("webgl-game")', ctx);
  assert.equal(ctx.state.selectedSceneId, 'bookstore');
  assert.equal(ctx.state.activeGameId, 'active-game');
  assert.deepEqual(effects, []);
});

test('selecting the active scene preserves its faults and iframe', async () => {
  const {ctx, effects} = sceneSwitcher(() => assert.fail('active scene must not reset faults'));
  await vm.runInContext('selectBusinessScene("bookstore")', ctx);
  assert.equal(ctx.state.activeGameId, 'active-game');
  assert.deepEqual(effects, ['controls', 'sync']);
});

test('fault action fetches the current backend token after restart without a login', async () => {
  const source = fs.readFileSync('scripts/vehicle-demo/local/web/workbench.js', 'utf8');
  const action = source.slice(source.indexOf('  async function act(action)'), source.indexOf("  $('scenario').addEventListener"));
  const calls = [];
  const ctx = vm.createContext({busy: false, connected: true, config: {token: 'old-token'},
    generation: 0, requestId: 'same-idempotency-key', operation: {phase: 'idle'},
    $: () => ({value: 'emqx_backlog'}), renderOperation() {}, notice() {}, applyOperation() {},
    api: async (path, options) => { calls.push({path, options}); return path.endsWith('config') ? {token: 'new-token'} : {operation: {phase: 'injecting'}}; },
    errorMessage: e => { throw e; }});
  vm.runInContext(action, ctx);
  await vm.runInContext('act("inject")', ctx);
  assert.equal(calls[0].path, '/api/vehicle/config');
  assert.equal(calls[1].options.headers['X-Vehicle-Token'], 'new-token');
  assert.equal(JSON.parse(calls[1].options.body).requestId, 'same-idempotency-key');
});
