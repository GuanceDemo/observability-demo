const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm"),
  path = require("node:path"),
  crypto = require("node:crypto");
const {
  PvZClock,
} = require("../../game-service/src/main/resources/static/assets/pvz-clock.js");
const root = path.resolve(__dirname, "../.."),
  staticDir = path.join(root, "game-service/src/main/resources/static");
function setup() {
  const clock = new PvZClock();
  const window = {
    PvZLifetime: { clock },
    _main: { plants: [], zombies: [], allSunVal: 200 },
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(staticDir, "assets/plants-engine.js"), "utf8"),
    { window, console, Image: class {} }
  );
  return { U: window.PvZUpstream, clock, window };
}
test("pinned original source builds reproducibly and every shipped sprite matches upstream hash", () => {
  const code = fs.readFileSync(
    path.join(staticDir, "assets/plants-engine.js"),
    "utf8"
  );
  require("node:child_process").execFileSync("python3", [
    path.join(root, "scripts/build-pvz-vendor.py"),
  ]);
  assert.equal(
    code,
    fs.readFileSync(path.join(staticDir, "assets/plants-engine.js"), "utf8")
  );
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "third-party/pvz/provenance.json"))
  );
  assert.equal(manifest.commit, "79fb2aeeffe7358100af01cee01c3813495bea85");
  for (const item of manifest.assets)
    assert.equal(
      crypto
        .createHash("sha256")
        .update(
          fs.readFileSync(path.join(staticDir, "assets/pvz/images", item.path))
        )
        .digest("hex"),
      item.sha256
    );
});
test("clock freezes pending spawn/cooldown callbacks and clears old run callbacks", () => {
  const c = new PvZClock();
  let n = 0;
  c.interval(() => n++, 50);
  c.timeout(() => (n += 10), 100);
  c.tick(50);
  assert.equal(n, 1);
  c.paused = true;
  c.tick(100);
  assert.equal(n, 1);
  c.paused = false;
  c.tick(50);
  assert.equal(n, 12);
  c.clear();
  c.tick(100);
  assert.equal(n, 12);
  assert.equal(c.jobs.size, 0);
});
test("original peashooter projectile damages only same-lane zombie and chooses death animation", () => {
  const { U, window, clock } = setup();
  const p = new U.Plant({
    type: "plant",
    section: "peashooter",
    row: 1,
    col: 1,
    x: 250,
    y: 92,
  });
  p.canShoot = true;
  p.bullets = [{ x: 600, w: 20 }];
  p.changeAnimation = () => {};
  const z = {
    row: 1,
    x: 580,
    life: 1,
    changeAnimation(name) {
      this.animation = name;
    },
  };
  window._main.zombies = [{ row: 2, x: 580, life: 4 }, z];
  p.canAttack();
  assert.equal(z.life, 0);
  assert.equal(z.animation, "die");
  assert.equal(p.bullets.length, 0);
  assert.equal(window._main.zombies[0].life, 4);
  clock.tick(100);
  clock.tick(100);
  assert.equal(z.isHurt, false);
});
test("original zombie attack kills plant and schedules cleanup through managed clock", () => {
  const { U, window, clock } = setup();
  const plant = { id: 7, row: 1, x: 250, life: 1, section: "peashooter" };
  window._main.plants = [plant];
  const z = new U.Zombie({
    type: "zombie",
    section: "zombie",
    row: 1,
    col: 1,
    x: 210,
    y: 15,
  });
  z.life = 10;
  z.isAnimeLenMax = true;
  z.changeAnimation = () => {};
  z.canAttack();
  assert.equal(plant.life, 0);
  clock.tick(100);
  clock.tick(100);
  assert.equal(plant.isDel, true);
});
test("original card cooldown and countdown use independent timer IDs", () => {
  const { U, clock } = setup();
  const card = new U.Card({
    name: "peashooter",
    row: 1,
    sun_val: 100,
    timer_spacing: 100,
  });
  card.canClick = false;
  card.changeState();
  card.drawCountDown();
  assert.notEqual(card.timer, card.cooldownTimer);
  clock.tick(100);
  assert.equal(card.canClick, true);
});
test("original engine wins only when final zombie is removed and loses at house boundary", () => {
  const { U } = setup();
  const game = Object.assign(Object.create(U.Game.prototype), {
    state: 2,
    state_PLANTWON: 4,
    state_ZOMBIEWON: 5,
  });
  const zombies = [{ isDel: true }, { isDel: false, draw() {} }];
  game.drawImage([], zombies);
  assert.equal(game.state, 2);
  zombies[0].isDel = true;
  game.drawImage([], zombies);
  assert.equal(game.state, 4);
  game.updateImage([], [{ x: 49, canAttack() {}, update() {} }]);
  assert.equal(game.state, 5);
});

test('late rendering runs once without dropping independent deadlines or drifting cadence', () => {
  const clock = new PvZClock();
  let frames = 0, deadlines = 0;
  const render = clock.interval(() => frames++, 1000 / 60);
  clock.coalesce(render);
  clock.timeout(() => deadlines++, 70);
  clock.tick(100);
  assert.equal(frames, 1);
  assert.equal(deadlines, 1);
  clock.tick(17);
  assert.equal(frames, 2);
  clock.paused = true;
  clock.tick(100);
  assert.equal(frames, 2);
});

test("layered scene preserves the upstream sun counter and resets the background", () => {
  const { U } = setup();
  const main = { sunnum: { draw(context) { context.calls.push("sun"); } } };
  const game = { context: { calls: [] } };
  const background = { hidden: false };
  const source = fs.readFileSync(path.join(staticDir, "assets/plants-game.js"), "utf8");
  const adapter = source.slice(source.indexOf('    const background = $("sceneBackground");'), source.indexOf('    game.setTimer = function'));
  const install = () => vm.runInNewContext(adapter, { $: () => background, main, game });
  install();
  assert.equal(background.hidden, true);
  game.drawBg();
  game.drawBg();
  assert.equal(background.hidden, false);
  assert.deepEqual(game.context.calls, ["sun", "sun"]);
  install();
  assert.equal(background.hidden, true);
  // The replay image must be the exact upstream scene asset, not a replacement.
  const html = fs.readFileSync(path.join(staticDir, "plants-game.html"), "utf8");
  assert.ok(html.includes('src="assets/pvz/images/' + U.allImg.bg + '"'));
});
