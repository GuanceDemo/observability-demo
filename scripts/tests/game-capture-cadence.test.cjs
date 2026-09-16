const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('game-service/src/main/resources/static/assets/plants-game.js','utf8');
const assignment = source.match(/nextSnapshot = now \+ replayInterval[^;]*;/)[0];
test('capture deadlines keep 30 Hz cadence on 60 Hz draws without catch-up bursts', () => {
  const c=vm.createContext({nextSnapshot:0,replayInterval:1000/30,now:0});
  let count=0;
  for(let frame=0;frame<600;frame++) {
    c.now=frame*1000/60+0.1;
    if(c.now>=c.nextSnapshot) {vm.runInContext(assignment,c);count++;assert.ok(c.nextSnapshot>c.now);}
  }
  assert.ok(count>=299 && count<=301, String(count));
  c.now+=3000;
  vm.runInContext(assignment,c);
  assert.ok(c.nextSnapshot>c.now && c.nextSnapshot<=c.now+c.replayInterval);
});
