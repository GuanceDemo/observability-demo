/* Shared demo-session and RUM lifecycle for the game documents. */
(function () {
  "use strict";
  const query = new URLSearchParams(location.search);
  const gameId = document.body.dataset.gameId || "home";
  const viewName =
    gameId === "home"
      ? "games/home"
      : gameId === "air-battle"
      ? "games/air-battle"
      : "games/plants-vs-zombies/level-1";
  let user = null,
    personas = [],
    checking = null,
    gate = null,
    resolveGate = null,
    dialog = null;
  let runId = null,
    ended = true,
    initialized = false,
    readyRum = null,
    lastFocus = null,
    disposed = false;
  const listeners = new Set();
  const visitorId = loadVisitorId();
  function loadVisitorId() {
    const fallback = "visitor-" + crypto.randomUUID();
    try {
      const key = "mall-demo-visitor-id-v1";
      const saved = JSON.parse(localStorage.getItem(key) || "null");
      if (
        /^visitor-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          saved?.id
        ) &&
        Number.isFinite(saved?.createdAt) &&
        Date.now() - saved.createdAt < 60 * 24 * 60 * 60 * 1000
      )
        return saved.id;
      localStorage.setItem(
        key,
        JSON.stringify({ id: fallback, createdAt: Date.now() })
      );
    } catch {}
    return fallback;
  }
  function enrichRumEvent(event) {
    event.context = Object.assign({}, event.context, {
      visitor_id: visitorId,
      auth_state: user ? "authenticated" : "anonymous",
    });
    return true;
  }
  const prefix = location.pathname.startsWith("/selfheal") ? "/selfheal" : "";
  const avatarPaths = {
    "demo-reader-001": "demo-reader-a.png",
    "demo-reader-002": "demo-reader-b.png",
    "demo-reader-003": "demo-reader-c.png",
  };
  function context(extra) {
    return Object.assign(
      {
        visitor_id: visitorId,
        game_id: gameId,
        level_id: gameId === "plants-vs-zombies" ? "1" : "survival",
        run_id: runId,
        user_id: user?.id,
        user_tier: user?.tier,
        auth_state: user ? "authenticated" : "anonymous",
      },
      extra
    );
  }
  function action(name, extra) {
    window.DATAFLUX_RUM?.addAction?.(name, context(extra));
  }
  function report(error, extra) {
    window.DATAFLUX_RUM?.addError?.(error, context(extra));
  }
  function identity() {
    const sdk = window.DATAFLUX_RUM;
    if (user)
      sdk?.setUser?.({ id: user.id, name: user.name, email: user.email });
    else sdk?.clearUser?.();
    sdk?.setGlobalContextProperty?.(
      "auth_state",
      user ? "authenticated" : "anonymous"
    );
    sdk?.setGlobalContextProperty?.("user_tier", user?.tier || "anonymous");
    sdk?.setGlobalContextProperty?.("game_id", gameId);
    sdk?.setGlobalContextProperty?.(
      "level_id",
      gameId === "plants-vs-zombies" ? "1" : "survival"
    );
    if (runId) sdk?.setGlobalContextProperty?.("run_id", runId);
  }
  function changed(next) {
    const previous = user?.id;
    if (previous !== next?.id && previous && !ended) endRun("account_changed");
    user = next;
    identity();
    if (previous !== user?.id) {
      listeners.forEach((fn) => fn(user, previous));
      if (initialized) window.DATAFLUX_RUM?.startView?.({ name: viewName });
    }
  }
  async function request(method = "GET", body) {
    const response = await fetch(prefix + "/api/demo/auth/session", {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: Object.assign(
        { "X-Demo-Visitor-Id": visitorId },
        body ? { "Content-Type": "application/json" } : {}
      ),
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok)
      throw new Error("登录服务暂不可用（HTTP " + response.status + "）");
    return response.status === 204 ? null : response.json();
  }
  async function restore() {
    if (checking) return checking;
    checking = (async () => {
      try {
        const session = await request();
        personas = Array.isArray(session.personas) ? session.personas : [];
        changed(session.authenticated ? session.user : null);
        return user;
      } catch (error) {
        changed(null);
        report(error, { operation: "auth_restore" });
        throw error;
      } finally {
        checking = null;
      }
    })();
    return checking;
  }
  function closeDialog() {
    if (dialog) {
      dialog.remove();
      dialog = null;
      lastFocus?.focus();
    }
  }
  function showDialog(message = "") {
    if (dialog) {
      dialog.querySelector("[role=status]").textContent = message;
      return;
    }
    lastFocus = document.activeElement;
    dialog = document.createElement("div");
    dialog.className = "game-auth-overlay";
    dialog.innerHTML =
      '<section class="game-auth-dialog" role="dialog" aria-modal="true" aria-labelledby="game-login-title" data-gc-privacy="allow"><button class="game-auth-close" aria-label="关闭登录">×</button><h2 id="game-login-title">快乐，从登录开始。</h2><p>使用商城 Demo 账号，开启游戏时光。</p><div class="game-personas"></div><p role="status"></p><button class="game-auth-refresh">重新加载账号</button></section>';
    const list = dialog.querySelector(".game-personas");
    personas.forEach((persona) => {
      const b = document.createElement("button");
      b.className = "game-persona";
      b.type = "button";
      if (avatarPaths[persona.id]) {
        const img = document.createElement("img");
        img.src = prefix + "/assets/avatars/" + avatarPaths[persona.id];
        img.alt = "";
        b.append(img);
      }
      const label = document.createElement("span");
      label.textContent = persona.name + " · " + persona.tier;
      b.append(label);
      b.onclick = async () => {
        if (b.disabled) return;
        list.querySelectorAll("button").forEach((x) => (x.disabled = true));
        try {
          const session = await request("POST", { userId: persona.id });
          if (!session?.authenticated) throw new Error("登录未成功，请重试");
          changed(session.user);
          action("auth_login_success");
          closeDialog();
          resolveGate?.(user);
          resolveGate = null;
          gate = null;
        } catch (error) {
          action("auth_login_failure", { reason: error.message });
          report(error, { operation: "auth_login" });
          if (dialog)
            dialog.querySelector("[role=status]").textContent = error.message;
        } finally {
          list.querySelectorAll("button").forEach((x) => (x.disabled = false));
        }
      };
      list.append(b);
    });
    dialog.querySelector("[role=status]").textContent = message;
    const cancel = () => {
      closeDialog();
      resolveGate?.(null);
      resolveGate = null;
      gate = null;
      if (gameId !== "home") returnHome();
    };
    dialog.querySelector(".game-auth-close").onclick = cancel;
    dialog.querySelector(".game-auth-refresh").onclick = async () => {
      try {
        await restore();
        closeDialog();
        if (user) {
          resolveGate?.(user);
          gate = null;
          resolveGate = null;
        } else showDialog();
      } catch (error) {
        dialog.querySelector("[role=status]").textContent = error.message;
      }
    };
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") cancel();
      if (event.key === "Tab") {
        const buttons = [...dialog.querySelectorAll("button:not(:disabled)")];
        const first = buttons[0],
          last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });
    document.body.append(dialog);
    dialog.querySelector("button").focus();
  }
  async function requireAuth() {
    if (gate) return gate;
    let message = "";
    try {
      await restore();
    } catch (error) {
      message = error.message;
    }
    if (user) return user;
    if (gate) return gate;
    gate = new Promise((resolve) => {
      resolveGate = resolve;
    });
    action("auth_login_prompt");
    showDialog(message);
    return gate;
  }
  async function logout() {
    try {
      await request("DELETE");
      action("auth_logout");
      changed(null);
      return true;
    } catch (error) {
      report(error, { operation: "auth_logout" });
      throw error;
    }
  }
  function post(type, payload = {}) {
    if (parent !== window)
      parent.postMessage(
        {
          source: "observability-demo-scene",
          version: 1,
          sceneId: "webgl-game",
          type,
          payload,
        },
        location.origin
      );
  }
  function correlation() {
    const c = window.DATAFLUX_RUM?.getInternalContext?.() || {};
    return {
      applicationId: c.application?.id || c.application_id || window.__gameRumApplicationId || "",
      viewId: c.view?.id || "",
      sessionId: c.session?.id || c.session_id || "",
      rumReady: initialized,
    };
  }
  function returnHome() {
    endRun("exit");
    if (parent !== window && query.get("hub") === "1")
      post("game-exit", { gameId });
    else {
      const u = new URL("game-hub.html", location.href);
      u.searchParams.set("lang", query.get("lang") || "zh");
      location.href = u.href;
    }
  }
  function beginRun() {
    if (!ended) endRun("retry");
    runId = crypto.randomUUID();
    ended = false;
    identity();
    action("game_start");
    return runId;
  }
  function endRun(result, extra = {}) {
    if (ended) return;
    action("game_end", Object.assign({ result }, extra));
    ended = true;
  }
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      const timer = setTimeout(() => {
        s.remove();
        reject(new Error("SDK load timed out: " + src));
      }, 8000);
      s.src = src;
      s.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      s.onerror = () => {
        clearTimeout(timer);
        reject(new Error("SDK load failed: " + src));
      };
      document.head.append(s);
    });
  }
  function initRum() {
    if (readyRum) return readyRum;
    readyRum = (async () => {
      try {
        const response = await fetch(prefix + "/api/games/rum-config", {
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw new Error("RUM config HTTP " + response.status);
        const c = await response.json();
        if (!c.enabled || !c.gameApplicationId) {
          post("rum-status", { status: "disabled" });
          return;
        }
        const origin =
          c.datakitProvider === "truewatch"
            ? "https://static.truewatch.com"
            : "https://static.guance.com";
        await loadScript(origin + "/browser-sdk/v3/dataflux-rum.js");
        window.__gameRumApplicationId = c.gameApplicationId;
        window.DATAFLUX_RUM.init({
          applicationId: c.gameApplicationId,
          service: c.gameService || "mall-game-h5",
          env: c.env || "demo",
          version: c.version,
          datakitOrigin: c.datakitOrigin || undefined,
          sessionSampleRate: c.sessionSampleRate ?? 100,
          sessionReplaySampleRate: c.sessionReplaySampleRate ?? 100,
          sessionReplayOnErrorSampleRate:
            c.sessionReplayOnErrorSampleRate ?? 100,
          sessionPersistence: "local-storage",
          trackViewsManually: true,
          beforeSend: enrichRumEvent,
          defaultPrivacyLevel: "mask-user-input",
          replayCanvasEnabled: document.body.dataset.replayCanvas === "true",
          replayCanvasMode: "manual",
          // Manual capture cadence is owned by plants-game.js, not auto sampling.
          replayCanvasMimeType: "image/webp",
          replayCanvasMaxEncodedBytes: 44000,
          replayCanvasMaxCanvasSize: 1000,
          replayCanvasQuality: 0.85,
          trackInteractions: true,
          trackResources: true,
          trackLongTasks: true,
          traceType: c.traceType || "ddtrace",
          allowedTracingOrigins: [location.origin],
        });
        bindRum();
        window.DATAFLUX_RUM.startSessionReplayRecording?.();
        window.DATAFLUX_RUM.startView?.({ name: viewName });
        post("rum-status", { status: "ready" });
        post("scene-ready", correlation());
      } catch (error) {
        post("rum-status", { status: "failed", message: error.message });
        console.warn("[Game RUM]", error.message);
      }
    })();
    return readyRum;
  }
  function bindRum() {
    initialized = !!window.DATAFLUX_RUM;
    identity();
    if (gameId !== "home") action("game_enter");
  }
  async function check() {
    if (disposed || document.hidden) return;
    try {
      await restore();
      if (!user && gameId !== "home") await requireAuth();
    } catch {
      if (gameId !== "home") await requireAuth();
    }
  }
  const poll = setInterval(check, 15000);
  window.addEventListener("focus", check);
  window.addEventListener(
    "pagehide",
    () => {
      disposed = true;
      endRun("exit");
      clearInterval(poll);
      window.removeEventListener("focus", check);
    },
    { once: true }
  );
  window.GameRuntime = {
    get user() {
      return user;
    },
    get runId() {
      return runId;
    },
    get runActive() {
      return !ended;
    },
    get authenticated() {
      return !!user;
    },
    restore,
    requireAuth,
    logout,
    initRum,
    bindRum,
    identity,
    enrichRumEvent,
    action,
    report,
    beginRun,
    endRun,
    post,
    correlation,
    returnHome,
    onAuth(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
})();
