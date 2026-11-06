import assert from 'node:assert/strict';
import {test} from 'node:test';
import {startPlayerConnection} from '../web/player-connection.mjs';

function events() {
  const handlers = new Map();
  return {
    addEventListener(name, fn) { handlers.set(name, fn); },
    removeEventListener(name) { handlers.delete(name); },
    emit(name, value) { handlers.get(name)?.(value); },
  };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function fixture(loadPlayer = async () => ({playerUrl: '/vehicle-demo/player/?latestVideo=1'}), loaded = true) {
  let now = 0, timer, serial = 0;
  const loads = [];
  const window = {...events(), location: {origin: 'http://localhost:8767'},
    performance: {now: () => now}, crypto: {randomUUID: () => `session-${++serial}`},
    setInterval: fn => { timer = fn; return 1; }, clearInterval: () => { timer = null; }};
  const document = {...events(), hidden: false};
  let frame;
  function makeFrame() {
    return {...events(), contentWindow: {}, cloneNode: makeFrame,
      set src(value) { this.url = value; },
      replaceWith(next) { frame = next; loads.push(next.url); if (loaded) next.emit('load'); }};
  }
  frame = makeFrame();
  const button = {...events()}, status = {};
  const player = startPlayerConnection({window, document, frame, button, status, loadPlayer, describeError: e => e.message});
  return {window, document, button, status, loads, player,
    loaded() { frame.emit('load'); },
    report(ready, overrides = {}, envelope = {}) {
      window.emit('message', {origin: window.location.origin, source: frame.contentWindow,
        data: {source: 'vehicle-android-player', version: 1, type: 'status',
          payload: {ready, state: 'connected', session: `session-${serial}`, ...overrides}}, ...envelope});
    },
    async advance(ms) { now += ms; timer?.(); await flush(); },
  };
}

test('connected without a first frame automatically reloads only the player', async () => {
  const f = fixture(); await flush();
  assert.equal(f.loads.length, 1);
  f.report(false);
  assert.match(f.status.textContent, /等待车机画面/);
  await f.advance(9000); f.report(false);
  assert.equal(f.loads.length, 1);
  await f.advance(1000);
  assert.equal(f.loads.length, 2);
  const next = new URL(f.loads[1]);
  assert.equal(next.searchParams.get('latestVideo'), '1');
  assert.equal(next.searchParams.get('managedRecovery'), '1');
  assert.notEqual(f.loads[0], f.loads[1]);
  assert.match(f.status.textContent, /自动重连.*1\/3/);
});

test('healthy frame heartbeats preserve playback, lost heartbeats trigger recovery', async () => {
  const f = fixture(); await flush();
  for (let n = 0; n < 90; n++) { f.report(true); await f.advance(1000); }
  assert.equal(f.loads.length, 1);
  await f.advance(10000);
  assert.equal(f.loads.length, 2);
});

test('slow document loading gets its own deadline before the first-frame deadline starts', async () => {
  const f = fixture(undefined, false); await flush();
  await f.advance(15000);
  assert.equal(f.loads.length, 1);
  f.loaded(); await f.advance(9000);
  assert.equal(f.loads.length, 1);
  await f.advance(1000);
  assert.equal(f.loads.length, 2);
  await f.advance(30000);
  assert.equal(f.loads.length, 3, 'an unloaded document still has a bounded retry');
});

test('retries back off and stop; manual retry or sustained recovery restores the budget', async () => {
  const f = fixture(); await flush();
  for (const delay of [10000, 15000, 30000, 30000, 60000]) { f.report(false); await f.advance(delay); }
  assert.equal(f.loads.length, 4);
  assert.match(f.status.textContent, /自动重连已尝试 3 次/);
  f.report(false); assert.match(f.status.textContent, /自动重连已尝试 3 次/);
  f.report(true); await f.advance(1000); f.report(false); await f.advance(30000);
  assert.equal(f.loads.length, 4, 'one healthy sample must not reset the retry budget');
  for (let n = 0; n < 31; n++) { f.report(true); await f.advance(1000); }
  f.report(false); await f.advance(10000);
  assert.equal(f.loads.length, 5);
  f.button.emit('click'); await flush();
  assert.equal(f.loads.length, 6);
  assert.equal(f.button.disabled, false);
});

test('late/wrong session, source, origin and malformed payload cannot claim readiness', async () => {
  const f = fixture(); await flush();
  await f.advance(10000);
  for (const [payload, envelope] of [
    [{session: 'session-1'}, {}], [{ready: 'true'}, {}], [{}, {origin: 'https://other.test'}],
    [{}, {source: {}}], [{}, {data: {source: 'other', version: 1, type: 'status'}}],
  ]) f.report(true, payload, envelope);
  await f.advance(15000);
  assert.equal(f.loads.length, 3);
});

test('hidden browser and report tab pause recovery; returning does not reload a healthy player', async () => {
  const f = fixture(); await flush();
  f.document.hidden = true; f.document.emit('visibilitychange'); await f.advance(60000);
  f.document.hidden = false; f.document.emit('visibilitychange'); await f.advance(1000);
  assert.equal(f.loads.length, 1);
  f.player.setActive(false); await f.advance(60000);
  f.player.setActive(true); f.report(true); await f.advance(1000);
  assert.equal(f.loads.length, 1);
  f.report(false); await f.advance(10000);
  assert.equal(f.loads.length, 2);
});

test('pagehide fences pending loads; pageshow restores, explicit stop releases listeners', async () => {
  let resolve;
  const f = fixture(() => new Promise(done => { resolve = done; }));
  f.window.emit('pagehide'); resolve({playerUrl: '/vehicle-demo/player/'}); await flush();
  assert.equal(f.loads.length, 0);
  f.window.emit('pageshow'); resolve({playerUrl: '/vehicle-demo/player/'}); await flush();
  assert.equal(f.loads.length, 1);
  f.player.stop(); f.window.emit('pageshow'); f.button.emit('click'); await f.advance(60000);
  assert.equal(f.loads.length, 1);
});

test('invalid config stops, transient errors retry, stale config cannot replace a newer session', async () => {
  const bad = fixture(async () => ({playerUrl: 'https://untrusted.test/vehicle-demo/player/'}));
  await flush(); await bad.advance(60000);
  assert.equal(bad.loads.length, 0); assert.equal(bad.status.textContent, 'INVALID_PLAYER_URL');
  let calls = 0;
  const transient = fixture(async () => {
    if (++calls === 1) throw new Error('HTTP_502');
    return {playerUrl: '/vehicle-demo/player/'};
  });
  await flush(); await transient.advance(30000);
  assert.equal(transient.loads.length, 1);
  const pending = [];
  const race = fixture(() => new Promise(resolve => pending.push(resolve)));
  race.button.emit('click');
  pending[1]({playerUrl: '/vehicle-demo/player/?latestVideo=1'}); await flush();
  pending[0]({playerUrl: '/vehicle-demo/player/?latestVideo=0'}); await flush();
  assert.equal(race.loads.length, 1);
  assert.equal(new URL(race.loads[0]).searchParams.get('latestVideo'), '1');
});
