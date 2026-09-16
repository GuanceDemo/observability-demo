const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('game-service/src/main/resources/static/assets/webgl-replay-game.js', 'utf8');
function setup() {
  const handlers = {};
  const canvas = {dataset: {}, focus() {context.focused = true;}, hasPointerCapture: () => false,
    addEventListener(name, fn) {handlers['canvas:' + name] = fn;}};
  const context = vm.createContext({canvas, destroyed: false, document: {visibilityState: 'visible'},
    window: {addEventListener(name, fn) {handlers[name] = fn;}},
    keys: {}, pointerDown: false, pointerInsideCanvas: true, diagnostics: {},
    player: {x: 0, y: 0, vx: 0, vy: 0, targetX: 1, targetY: 1},
    updatePointer: () => true, togglePause() {}, paused: false,
    clamp: (n, min, max) => Math.max(min, Math.min(max, n)), shoot() {}});
  for (const [start, end] of [
    ['  function focusGameCanvas()', '  function handleParentMessage'],
    ['  function setPointerControlState(', '  function updateReplayTelemetry'],
    ['  function updatePlayer(', '  function updateScene'],
    ['  function isGameKey(', "  document.addEventListener('visibilitychange'"],
  ]) vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end)), context);
  return {context, handlers};
}
test('pointer entry focuses nested game; leaving keeps keyboard movement and prevents arrow scrolling', () => {
  const {context: c, handlers: h} = setup();
  h['canvas:pointerenter']();
  assert.equal(c.focused, true);
  h['canvas:pointerleave']({pointerId: 1});
  assert.equal(c.pointerInsideCanvas, false);
  let prevented = false;
  h.keydown({code: 'ArrowRight', target: {tagName: 'CANVAS'}, preventDefault() {prevented = true;}});
  vm.runInContext('updatePlayer(0.1, 0)', c);
  assert.ok(c.player.x > 0);
  assert.equal(prevented, true);
  h.keyup({code: 'ArrowRight'});
  assert.equal(c.keys.ArrowRight, false);
});
test('blur clears held keys and pointer firing; editable fields and destroyed scenes ignore controls', () => {
  const {context: c, handlers: h} = setup();
  h.keydown({code: 'KeyW', target: {tagName: 'CANVAS'}});
  c.pointerDown = true;
  h.blur();
  assert.equal(Object.keys(c.keys).length, 0);
  assert.equal(c.pointerDown, false);
  h.keydown({code: 'KeyW', target: {tagName: 'INPUT'}});
  assert.equal(Object.keys(c.keys).length, 0);
  c.destroyed = true;
  h.keydown({code: 'KeyW', target: {tagName: 'CANVAS'}});
  assert.equal(Object.keys(c.keys).length, 0);
});
