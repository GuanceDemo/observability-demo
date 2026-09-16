import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startDemoControl} from '../player/mall-demo-control.js';
test('only the configured parent can send commands; completion comes from the APK endpoint', async () => {
  const listeners = {}, posts = [], requests = [];
  const parent = {postMessage: (...value) => posts.push(value)};
  const window = {
    parent, location: {search: '?hostOrigin=https%3A%2F%2Fdemo.example'}, AbortController,
    setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {},
    addEventListener: (name, fn) => { listeners[name] = fn; }, removeEventListener: () => {},
  };
  startDemoControl({window, gatewayEndpoint: () => 'https://device.example/access', fetch: async (url, options) => {
    requests.push({url, options});
    return {ok: true, json: async () => options.method === 'POST' ? {id: 'a'.repeat(32), status: 'completed'} : {state: null}};
  }});
  await Promise.resolve();
  const data = {source: 'mall-demo-workbench', version: 1, type: 'apk-command', payload: {id: 'a'.repeat(32), action: 'recover'}};
  await listeners.message({source: {}, origin: 'https://demo.example', data});
  await listeners.message({source: parent, origin: 'https://evil.example', data});
  assert.equal(requests.filter(item => item.options.method === 'POST').length, 0);
  await listeners.message({source: parent, origin: 'https://demo.example', data});
  assert.equal(requests.filter(item => item.options.method === 'POST').length, 1);
  assert.ok(posts.some(([message, origin]) => message.type === 'apk-command-result' && message.payload.status === 'completed' && origin === 'https://demo.example'));
  listeners.pagehide();
});
