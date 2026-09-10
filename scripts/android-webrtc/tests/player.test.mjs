import assert from 'node:assert/strict';
import {test} from 'node:test';
import {startPlayerDiagnostics} from '../player/diagnostics.js';

const settle = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve}; };
class Events {
  listeners = new Map();
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  emit(type, event = {}) { for (const fn of this.listeners.get(type) || []) fn(event); }
}
function fixture({snapshotFetch, ackFetch, deviceFetch, statsFetch, autoDecode = true, videoCallbacks = true} = {}) {
  let now = 0, id = 0, recoveryCount = 0;
  const timers = new Map(), requests = [], images = [], reports = [], revoked = [];
  const frames = new Map();
  class Image {
    dataset = {}; style = {}; naturalWidth = 0; naturalHeight = 800; complete = false; isConnected = false;
    setAttribute() {}
    remove() { this.isConnected = false; }
    set src(value) { this.objectUrl = value; if (autoDecode) queueMicrotask(() => this.finish()); }
    finish() { this.complete = true; this.naturalWidth = 360; this.onload?.(); }
  }
  class Video {
    readyState = 2; videoWidth = 720; videoHeight = 1600; pixels = 240;
    getBoundingClientRect() { return {left: 0, top: 0, right: 360, bottom: 800, width: 360, height: 800}; }
    requestVideoFrameCallback(fn) { frames.set(++id, fn); return id; }
    cancelVideoFrameCallback(handle) { frames.delete(handle); }
    present(metadata = {}) { const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(now, metadata); }
  }
  const video = new Video();
  if (!videoCallbacks) video.requestVideoFrameCallback = undefined;
  let source;
  const canvas = {getContext: () => ({drawImage: image => {source = image;}, getImageData: () => ({data: new Uint8ClampedArray(72 * 160 * 4).fill(source.pixels ?? 255)})})};
  const document = Object.assign(new Events(), {
    createElement: tag => tag === 'canvas' ? canvas : (() => {const image = new Image(); images.push(image); return image;})(),
    querySelector: () => video,
    body: {appendChild: image => {image.isConnected = true;}},
  });
  class ObjectURL extends URL { static createObjectURL() {return `blob:${++id}`;} static revokeObjectURL(url) {revoked.push(url);} }
  const window = Object.assign(new Events(), {
    document, HTMLVideoElement: Video, HTMLImageElement: Image, URL: ObjectURL, AbortController,
    location: {search: '?embedded=1', origin: 'https://device.example'},
    performance: {now: () => now},
    parent: {postMessage: value => reports.push(value)},
    setTimeout: (fn, delay) => {const handle = ++id; timers.set(handle, {fn, at: now + delay}); return handle;},
    clearTimeout: handle => timers.delete(handle),
    setInterval: (fn, delay) => {const handle = ++id; timers.set(handle, {fn, at: now + delay, interval: delay}); return handle;},
    clearInterval: handle => timers.delete(handle),
    fetch: async (url, options = {}) => {
      const request = {url: String(url), options}; requests.push(request);
      if (request.url.includes('/frame.png')) return snapshotFetch ? snapshotFetch(request) : {ok: true, blob: async () => ({})};
      if (request.url.includes('/interaction-ack')) return ackFetch ? ackFetch(request) : {status: 204, ok: true};
      if (deviceFetch && /\/(status|gfxinfo)$/.test(request.url)) return deviceFetch(request);
      return {ok: true, json: async () => ({booted: true})};
    },
  });
  startPlayerDiagnostics({window, wallNow: () => 1_000_000 + now});
  const advance = async ms => {
    const target = now + ms;
    for (;;) {
      const due = [...timers].filter(([, timer]) => timer.at <= target).sort((a,b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [handle, timer] = due; now = timer.at; timers.delete(handle);
      if (timer.interval) timers.set(handle, {...timer, at: now + timer.interval});
      timer.fn(); await settle();
    }
    now = target; await settle();
  };
  const connect = async () => {
    const peerConnection = {connectionState: 'connected', iceConnectionState: 'connected', signalingState: 'stable', getStats: statsFetch || (async () => new Map())};
    window.__mallDemoJsepDriver = {peerConnection, event_forwarders: {mouse: {readyState: 'open'}}, recoverConnection() {recoveryCount++;}};
    window.emit('mall-demo-peer-connection'); await settle();
    return peerConnection;
  };
  const press = () => {
    document.emit('pointerdown', {clientX: 100, clientY: 100, pointerId: 1});
    window.emit('mall-demo-input-dispatched', {detail: {label: 'mouse', dispatchedAt: now}});
  };
  return {window, document, video, connect, advance, press, requests, images, reports, revoked,
    recoveryCount: () => recoveryCount,
    release: () => document.emit('pointerup', {pointerId: 1}),
    report: () => reports.filter(report => report.type === 'webrtc-stats').at(-1)?.payload,
    snapshots: () => requests.filter(request => request.url.includes('/frame.png'))};
}

test('a late HTTP screenshot cannot reattach after usable video', async () => {
  const response = deferred();
  const f = fixture({snapshotFetch: () => response.promise});
  await f.connect(); await f.advance(600);
  assert.equal(f.snapshots().length, 1);
  f.video.present();
  assert.equal(f.snapshots()[0].options.signal.aborted, true);
  response.resolve({ok: true, blob: async () => ({})}); await settle(); await f.advance(1400);
  assert.equal(f.images.some(image => image.isConnected), false);
  assert.equal(f.snapshots().length, 1);
  assert.equal(f.reports.at(-1).payload.mediaReadiness, 'ready');
});

test('a late image decode cannot cover video or leak its object URL', async () => {
  const f = fixture({autoDecode: false});
  await f.connect(); await f.advance(600);
  assert.equal(f.images.length, 1);
  f.video.present(); f.images[0].finish(); await settle();
  assert.equal(f.images[0].isConnected, false);
  assert.equal(f.revoked.includes(f.images[0].objectUrl), true);
});

test('a screenshot belonging to the old peer is discarded after reconnect', async () => {
  const old = deferred(); let call = 0;
  const f = fixture({snapshotFetch: () => ++call === 1 ? old.promise : Promise.resolve({ok: true, blob: async () => ({})})});
  await f.connect(); await f.advance(600); await f.connect();
  old.resolve({ok: true, blob: async () => ({})}); await settle();
  assert.equal(f.images.length, 0);
  await f.advance(600);
  assert.equal(f.images.filter(image => image.isConnected).length, 1);
});

test('each input refreshes fallback even while the first latency sample is pending', async () => {
  const f = fixture();
  await f.advance(600); f.press(); await f.advance(80);
  assert.match(f.snapshots().at(-1).url, /fresh=1$/);
  await f.advance(100); const count = f.snapshots().length;
  f.press(); await f.advance(80);
  assert.equal(f.snapshots().length, count + 1);
  assert.match(f.snapshots().at(-1).url, /fresh=1$/);
});

test('continuous moves do not postpone fallback forever, and bursts stop when idle', async () => {
  const f = fixture(); await f.advance(600);
  const before = f.snapshots().length;
  for (let i = 0; i < 12; i += 1) { f.window.emit('mall-demo-input-dispatched', {detail: {label: 'mouse'}}); await f.advance(10); }
  assert.ok(f.snapshots().length > before);
  await f.advance(1000); const afterBurst = f.snapshots().length;
  await f.advance(500);
  assert.ok(f.snapshots().length <= afterBurst + 1);
});

test('fallback inputs still refresh in a browser without requestVideoFrameCallback', async () => {
  const f = fixture({videoCallbacks: false}); await f.advance(600); const before = f.snapshots().length;
  f.press(); await f.advance(80);
  assert.equal(f.snapshots().length, before + 1);
});

const epoch = 'a'.repeat(32);
const jsonResponse = value => ({ok: true, status: 200, json: async () => value});
const checkpointResponse = sequence => jsonResponse({version: 2, sequence, epoch});
const ackResponse = (sequence, action = 'tab.bag') => jsonResponse({version: 1, sequence, epoch, action});

test('an unchanged next frame does not cancel recovery while the picture is still pending', async () => {
  const f = fixture();
  await f.connect(); f.video.present(); f.press(); f.release();
  await f.advance(100); f.video.present();
  await f.advance(150);
  const redraws = () => f.requests.filter(request => request.url.endsWith('/refresh-frame'));
  assert.equal(redraws().length, 1);
  f.video.pixels = 80; f.video.present(); await f.advance(3000);
  assert.equal(redraws().length, 1);
  assert.equal(f.report().inputNextFrameStatus, 'received');
  assert.equal(f.report().inputVisualChangeStatus, 'received');
});

test('a picture that never changes gets bounded redraws despite unrelated video frames', async () => {
  const f = fixture();
  await f.connect(); f.video.present(); f.press(); f.release();
  await f.advance(100); f.video.present();
  await f.advance(6000);
  assert.equal(f.requests.filter(request => request.url.endsWith('/refresh-frame')).length, 3);
  assert.equal(f.report().inputVisualChangeStatus, 'timeout');
});

test('fresh checkpoints skip old unmeasured ACKs and separate press from release timing', async () => {
  const ack = deferred();
  const f = fixture({ackFetch: request => request.url.includes('cursor=1') ? checkpointResponse(12) : ack.promise});
  await f.connect(); f.video.present(); f.press(); await settle();
  const poll = f.requests.find(request => request.url.includes('after='));
  assert.equal(new URL(poll.url).searchParams.get('after'), '12');
  await f.advance(100); f.release(); await f.advance(180); ack.resolve(ackResponse(13)); await settle();
  f.video.pixels = 80; f.video.present(); await f.advance(720);
  assert.equal(f.report().inputAppAckStatus, 'received');
  assert.equal(f.report().inputToAppAckMs, 280);
  assert.equal(f.report().inputReleaseToAppAckMs, 180);
  assert.equal(f.report().inputPressDurationMs, 100);
  assert.equal(f.report().latencyWindow.modes.video.appAck.p95Ms, 280);
  assert.equal(f.report().latencyWindow.modes.video.visual.count, 1);
});

test('a conflicting pointer invalidates an outstanding ACK instead of crediting another click', async () => {
  const ack = deferred();
  const f = fixture({ackFetch: request => request.url.includes('cursor=1') ? checkpointResponse(9) : ack.promise});
  await f.connect(); f.video.present(); f.press(); f.release(); await settle(); f.press();
  ack.resolve(ackResponse(10)); await settle(); await f.advance(1000);
  assert.equal(f.report().inputAppAckStatus, 'ambiguous');
  assert.equal(f.report().inputToAppAckMs, null);
  assert.equal(f.report().latencyWindow.modes.video.appAck.excludedCount, 1);
});

test('a stalled checkpoint times out locally and a late response cannot revive it', async () => {
  const checkpoint = deferred();
  const f = fixture({ackFetch: () => checkpoint.promise});
  await f.connect(); f.video.present(); f.press(); f.release(); await f.advance(5000);
  checkpoint.resolve(checkpointResponse(9)); await settle(); await f.advance(1000);
  assert.equal(f.report().inputAppAckStatus, 'timeout');
  assert.equal(f.requests.filter(request => request.url.includes('after=')).length, 0);
  assert.equal(f.report().latencyWindow.modes.video.appAck.timeoutPercent, 100);
  assert.equal(f.report().latencyWindow.modes.video.appAck.p50Ms, null);
});

test('peer changes cancel measurements and reject late responses from the previous peer', async () => {
  const ack = deferred();
  const f = fixture({ackFetch: request => request.url.includes('cursor=1') ? checkpointResponse(9) : ack.promise});
  await f.connect(); f.video.present(); f.press(); f.release(); await settle(); await f.connect();
  ack.resolve(ackResponse(10)); await settle(); await f.advance(1000);
  assert.equal(f.report().inputAppAckStatus, 'ambiguous');
  assert.equal(f.report().inputNextFrameStatus, 'unavailable');
});

test('an ACK from a restarted gateway is unavailable', async () => {
  const f = fixture({ackFetch: request => request.url.includes('cursor=1') ? checkpointResponse(9)
    : jsonResponse({version: 1, sequence: 10, action: 'tab.bag', epoch: 'b'.repeat(32)})});
  await f.connect(); f.video.present(); f.press(); f.release(); await settle(); await f.advance(1000);
  assert.equal(f.report().inputAppAckStatus, 'unavailable');
});

test('slow device HTTP cannot block frame monitoring or overlap device requests', async () => {
  const device = deferred();
  const f = fixture({deviceFetch: () => device.promise});
  await f.connect(); f.video.present(); await f.advance(2000);
  assert.equal(f.report().mediaReadiness, 'ready');
  assert.equal(f.report().device, null);
  assert.equal(f.requests.filter(request => /\/(status|gfxinfo)$/.test(request.url)).length, 2);
});

test('interval buffer/decode metrics discard counter resets and unsupported frame metadata', async () => {
  let totals = {framesDecoded: 10, bytesReceived: 1000, packetsReceived: 100,
    jitterBufferDelay: 1, jitterBufferEmittedCount: 10, totalDecodeTime: .1};
  const f = fixture({statsFetch: async () => new Map([['v', {type: 'inbound-rtp', kind: 'video', id: 'v', ssrc: 1, ...totals}]])});
  await f.connect(); f.video.present();
  assert.equal(f.report().jitterBufferAverageMs, null);
  totals = {...totals, framesDecoded: 20, jitterBufferDelay: 4, jitterBufferEmittedCount: 20, totalDecodeTime: .15};
  await f.advance(1000);
  assert.equal(f.report().jitterBufferAverageMs, 300);
  assert.ok(Math.abs(f.report().averageDecodeTimeMs - 5) < .0001);
  assert.equal(f.report().videoFrameTiming.ageMs, null);
  f.video.present({expectedDisplayTime: 1000, captureTime: 700, receiveTime: 900, processingDuration: .005});
  totals = {...totals, framesDecoded: 2, jitterBufferDelay: .2, jitterBufferEmittedCount: 2, totalDecodeTime: .01};
  await f.advance(1000);
  assert.equal(f.report().jitterBufferAverageMs, null);
  assert.equal(f.report().averageDecodeTimeMs, null);
  assert.equal(f.report().videoFrameTiming.ageMs, 300);
});

test('overlapping getStats requests coalesce while new peer monitoring still starts immediately', async () => {
  const stats = deferred(); let count = 0;
  const f = fixture({statsFetch: () => {count++; return stats.promise;}});
  await f.connect(); await f.advance(2000); assert.equal(count, 1);
  await f.connect(); assert.equal(count, 2);
  f.video.present(); stats.resolve(new Map()); await settle();
  assert.equal(f.report().mediaReadiness, 'ready');
});

test('a slow first frame is allowed to present before replacing the connection', async () => {
  const f = fixture(); await f.connect(); await f.advance(2200);
  assert.equal(f.recoveryCount(), 0);
  f.video.present(); await f.advance(3000);
  assert.equal(f.recoveryCount(), 0);
  assert.equal(f.report().mediaReadiness, 'ready');
  assert.equal(f.images.some(image => image.isConnected), false);
});


test('latest-frame transport never redraws the APK; native fallback restores redraw recovery', async () => {
  const f = fixture();
  await f.connect();
  f.window.__mallDemoJsepDriver.wsUrl = 'wss://device.example/api/v1/emulator/ws-jsep-latest';
  f.video.present();
  f.press();
  await f.advance(200);
  f.video.present();
  await f.advance(100);
  const redraws = () => f.requests.filter(request => request.url.endsWith('/refresh-frame'));
  assert.equal(redraws().length, 0);
  await f.advance(1000);
  assert.equal(redraws().length, 0);
  f.window.__mallDemoJsepDriver.wsUrl = 'wss://device.example/api/v1/emulator/ws-jsep';
  await f.connect();
  f.video.present();
  f.press();
  await f.advance(250);
  assert.equal(redraws().length, 1);
});
