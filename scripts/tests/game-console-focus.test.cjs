const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('order-service/src/main/resources/static/business.html', 'utf8');
test('console pointer clicks restore aircraft focus; keyboard navigation and other scenes do not', () => {
  const pending = [], messages = [], listeners = {};
  let focuses = 0;
  const state = {selectedSceneId: 'webgl-game', activeGameId: 'air-battle'};
  const context = vm.createContext({state, window: {requestAnimationFrame: fn => pending.push(fn)},
    els: {shopFrame: {contentWindow: {}, focus() {focuses++;}}, controlSidebar: {addEventListener: (n, f) => listeners[n] = f}},
    sendShopMessage: type => messages.push(type)});
  vm.runInContext(html.slice(html.indexOf('    function focusActiveSceneControls()'), html.indexOf('    function syncLanguageToShop()')), context);
  vm.runInContext(html.slice(html.indexOf("    els.controlSidebar.addEventListener('click'"), html.indexOf("    els.faultLayerTabs.addEventListener('click'")), context);
  const click = detail => listeners.click({detail, target: {closest: () => ({})}});
  click(1); pending.shift()();
  assert.equal(focuses, 1); assert.deepEqual(messages, ['focus-scene-controls']);
  click(0); assert.equal(pending.length, 0);
  click(1); state.activeGameId = null; pending.shift()(); assert.equal(focuses, 1);
  click(1); assert.equal(pending.length, 0);
});
test('hub restores child iframe focus before forwarding focus command', () => {
  const source = fs.readFileSync('game-service/src/main/resources/static/assets/game-hub.js', 'utf8');
  const start = source.indexOf('        if (d.type === "focus-scene-controls")');
  const end = source.indexOf('frame.contentWindow?.postMessage(d, location.origin);', start) + 'frame.contentWindow?.postMessage(d, location.origin);'.length;
  const calls = [];
  const context = vm.createContext({active: 'air-battle', d: {type: 'focus-scene-controls'}, location: {origin: 'http://localhost'}, frame: {focus: () => calls.push('focus'), contentWindow: {postMessage: () => calls.push('message')}}});
  vm.runInContext('(function(){' + source.slice(start, end) + '})()', context);
  assert.deepEqual(calls, ['focus', 'message']);
  calls.length = 0; context.active = 'plants-vs-zombies';
  vm.runInContext('(function(){' + source.slice(start, end) + '})()', context);
  assert.deepEqual(calls, []);
});
