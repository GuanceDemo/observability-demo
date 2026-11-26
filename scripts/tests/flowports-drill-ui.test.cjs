const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('order-service/src/main/resources/static/business.html', 'utf8');
const i18nSource = fs.readFileSync('order-service/src/main/resources/static/assets/selfheal-i18n.js', 'utf8');

function createElStub(extra = {}) {
  const classes = new Set();
  const attrs = new Map();
  return {
    hidden: true,
    disabled: false,
    href: '#',
    textContent: '',
    dataset: {},
    classList: {
      add: (...names) => names.forEach((n) => classes.add(n)),
      remove: (...names) => names.forEach((n) => classes.delete(n)),
      toggle: (name, force) => {
        if (force === undefined) {
          if (classes.has(name)) { classes.delete(name); return false; }
          classes.add(name); return true;
        }
        if (force) classes.add(name); else classes.delete(name);
        return Boolean(force);
      },
      contains: (name) => classes.has(name),
    },
    setAttribute: (k, v) => attrs.set(k, String(v)),
    getAttribute: (k) => attrs.get(k) ?? null,
    ...extra,
  };
}

function buildWorkbenchContext(demoConfig, language = 'zh') {
  const windowObj = { location: { href: `https://demo.example.test/business.html?lang=${language}` } };
  const i18nCtx = vm.createContext({
    window: windowObj,
    document: { documentElement: {}, querySelectorAll: () => [] },
    URL,
  });
  vm.runInContext(i18nSource, i18nCtx);
  const I18N = windowObj.SelfhealI18n;
  I18N.setLanguage(language);

  const els = {
    faultBtn: createElStub({ hidden: false }),
    faultDetailTitle: createElStub(),
    faultDetailKind: createElStub(),
    faultDetailDesc: createElStub(),
    faultDetailService: createElStub(),
    faultDetailTarget: createElStub(),
    faultDetailTtl: createElStub(),
    faultObservation: createElStub(),
    flowportsPanel: createElStub(),
    flowportsDownstreamFaultBtn: createElStub({ hidden: false }),
    flowportsRefreshBtn: createElStub({ hidden: false }),
    flowportsResetBtn: createElStub({ hidden: false }),
    flowportsStatus: createElStub({ hidden: false }),
    flowportsFunnel: createElStub(),
    flowportsSent: createElStub(),
    flowportsDropped: createElStub(),
    flowportsDownstreamReceived: createElStub(),
    flowportsArchiveReceived: createElStub(),
    flowportsOutage: createElStub(),
    flowportsPreview: createElStub(),
    flowportsUiLink: createElStub(),
    flowportsLogLink: createElStub(),
    flowportsCopyQueryBtn: createElStub(),
  };

  const state = {
    language,
    busy: false,
    selectedSceneId: 'bookstore',
    selectedFaultId: 'flowports_data_gateway',
    activeGameId: null,
    demoConfig,
    lastTraceIds: [],
    lastEdgeflowDrill: null,
    lastFlowportsDrill: null,
    flowportsSnapshot: null,
    flowportsError: '',
    lastRumViewContext: null,
    faults: [],
  };

  const snippet =
    html.slice(html.indexOf('    const FAULT_LAYER_GROUPS ='), html.indexOf('    function initialSceneId()')) +
    '\n' +
    html.slice(html.indexOf('    function normalizeTraceIds('), html.indexOf('    function extractTraceIdFromText(')) +
    '\n' +
    html.slice(html.indexOf('    function localizedScenario('), html.indexOf('    function renderActiveFault('));

  const ctx = vm.createContext({
    state,
    els,
    I18N,
    URL,
    btoa: (str) => Buffer.from(str, 'binary').toString('base64'),
    shortId: (v) => v,
    t: (key, params) => I18N.t(key, params, state.language),
    usesAndroidDeviceFrame: () => false,
    selectedBusinessScene: () => ({ id: state.selectedSceneId }),
    selectedFaultScenario: () => state.faults.find((f) => f.id === state.selectedFaultId) || null,
    updateBusyControls() {},
    refreshFlowportsState() {},
  });
  vm.runInContext(snippet, ctx);
  return { ctx, state, els };
}

test('FlowPorts scenario groups under infrastructure and renders panel controls', () => {
  const { ctx, state, els } = buildWorkbenchContext({
    flowportsEnabled: true,
    flowportsUiUrl: 'http://127.0.0.1:18082',
  }, 'zh');
  state.faults = [{
    id: 'flowports_data_gateway',
    title: 'FlowPorts 数据处理与分流',
    layer: 'telemetry',
    kind: 'data_gateway_drill',
    service: 'flowports',
    target: 'order-service → flowports → dataway + sink',
    ttlSeconds: 0,
    clientSide: false,
    platforms: ['web'],
    scenes: ['bookstore'],
  }];

  const layers = Array.from(vm.runInContext('orderedFaultLayers()', ctx));
  assert.deepEqual(layers, ['infrastructure']);
  vm.runInContext('renderFaultDetail(state.faults[0])', ctx);
  assert.equal(els.flowportsPanel.hidden, false);
  assert.equal(els.flowportsUiLink.hidden, false);
  assert.equal(els.flowportsUiLink.href, 'http://127.0.0.1:18082');
});

