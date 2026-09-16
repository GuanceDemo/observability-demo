const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm"),
  path = require("node:path");
const root = path.resolve(
  __dirname,
  "../../game-service/src/main/resources/static"
);
test("every local game page reference exists and game scripts parse", () => {
  for (const file of [
    "game-hub.html",
    "plants-game.html",
    "webgl-replay-game.html",
  ]) {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    for (const m of html.matchAll(
      /(?:src|href)="(assets\/[^"?]+)(?:\?[^\"]*)?"/g
    ))
      assert.ok(fs.existsSync(path.join(root, m[1])), m[1]);
    for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))
      new vm.Script(m[1]);
  }
  for (const file of [
    "game-runtime.js",
    "game-hub.js",
    "plants-engine.js",
    "pvz-clock.js",
    "plants-game.js",
    "webgl-replay-game.js",
  ])
    new vm.Script(fs.readFileSync(path.join(root, "assets", file), "utf8"));
});
test("real hub has two games, inert upcoming tile, and no preview credentials", () => {
  const html = fs.readFileSync(path.join(root, "game-hub.html"), "utf8");
  assert.equal([...html.matchAll(/data-play=/g)].length, 2);
  assert.ok(html.includes('id="comingSoonCard"'));
  assert.ok(!html.includes("demo-reader-001"));
  assert.ok(!html.includes("HTML 设计预览"));
  assert.ok(!html.includes('<section class="hero"'));
});
test("symbols carry exact source and line mapping", () => {
  const cp = require("node:child_process"),
    os = require("node:os");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "game-maps-"));
  try {
    cp.execFileSync("python3", [
      path.resolve(__dirname, "../package-game-symbols.py"),
      path.join(root, "assets"),
      temp,
    ]);
    for (const file of [
      "game-runtime.js",
      "game-hub.js",
      "plants-engine.js",
      "pvz-clock.js",
      "plants-game.js",
      "webgl-replay-game.js",
    ]) {
      const map = JSON.parse(
        fs.readFileSync(path.join(temp, file + ".map"), "utf8")
      );
      assert.equal(
        map.sourcesContent[0],
        fs.readFileSync(path.join(root, "assets", file), "utf8")
      );
      assert.equal(map.file, file);
      assert.equal(
        map.mappings.split(";").length,
        map.sourcesContent[0].trimEnd().split("\n").length
      );
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
