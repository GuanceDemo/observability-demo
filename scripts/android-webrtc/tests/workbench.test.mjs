import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';
const root = new URL('../../../', import.meta.url);
const html = readFileSync(new URL('order-service/src/main/resources/static/business.html', root), 'utf8');

test('workbench inline scripts parse and untrusted latency payloads stay bounded', () => {
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
  const code = html.slice(html.indexOf('    function normalizeAndroidLatencyWindow'), html.indexOf('    function renderAndroidDebug'));
  const context = vm.createContext({finiteDebugNumber: value => Number.isFinite(value) ? value : null});
  vm.runInContext(code, context);
  const normalized = context.normalizeAndroidDebugPayload({
    inputAppAckStatus: 'ambiguous', inputReleaseToAppAckMs: 120,
    videoFrameTiming: {ageMs: 'fake', processingMs: Infinity, secret: 'hidden'},
    latencyWindow: {modes: {video: {count: 100000, visual: {count: 2, p50Ms: 50, p95Ms: 100, timeoutCount: 1, timeoutPercent: 150}}}},
  });
  assert.equal(normalized.inputAppAckStatus, 'ambiguous');
  assert.equal(normalized.inputReleaseToAppAckMs, 120);
  assert.equal(normalized.videoFrameTiming.ageMs, null);
  assert.equal(normalized.videoFrameTiming.processingMs, null);
  assert.equal('secret' in normalized.videoFrameTiming, false);
  assert.equal(normalized.latencyWindow.video.count, 0);
  assert.equal(normalized.latencyWindow.video.visual.count, 2);
  assert.equal(normalized.latencyWindow.video.visual.timeoutPercent, null);
  assert.equal(normalized.latencyWindow.snapshot.visual.p95Ms, null);
});

test('Android runtime versions control URLs and metadata independently', () => {
  const state = {demoConfig: {mobileDeviceEnabled: true, mobileDevicePlayerUrl: 'https://device.example.test/android-emulator-webrtc/?v=existing'}, language: 'zh'};
  const els = {apkDownloadToggle: {}, apkDownloadPopover: {}, apkDownloadMeta: {}, apkDownloadLink: {}, apkDownloadQr: {}};
  const context = vm.createContext({state, els, URL, URLSearchParams, window: {location: {search: ''}},
    usesAndroidDeviceFrame: () => true,
    document: {documentElement: {}, querySelectorAll: () => []},
  });
  vm.runInContext(readFileSync(new URL('order-service/src/main/resources/static/assets/selfheal-i18n.js', root), 'utf8'), context);
  context.t = (key, params) => context.window.SelfhealI18n.t(key, params, state.language);
  vm.runInContext(html.slice(html.indexOf('    function mobileDevicePlayerUrl()'), html.indexOf('    function toggleApkDownload()')), context);
  vm.runInContext(html.slice(html.indexOf('    function activeFrameSource('), html.indexOf('    function ', html.indexOf('    function activeFrameSource(') + 15)), context);
  assert.equal(new URL(context.activeFrameSource().embeddedUrl).searchParams.get('v'), 'existing');
  assert.equal(context.mobileDeviceAssetUrl('mall-demo-safe.apk'), 'https://device.example.test/downloads/mall-demo-safe.apk');
  context.renderApkDownload();
  assert.equal(els.apkDownloadMeta.textContent, 'Android 7.0+');
  Object.assign(state.demoConfig, {mobileDevicePlayerVersion: 'player-42', mobileDeviceApkVersion: '2.3.15', mobileDeviceApkMinAndroidVersion: '8.0'});
  assert.equal(new URL(context.activeFrameSource().embeddedUrl).searchParams.get('v'), 'player-42');
  context.renderApkDownload();
  assert.equal(els.apkDownloadMeta.textContent, 'v2.3.15 · Android 8.0+');
  state.language = context.window.SelfhealI18n.setLanguage('en');
  context.renderApkDownload();
  assert.equal(els.apkDownloadMeta.textContent, 'v2.3.15 · Android 8.0+');
  for (const url of [els.apkDownloadLink.href, els.apkDownloadQr.src]) assert.equal(new URL(url).searchParams.get('v'), '2.3.15');
  state.demoConfig.mobileDevicePlayerVersion = 'bad?version';
  state.demoConfig.mobileDeviceApkVersion = '<script>';
  state.demoConfig.mobileDeviceApkMinAndroidVersion = '<img>';
  context.renderApkDownload();
  assert.equal(els.apkDownloadMeta.textContent, 'Android 7.0+');
  assert.equal(new URL(context.activeFrameSource().embeddedUrl).searchParams.get('v'), 'existing');
  state.demoConfig.mobileDevicePlayerUrl = 'https://device.example.test/custom/?v=custom&latestVideo=0';
  state.demoConfig.mobileDevicePlayerVersion = 'player-42';
  assert.equal(new URL(context.activeFrameSource().embeddedUrl).searchParams.get('v'), 'custom');
});
