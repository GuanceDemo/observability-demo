const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const crypto = require("node:crypto");
const source = fs.readFileSync(
  require("node:path").resolve(
    __dirname,
    "../../game-service/src/main/resources/static/assets/game-runtime.js"
  ),
  "utf8"
);
function setup({gameId = "plants-vs-zombies", rumConfig = {}} = {}) {
  const events = [],
    listeners = {},
    requests = [],
    rumCalls = [],
    globalContext = {};
  let session = {
      authenticated: false,
      personas: [{ id: "a", name: "Reader A", tier: "standard" }],
    },
    failLogin = false,
    overlay;
  class Element {
    constructor() {
      this.children = [];
      this.nodes = {};
      this.disabled = false;
    }
    append(el) {
      this.children.push(el);
    }
    remove() {
      this.removed = true;
    }
    focus() {}
    addEventListener() {}
    querySelector(key) {
      return (this.nodes[key] ||= new Element());
    }
    querySelectorAll() {
      return this.children;
    }
  }
  const body = new Element();
  body.dataset = { gameId };
  body.append = (el) => {
    overlay = el;
  };
  const sdk = {
    addAction: (name, c) => events.push({ ...globalContext, name, ...c }),
    addError: () => {},
    setUser: (u) => events.push({ identity: u.id }),
    clearUser: () => events.push({ identity: null }),
    init: (config) => rumCalls.push({type: "init", config}),
    setGlobalContextProperty: (key, value) => { globalContext[key] = value; },
    startSessionReplayRecording: () => rumCalls.push({type: "replay", ...globalContext}),
    startView: (view) => rumCalls.push({type: "view", ...view, ...globalContext}),
  };
  const window = {
    DATAFLUX_RUM: sdk,
    addEventListener: (name, fn) => (listeners[name] = fn),
    removeEventListener: () => {},
  };
  const sandbox = {
    window,
    document: {
      body,
      activeElement: new Element(),
      createElement: () => new Element(),
      head: {append: (script) => script.onload()},
    },
    location: {
      search: "",
      pathname: "/plants-game.html",
      origin: "http://localhost",
      href: "http://localhost/plants-game.html",
    },
    parent: window,
    URL,
    URLSearchParams,
    AbortSignal,
    crypto,
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval: () => {},
    fetch: async (url, options) => {
      if (url.endsWith("/api/games/rum-config")) {
        return {ok: true, json: async () => ({
          enabled: true, gameApplicationId: "game-app", gameService: "mall-game-h5",
          env: "demo", version: "2.4.3", ...rumConfig,
        })};
      }
      requests.push(options);
      if (options.method === "POST") {
        if (failLogin) return { ok: false, status: 503 };
        session = {
          ...session,
          authenticated: true,
          user: { id: "a", name: "Reader A" },
        };
      }
      if (options.method === "DELETE")
        session = { ...session, authenticated: false, user: null };
      return { ok: true, status: 200, json: async () => session };
    },
  };
  vm.runInNewContext(source, sandbox);
  return {
    R: window.GameRuntime,
    sdk,
    events,
    requests,
    rumCalls,
    listeners,
    get overlay() {
      return overlay;
    },
    set session(s) {
      session = s;
    },
    set failLogin(v) {
      failLogin = v;
    },
  };
}
test("failed login keeps dialog and supports retry into originally pending game", async () => {
  const h = setup();
  h.failLogin = true;
  const pending = h.R.requireAuth();
  await new Promise(setImmediate);
  const dialog = h.overlay;
  const button = dialog.querySelector(".game-personas").children[0];
  await button.onclick();
  assert.equal(h.R.authenticated, false);
  assert.equal(dialog.removed, undefined);
  assert.equal(button.disabled, false);
  assert.ok(h.events.some((e) => e.name === "auth_login_failure"));
  h.failLogin = false;
  await button.onclick();
  assert.equal((await pending).id, "a");
  assert.equal(dialog.removed, true);
  assert.ok(h.events.some((e) => e.name === "auth_login_success"));
  assert.ok(
    h.requests.every(
      (r) => r.credentials === "same-origin" && r.cache === "no-store"
    )
  );
});

for (const gameId of ["home", "plants-vs-zombies"]) {
  for (const project of ["configured-project", undefined]) {
    test(`${gameId} applies ${project || "fallback"} project before its first RUM events`, async () => {
      const h = setup({gameId, rumConfig: {project}});
      await h.R.initRum();
      await h.R.initRum();
      const init = h.rumCalls.filter((call) => call.type === "init");
      assert.equal(init.length, 1);
      assert.equal(init[0].config.service, "mall-game-h5");
      assert.equal(init[0].config.env, "demo");
      const expected = project || "mall-demo";
      assert.equal(h.rumCalls.find((call) => call.type === "replay").project, expected);
      assert.equal(h.rumCalls.find((call) => call.type === "view").project, expected);
      if (gameId !== "home") {
        assert.equal(h.events.find((event) => event.name === "game_enter").project, expected);
      }
    });
  }
}
test("expired session ends run under old user, clears identity, and creates fresh run after login", async () => {
  const h = setup();
  h.session = { authenticated: true, user: { id: "a" }, personas: [] };
  await h.R.restore();
  const first = h.R.beginRun();
  const changes = [];
  h.R.onAuth((user, previous) => changes.push([user?.id, previous]));
  h.session = { authenticated: false, personas: [] };
  await h.R.restore();
  assert.equal(h.R.runActive, false);
  assert.equal(h.R.authenticated, false);
  assert.deepEqual(changes, [[undefined, "a"]]);
  const end = h.events.find((e) => e.name === "game_end");
  assert.equal(end.user_id, "a");
  assert.equal(end.run_id, first);
  assert.equal(end.result, "account_changed");
  assert.ok(h.events.some((e) => e.identity === null));
  h.session = { authenticated: true, user: { id: "b" }, personas: [] };
  await h.R.restore();
  const second = h.R.beginRun();
  assert.notEqual(first, second);
  assert.equal(h.events.at(-1).user_id, "b");
  await h.R.logout();
  assert.equal(h.R.authenticated, false);
});


test("correlation reads nested SDK application and session IDs", () => {
  const h = setup();
  h.sdk.getInternalContext = () => ({application:{id:"app"},session:{id:"session"},view:{id:"view"}});
  assert.equal(h.R.correlation().applicationId, "app");
  assert.equal(h.R.correlation().sessionId, "session");
  assert.equal(h.R.correlation().viewId, "view");
});
