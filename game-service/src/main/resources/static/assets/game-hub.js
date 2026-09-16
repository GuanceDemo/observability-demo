(async function () {
  "use strict";
  const R = window.GameRuntime,
    $ = (id) => document.getElementById(id),
    frame = $("gameFrame");
  const games = {
    "air-battle": { url: "webgl-replay-game.html?v=20260916-controls-v2", title: "飞机大战" },
    "plants-vs-zombies": { url: "plants-game.html", title: "植物大战僵尸" },
  };
  let filter = "全部",
    recent = false,
    active = null,
    launch = 0,
    scrollY = 0,
    toastTimer;
  function toast(message) {
    clearTimeout(toastTimer);
    $("toast").textContent = message;
    $("toast").hidden = false;
    toastTimer = setTimeout(() => ($("toast").hidden = true), 3500);
  }
  function historyKey() {
    return "game-hub-recent-v1:" + R.user?.id;
  }
  function history() {
    if (!R.user) return [];
    try {
      const value = JSON.parse(localStorage.getItem(historyKey()) || "[]");
      return Array.isArray(value) ? value.filter((id) => games[id]) : [];
    } catch {
      return [];
    }
  }
  function remember(id) {
    if (!R.user) return;
    try {
      localStorage.setItem(
        historyKey(),
        JSON.stringify([id, ...history().filter((x) => x !== id)])
      );
    } catch {}
  }
  function render() {
    const q = $("search").value.trim().toLowerCase();
    let count = 0;
    document.querySelectorAll(".card[data-id]").forEach((c) => {
      c.hidden =
        !(filter === "全部" || filter === c.dataset.category) ||
        !c.dataset.name.toLowerCase().includes(q) ||
        (recent && !history().includes(c.dataset.id));
      if (!c.hidden) count++;
    });
    $("comingSoonCard").hidden = recent || filter !== "全部" || !!q;
    $("empty").hidden = !!count;
    $("empty").textContent = recent
      ? "还没有玩过的游戏，去发现游戏开启第一局吧。"
      : "没有找到游戏，换个关键词试试。";
    $("listTitle").textContent = recent ? "最近玩过" : "发现游戏";
    $("count").textContent = count + " 款游戏 · 持续上新";
  }
  function updateAccount() {
    $("accountButton").textContent = R.user ? R.user.name : "登录，开始玩 ↗";
    $("bannerTitle").textContent = R.user
      ? "欢迎回来，" + R.user.name + "。"
      : "一个账号，逛商城，也玩游戏。";
    $("bannerText").textContent = R.user
      ? "账号已就绪，挑一款游戏放松一下。"
      : "使用商城 Demo 账号登录，开启你的游戏时光。";
    $("bannerButton").textContent = R.user ? "发现游戏 ↗" : "登录体验 ↗";
    $("hubLogout").hidden = !R.user;
    render();
  }
  function state() {
    R.post("game-state", {
      gameId: active,
      faultsAvailable: active === "air-battle",
    });
  }
  async function enter(id) {
    if (!games[id]) return;
    const seq = ++launch;
    const u = await R.requireAuth();
    if (!u || seq !== launch) return;
    scrollY = window.scrollY;
    active = id;
    remember(id);
    $("activeGameTitle").textContent = games[id].title;
    document.body.classList.add("playing");
    $("gameStage").hidden = false;
    const url = new URL(games[id].url, location.href);
    url.searchParams.set("embedded", "1");
    url.searchParams.set("hub", "1");
    url.searchParams.set(
      "lang",
      new URLSearchParams(location.search).get("lang") || "zh"
    );
    frame.src = url.href;
    state();
    R.action("game_open", { selected_game_id: id });
    render();
  }
  function leave() {
    ++launch;
    if (!active) return;
    R.action("game_return_home", { selected_game_id: active });
    active = null;
    frame.removeAttribute("src");
    $("gameStage").hidden = true;
    document.body.classList.remove("playing");
    window.DATAFLUX_RUM?.startView?.({ name: "games/home" });
    state();
    window.scrollTo(0, scrollY);
    $("accountButton").focus();
    render();
    R.restore().catch(() => {});
  }
  const logout = document.createElement("button");
  logout.id = "hubLogout";
  logout.className = "logout";
  logout.textContent = "退出";
  logout.hidden = true;
  $("accountButton").after(logout);
  logout.onclick = async () => {
    try {
      await R.logout();
      leave();
      toast("已退出账号");
    } catch (e) {
      toast(e.message);
    }
  };
  R.onAuth(updateAccount);
  $("accountButton").onclick = async () => {
    if (R.user) toast("当前账号：" + R.user.name);
    else await R.requireAuth();
  };
  $("bannerButton").onclick = async () => {
    if (R.user) $("games").scrollIntoView({ block: "center" });
    else await R.requireAuth();
  };
  $("returnHub").onclick = leave;
  $("search").oninput = render;
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.play) enter(b.dataset.play);
    if (b.dataset.filter) {
      filter = b.dataset.filter;
      document
        .querySelectorAll("[data-filter]")
        .forEach((x) => x.classList.toggle("active", x === b));
      render();
    }
    if (b.dataset.nav) {
      recent = b.dataset.nav === "recent";
      document
        .querySelectorAll("[data-nav]")
        .forEach((x) => x.classList.toggle("active", x === b));
      render();
    }
  });
  window.addEventListener("message", (e) => {
    if (e.origin !== location.origin) return;
    const d = e.data;
    if (!d || d.version !== 1 || d.sceneId !== "webgl-game") return;
    if (
      active &&
      e.source === frame.contentWindow &&
      d.source === "observability-demo-scene"
    ) {
      if (d.type === "game-exit") {
        leave();
        return;
      }
      if (
        [
          "scene-ready",
          "rum-status",
          "scene-log",
          "fault-started",
          "fault-triggered",
        ].includes(d.type)
      ) {
        if (d.type === "scene-ready") state();
        R.post(d.type, d.payload || {});
      }
    } else if (
      e.source === parent &&
      parent !== window &&
      d.source === "observability-demo-parent"
    ) {
      if (
        active &&
        [
          "set-language",
          "set-preview-context",
          "focus-scene-controls",
          "clear-client-fault",
          "set-client-fault",
          "set-fault-hint",
        ].includes(d.type)
      ) {
        if (d.type === "set-client-fault" && active !== "air-battle") return;
        frame.contentWindow?.postMessage(d, location.origin);
      }
      if (d.type === "set-preview-context") state();
    }
  });
  try {
    await R.restore();
  } catch {
    toast("登录服务暂不可用，可在登录窗口重试。");
  }
  updateAccount();
  await R.initRum();
  R.post("scene-ready", R.correlation());
  state();
})();