test('FlowPorts panel renders contrast funnel, masked preview, outage banner, and Guance Log deep link', () => {
  const { ctx, state, els } = buildWorkbenchContext({
    flowportsEnabled: true,
    flowportsUiUrl: 'http://127.0.0.1:18082',
    observabilityConsoleUrl: 'https://console.guance.com',
    workspaceId: 'wksp_demo123',
  }, 'zh');
  state.faults = [{
    id: 'flowports_data_gateway',
    title: 'FlowPorts 数据处理与分流',
    layer: 'telemetry',
    kind: 'data_gateway_drill',
    service: 'flowports',
    target: 'order-service → flowports → dataway + sink',
    ttlSeconds: 0,
    clientSide: false,
    platforms: ['web'],
    scenes: ['bookstore'],
  }];
  state.lastFlowportsDrill = {
    verifyId: 'fp-demo',
    logQuery: 'verify_id:fp-demo',
    totalMessages: 35,
    healthcheckNoiseCount: 20,
    stagingOrderCount: 10,
    prodHighRiskCount: 5,
    sentCount: 35,
    windowStartSec: 1795508995,
    windowEndSec: 1795509060,
    flowportsUiUrl: 'http://127.0.0.1:18082',
  };
  state.flowportsSnapshot = {
    downstreamDown: true,
    downstreamReceivedTotal: 5,
    downstreamRejected503Total: 2,
    archiveReceivedTotal: 10,
    latestVerifyId: 'fp-demo',
    downstreamMatchedCount: 5,
    archiveMatchedCount: 10,
    recentDownstreamEvents: [{
      fields: {
        verify_id: 'fp-demo',
        phone: '138****8000',
        user_tier: 'VIP',
        owner_team: 'checkout-risk',
      },
    }],
    recentArchiveEvents: [],
  };

  vm.runInContext('renderFlowportsPanel(true)', ctx);
  assert.equal(els.flowportsFunnel.hidden, false);
  assert.match(els.flowportsSent.textContent, /35/);
  assert.match(els.flowportsDropped.textContent, /20/);
  assert.match(els.flowportsDownstreamReceived.textContent, /5/);
  assert.match(els.flowportsArchiveReceived.textContent, /10/);
  assert.equal(els.flowportsOutage.hidden, false);
  assert.equal(els.flowportsPreview.hidden, false);
  assert.match(els.flowportsPreview.textContent, /138\*\*\*\*8000/);
  assert.match(els.flowportsPreview.textContent, /VIP/);
  assert.equal(els.flowportsLogLink.hidden, false);
  assert.equal(els.flowportsCopyQueryBtn.hidden, true);
  assert.match(els.flowportsLogLink.href, /^https:\/\/console\.guance\.com\//);
  assert.match(els.flowportsLogLink.href, /wksp_demo123/);
});

test('FlowPorts panel falls back to copy query button when workspaceId is not configured', () => {
  const { ctx, state, els } = buildWorkbenchContext({
    flowportsEnabled: true,
    observabilityConsoleUrl: 'https://console.guance.com',
    workspaceId: '',
  }, 'en');
  state.faults = [{
    id: 'flowports_data_gateway',
    title: 'FlowPorts',
    layer: 'telemetry',
    kind: 'data_gateway_drill',
    service: 'flowports',
    target: 'order-service → flowports → dataway + sink',
    ttlSeconds: 0,
    clientSide: false,
    platforms: ['web'],
    scenes: ['bookstore'],
  }];
  state.lastFlowportsDrill = {
    verifyId: 'fp-demo',
    logQuery: 'verify_id:fp-demo',
    totalMessages: 35,
    healthcheckNoiseCount: 20,
    stagingOrderCount: 10,
    prodHighRiskCount: 5,
    sentCount: 35,
    windowStartSec: 1795508995,
    windowEndSec: 1795509060,
  };
  state.flowportsSnapshot = {
    downstreamDown: false,
    downstreamReceivedTotal: 0,
    downstreamRejected503Total: 0,
    archiveReceivedTotal: 0,
    latestVerifyId: 'fp-demo',
    downstreamMatchedCount: 0,
    archiveMatchedCount: 0,
    recentDownstreamEvents: [],
    recentArchiveEvents: [],
  };

  vm.runInContext('renderFlowportsPanel(true)', ctx);
  assert.equal(els.flowportsLogLink.hidden, true);
  assert.equal(els.flowportsCopyQueryBtn.hidden, false);
  assert.equal(els.flowportsLogLink.href, '#');
});
