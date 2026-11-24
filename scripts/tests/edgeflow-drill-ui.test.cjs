const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('order-service/src/main/resources/static/business.html', 'utf8');
const i18nSource = fs.readFileSync('order-service/src/main/resources/static/assets/selfheal-i18n.js', 'utf8');

function createLinkStub() {
  const classes = new Set(['trace-link', 'disabled']);
  const attrs = new Map([['aria-disabled', 'true']]);
  return {
    hidden: true,
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
    observabilityDelayHint: { hidden: true, textContent: '' },
    observabilityRumViewLink: createLinkStub(),
    observabilityTraceLink: createLinkStub(),
    observabilityApmServiceLink: createLinkStub(),
    rumViewLinkHint: { hidden: true, textContent: '' },
    traceLinkHint: { hidden: false, textContent: '' },
    faultBtn: { textContent: '' },
    faultDetailTitle: { textContent: '' },
    faultDetailKind: { textContent: '' },
    faultDetailDesc: { textContent: '' },
    faultDetailService: { textContent: '' },
    faultDetailTarget: { textContent: '' },
    faultDetailTtl: { textContent: '' },
    faultObservation: { textContent: '' },
  };
  const state = {
    language,
    selectedSceneId: 'bookstore',
    activeGameId: null,
    demoConfig,
    lastTraceIds: [],
    lastEdgeflowDrill: null,
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
    updateBusyControls() {},
  });
  vm.runInContext(snippet, ctx);
  return { ctx, state, els };
}

test('EdgeFlow scenario groups under infrastructure and switches action button copy', () => {
  const { ctx, state, els } = buildWorkbenchContext({}, 'zh');
  state.faults = [{
    id: 'edgeflow_tail_sampling',
    title: 'EdgeFlow 尾采样对比压测',
    layer: 'telemetry',
    kind: 'tail_sampling_drill',
    service: 'edgeflow',
    target: 'gateway → datakit → edgeflow',
    ttlSeconds: 0,
    clientSide: false,
    platforms: ['web'],
    scenes: ['bookstore'],
  }];
  const layers = Array.from(vm.runInContext('orderedFaultLayers()', ctx));
  assert.deepEqual(layers, ['infrastructure']);
  vm.runInContext('renderFaultDetail(state.faults[0])', ctx);
  assert.equal(els.faultBtn.textContent, '运行尾采样压测（125 请求）');
  assert.equal(els.faultDetailTtl.textContent, 'batch=125');
  assert.match(els.faultObservation.textContent, /105/);
});

test('EdgeFlow drill populates exact Trace batch link and APM service monitoring link with locked time window', () => {
  const { ctx, els } = buildWorkbenchContext({
    observabilityConsoleUrl: 'https://console.guance.com',
    workspaceId: 'wksp_demo123',
  }, 'zh');

  vm.runInContext(`updateObservabilityEdgeflowLinks({
    batchId: 'ef-demo',
    traceQuery: 'key_request:ef-demo',
    serviceName: 'order-service',
    scannerProbeCount: 20,
    healthyOrderCount: 100,
    paymentErrorOrderCount: 5,
    businessOrderTotal: 105,
    windowStartSec: 1795508995,
    windowEndSec: 1795509035
  })`, ctx);

  assert.equal(els.observabilityTraceLink.hidden, false);
  assert.equal(els.observabilityTraceLink.getAttribute('aria-disabled'), 'false');
  assert.equal(els.observabilityTraceLink.textContent, '查看采样后链路（扫描 0 · 健康 ~10 · 故障 5）');
  const traceUrl = new URL(els.observabilityTraceLink.href);
  assert.equal(traceUrl.origin + traceUrl.pathname, 'https://console.guance.com/tracing/link');
  assert.equal(traceUrl.searchParams.get('w'), 'wksp_demo123');
  assert.equal(traceUrl.searchParams.get('time'), '1795508995,1795509035');
  assert.equal(
    Buffer.from(traceUrl.searchParams.get('query').replace(/^b64-/, ''), 'base64').toString('utf8'),
    'key_request:ef-demo',
  );

  assert.equal(els.observabilityApmServiceLink.hidden, false);
  assert.equal(els.observabilityApmServiceLink.getAttribute('aria-disabled'), 'false');
  assert.equal(els.observabilityApmServiceLink.textContent, '打开 APM 服务监控（总请求精确 105 次）');
  const apmUrl = new URL(els.observabilityApmServiceLink.href);
  assert.equal(apmUrl.origin + apmUrl.pathname, 'https://console.guance.com/tracing/service/detail/dashboard');
  assert.equal(apmUrl.searchParams.get('w'), 'wksp_demo123');
  assert.equal(apmUrl.searchParams.get('fixed_query'), 'service:order-service');
  assert.equal(apmUrl.searchParams.get('time'), '1795508995,1795509035');
  assert.equal(els.observabilityDelayHint.hidden, false);

  // Subsequent normal trace update hides the EdgeFlow APM service link cleanly.
  vm.runInContext(`updateObservabilityTraceLink(['trace-single-001'])`, ctx);
  assert.equal(els.observabilityApmServiceLink.hidden, true);
  assert.equal(els.observabilityTraceLink.textContent, '打开链路详情');
});
