import assert from 'node:assert/strict';
import {test} from 'node:test';
import {startPlayerDiagnostics} from '../player/vehicle-diagnostics.js';

function fixture(origin = 'https://vehicle.example', search = '') {
  let now = 0, callback, recoveries = 0, hidden;
  const reports = [];
  const video = {currentTime: 0, videoWidth: 1280, videoHeight: 720, readyState: 2};
  const driver = {connected: true, peerConnection: {connectionState: 'connected'},
    recoverConnection: () => { recoveries += 1; }};
  const window = {
    location: {search: `?hostOrigin=${encodeURIComponent(origin)}${search}`},
    performance: {now: () => now},
    parent: {postMessage: (value, target) => reports.push({value, target})},
    setInterval: fn => { callback = fn; return 1; },
    clearInterval: () => { callback = undefined; },
    addEventListener: (event, fn) => { if (event === 'pagehide') hidden = fn; },
    __mallDemoJsepDriver: driver,
  };
  startPlayerDiagnostics({window, document: {querySelector: () => video}});
  return {video, driver, reports, advance(ms) { now += ms; callback?.(); },
    hide() { hidden?.(); }, recoveries: () => recoveries};
}

test('vehicle readiness requires fresh landscape frames and a connected transport', () => {
  const f = fixture();
  f.advance(1000);
  assert.equal(f.reports.at(-1).value.payload.ready, false);
  f.video.currentTime = 1; f.advance(1000);
  assert.equal(f.reports.at(-1).value.payload.ready, true);
  assert.equal(f.reports.at(-1).target, 'https://vehicle.example');
  f.advance(5000);
  assert.equal(f.reports.at(-1).value.payload.ready, false);
  f.video.currentTime = 2; f.video.videoWidth = 720; f.advance(1000);
  assert.equal(f.reports.at(-1).value.payload.ready, false);
  f.video.videoWidth = 1280; f.driver.peerConnection.connectionState = 'disconnected'; f.advance(1000);
  assert.equal(f.reports.at(-1).value.payload.ready, false);
  f.driver.peerConnection.connectionState = 'connected'; f.video.paused = true; f.advance(1000);
  assert.equal(f.reports.at(-1).value.payload.ready, false);
});

test('managed playback echoes the session and leaves recovery to the workbench', () => {
  const f = fixture('http://localhost:8767', '&managedRecovery=1&playerSession=test-session');
  for (let n = 0; n < 10; n++) f.advance(31000);
  assert.equal(f.recoveries(), 0);
  assert.equal(f.reports.at(-1).value.payload.session, 'test-session');
  assert.equal(f.reports.at(-1).value.payload.ready, false);
});

test('stalled video recovery is bounded and pagehide stops all reporting', () => {
  const f = fixture();
  f.advance(20000); assert.equal(f.recoveries(), 0);
  for (let n = 0; n < 10; n += 1) f.advance(31000);
  assert.equal(f.recoveries(), 3);
  const count = f.reports.length;
  f.hide(); f.advance(31000);
  assert.equal(f.reports.length, count);
});

test('malformed or non-web parent origins never start diagnostics', () => {
  for (const origin of ['', 'not a URL', 'https://vehicle.example/path', 'file://', 'null']) {
    const f = fixture(origin); f.advance(60000);
    assert.equal(f.reports.length, 0);
    assert.equal(f.recoveries(), 0);
  }
});
