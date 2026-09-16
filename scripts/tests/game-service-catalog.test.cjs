const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('order-service/src/main/resources/static/business.html', 'utf8');
const source = html.slice(html.indexOf('    async function loadFaultCatalog()'), html.indexOf('    async function refreshStatus()'));
for (const failed of ['mall', 'game']) {
  test(`${failed} catalog failure does not hide the other service catalog`, async () => {
    const state = {faultCatalogs: {mall: [], game: []}, faults: []};
    const context = vm.createContext({state, requestJson: async path => {
      const owner = path.includes('/games/') ? 'game' : 'mall';
      if (owner === failed) throw new Error('service unavailable');
      return {response: {ok: true}, body: {items: [{id: owner, platforms: ['web']}]}};
    }, renderFaultCatalog() {}, renderActiveFault() {}, log() {}, t: () => ''});
    vm.runInContext(source, context);
    await vm.runInContext('loadFaultCatalog()', context);
    assert.equal(state.faults.length, 1);
    assert.equal(state.faults[0].id, failed === 'mall' ? 'game' : 'mall');
  });
}
