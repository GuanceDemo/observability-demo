/* Integration layer: upstream combat/rendering lives in plants-engine.js. */
(async function () {
  "use strict";
  const R = GameRuntime,
    U = PvZUpstream,
    $ = (id) => document.getElementById(id);
  const replayInterval = 1000 / 30;
  const replayDiagnostics = new URLSearchParams(location.search).has("replayDiagnostics");
  const replayStats = { startedAt: performance.now(), captured: 0, rejected: 0, encodeMs: 0, draws: 0 };
  let nextDiagnostics = 0;
  const clock = new PvZClock(),
    listeners = [];
  window.PvZLifetime = {
    clock,
    listen(type, fn, options) {
      window.addEventListener(type, fn, options);
      listeners.push([type, fn, options]);
    },
  };
  let alive = true,
    ready = false,
    paused = false,
    started = false,
    raf = 0,
    last = performance.now(),
    main = null,
    scale = 1,
    lastSpawn = 0,
    lastProgress = "",
    nextSnapshot = 0,
    snapshotBusy = false,
    renderVersion = 0,
    capturedVersion = -1;
  let fitFrame = 0;
  function scheduleFit() {
    if (!alive || fitFrame) return;
    fitFrame = requestAnimationFrame(() => {
      fitFrame = 0;
      if (alive) fit();
    });
  }
  function fit() {
    scale = Math.min(1, $("viewport").clientWidth / 900);
    if ($("viewport").style.height === 600 * scale + "px" &&
        $("pvzWorld").style.transform === `scale(${scale})`) return;
    $("pvzWorld").style.transform = `scale(${scale})`;
    $("viewport").style.height = 600 * scale + "px";
  }
  const viewportObserver = new ResizeObserver(scheduleFit);
  viewportObserver.observe($("viewport"));
  window.addEventListener("resize", scheduleFit);
  fit();
  function clean() {
    clock.clear();
    for (const args of listeners.splice(0)) window.removeEventListener(...args);
    $("pvzWorld")
      .getAnimations({ subtree: true })
      .forEach((a) => a.cancel());
    $("pvzWorld")
      .querySelectorAll('img[class*="plantSun"]')
      .forEach((n) => n.remove());
  }
  function pause(reason = "manual") {
    if (!started || paused) return;
    paused = true;
    clock.paused = true;
    $("pause").textContent = "继续";
    $("pvzWorld")
      .getAnimations({ subtree: true })
      .forEach((a) => a.pause());
    R.action("game_pause", { reason });
    $("guide").textContent =
      reason === "session_expired"
        ? "登录已失效，请重新登录后继续。"
        : "游戏已暂停。";
  }
  async function resume() {
    if (!alive || !(await R.requireAuth())) return;
    if (!R.runActive) R.beginRun();
    paused = false;
    clock.paused = false;
    last = performance.now();
    $("pause").textContent = "暂停";
    $("pvzWorld")
      .getAnimations({ subtree: true })
      .forEach((a) => a.play());
    R.action("game_resume");
    $("guide").textContent = "先选左侧卡片，再点击草坪种植。阳光自动收集。";
  }
  function point(e) {
    const box = $("pvzWorld").getBoundingClientRect();
    return {
      x: (e.clientX - box.left) / scale,
      y: (e.clientY - box.top) / scale,
    };
  }
  const originalSun = U.SunNum.prototype.changeSunNum;
  U.SunNum.prototype.changeSunNum = function (num = 25) {
    originalSun.call(this, num);
    if (num > 0 && started)
      R.action("sun_collected", {
        amount: num,
        sun: main.allSunVal,
        collection: "upstream_auto",
      });
  };
  function install() {
    clean();
    clock.paused = false;
    paused = false;
    started = false;
    lastSpawn = 0;
    lastProgress = "";
    nextSnapshot = 0;
    main = new U.Main();
    window._main = main;
    // One bounded entry-level preset. All seven original plants, combat rules,
    // animation assets, five lawn rows and lawnmowers remain upstream code.
    main.zombies_iMax = 9;
    main.start();
    clock.coalesce(main.game.timer);
    const game = main.game,
      originalStep = game.setTimer.bind(game);
    // Keep the original background as a static image. Replay records transparent
    // upstream sprites separately, avoiding repeated compression of lawn detail.
    const background = $("sceneBackground");
    background.hidden = true;
    game.drawBg = function () {
      if (background.hidden) background.hidden = false;
      main.sunnum.draw(game.context);
    };
    game.setTimer = function (m) {
      originalStep(m);
      renderVersion++;
      if (replayDiagnostics) replayStats.draws++;
      if (main.zombies_idx !== lastSpawn) {
        lastSpawn = main.zombies_idx;
        R.action("zombie_spawned", {
          spawned: lastSpawn,
          total: main.zombies_iMax,
        });
      }
      if (started) {
        const progress = `☀ ${main.allSunVal} · 僵尸出场 ${main.zombies_idx}/${main.zombies_iMax} · 剩余 ${main.zombies.length}`;
        if (progress !== lastProgress) {
          $("progress").textContent = progress;
          lastProgress = progress;
        }
      }
      if (
        started &&
        R.runActive &&
        (game.state === game.state_PLANTWON ||
          game.state === game.state_ZOMBIEWON)
      ) {
        const result =
          game.state === game.state_PLANTWON ? "victory" : "defeat";
        R.endRun(result, { spawned: main.zombies_idx });
        clock.paused = true;
        started = false;
        $("result").hidden = false;
        $("resultTitle").textContent =
          result === "victory" ? "第一关胜利！" : "僵尸突破了防线";
        $("pause").disabled = true;
      }
    };
    const originalStart = $("js-startGame-btn").onclick;
    $("js-startGame-btn").onclick = async () => {
      if (started || !ready || !(await R.requireAuth()) || !alive) return;
      R.beginRun();
      R.action("wave_start", { wave: 1, zombie_count: 9 });
      started = true;
      $("pause").disabled = false;
      $("retry").disabled = false;
      originalStart();
    };
    $("canvas").onmousemove = (e) => {
      const p = point(e);
      game.mouseX = p.x;
      game.mouseY = p.y;
    };
    const originalPlace = $("canvas").onclick;
    $("canvas").onclick = (e) => {
      if (
        !started ||
        paused ||
        !R.authenticated ||
        game.state !== game.state_RUNNING
      )
        return;
      const p = point(e);
      game.mouseX = p.x;
      game.mouseY = p.y;
      if (!game.canDrawMousePlant) return;
      game.mousePlantCallback(p.x, p.y);
      const count = main.plants.length;
      originalPlace(e);
      if (main.plants.length > count) {
        const plant = main.plants.at(-1);
        R.action("plant_placed", {
          plant: plant.section,
          row: plant.row,
          col: plant.col,
          sun: main.allSunVal,
        });
        $("guide").textContent = "种植成功。";
      } else $("guide").textContent = "请选择空草坪，并确认阳光足够。";
    };
    document.querySelectorAll(".cards-item").forEach((card, idx) => {
      const select = card.onclick;
      card.onclick = () => {
        if (!started || paused || !R.authenticated) return;
        if (!main.cards[idx].canClick) {
          $("guide").textContent = "植物正在冷却，请稍候。";
          return;
        }
        select.call(card);
        R.action("plant_selected", { plant: card.dataset.section });
        $("guide").textContent = "点击草坪种植所选植物。";
      };
      card.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          card.click();
        }
      };
    });
    $("js-startGame-btn").style.display = "";
    $("js-startGame-btn").disabled = false;
    $("js-startGame-btn").textContent = "点击开始第一关";
    $("js-intro-game").style.display = "";
    document.querySelector(".cards-list").classList.remove("show");
    $("guide").textContent = "先选左侧卡片，再点击草坪种植。阳光自动收集。";
    $("result").hidden = true;
    $("pause").disabled = true;
    $("pause").textContent = "暂停";
    $("retry").disabled = true;
    $("progress").textContent = "第一关 · 5 行草坪 · 9 只僵尸";
  }
  async function retry() {
    if (!(await R.requireAuth()) || !alive) return;
    R.action("game_retry");
    R.endRun("retry");
    install();
    $("js-startGame-btn").click();
  }
  $("pause").onclick = () => (paused ? resume() : pause());
  $("retry").onclick = retry;
  $("playAgain").onclick = retry;
  $("back").onclick = () => {
    R.endRun("exit");
    clean();
    alive = false;
    cancelAnimationFrame(raf);
    R.returnHome();
  };
  R.onAuth((user, previous) => {
    if (!user || (previous && previous !== user.id)) pause("session_expired");
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause("hidden");
  });
  window.addEventListener(
    "pagehide",
    () => {
      alive = false;
      clean();
      cancelAnimationFrame(raf);
      viewportObserver.disconnect();
      window.removeEventListener("resize", scheduleFit);
      cancelAnimationFrame(fitFrame);
    },
    { once: true }
  );
  try {
    try {
      await R.restore();
    } catch {}
    await R.initRum();
    $("rumStatus").textContent = R.correlation().rumReady
      ? "RUM 已连接 · 等待画面采集"
      : "RUM 未连接";
    if (!(await R.requireAuth()) || !alive) return;
    const response = await fetch("assets/pvz/asset-list.json", {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("资源清单加载失败");
    const assets = await response.json();
    let index = 0,
      done = 0;
    await Promise.all(
      Array.from({ length: 12 }, async () => {
        while (index < assets.length) {
          const name = assets[index++];
          await new Promise((resolve, reject) => {
            const img = U.imageFromPath(name);
            const timeout = setTimeout(
              () => reject(new Error("资源加载超时：" + name)),
              15000
            );
            const finish = () => {
              clearTimeout(timeout);
              img.onload = null;
              img.onerror = null;
              resolve();
            };
            img.onload = finish;
            img.onerror = () => {
              clearTimeout(timeout);
              reject(new Error("资源加载失败：" + name));
            };
            if (img.complete && img.naturalWidth) finish();
          });
          done++;
          $(
            "progress"
          ).textContent = `加载原版动画资源 ${done}/${assets.length}`;
        }
      })
    );
    if (!alive) return;
    ready = true;
    install();
    function frame(now) {
      if (!alive) return;
      const delta = now - last;
      last = now;
      try {
        clock.tick(delta);
      } catch (error) {
        pause("error");
        R.report(error, { operation: "upstream_frame" });
        $("guide").textContent = "游戏运行异常，请重新开始。";
      }
      // Capture the completed real canvas, never a second render or DOM imitation.
      // Only one asynchronous SDK encode may be in flight; skip backlog.
      if (!document.hidden && !snapshotBusy && now >= nextSnapshot &&
          renderVersion !== capturedVersion && R.correlation().rumReady) {
        const sdk = window.DATAFLUX_RUM;
        // Keep cadence aligned to deadlines; skip missed slots without catching up.
        nextSnapshot = now + replayInterval - (Math.max(0, now - nextSnapshot) % replayInterval);
        if (sdk?.isRecording?.() && typeof sdk.snapshotCanvas === "function") {
          snapshotBusy = true;
          const capturingVersion = renderVersion;
          const encodingStarted = performance.now();
          Promise.resolve().then(() => sdk.snapshotCanvas($("canvas"))).then((result) => {
            if (!alive) return;
            if (result?.ok) {
              capturedVersion = capturingVersion;
              if (replayDiagnostics) {
                replayStats.captured++;
                replayStats.encodeMs += performance.now() - encodingStarted;
              }
              if ($("rumStatus").textContent !== "RUM 已连接 · 画面采集中")
                $("rumStatus").textContent = "RUM 已连接 · 画面采集中";
            } else {
              if (replayDiagnostics) { replayStats.rejected++; replayStats.lastRejection = result?.reason; }
              $("rumStatus").textContent = "RUM 已连接 · 画面采集待重试";
            }
          }).catch(() => {
            if (alive) {
              if (replayDiagnostics) replayStats.rejected++;
              $("rumStatus").textContent = "RUM 已连接 · 画面采集失败";
            }
          }).finally(() => { snapshotBusy = false; });
        }
      }
      if (replayDiagnostics && now >= nextDiagnostics) {
        nextDiagnostics = now + 5000;
        $("rumStatus").dataset.replayStats = JSON.stringify({ ...replayStats, elapsedMs: now - replayStats.startedAt, correlation: R.correlation() });
      }
      raf = requestAnimationFrame(frame);
    }
    last = performance.now();
    raf = requestAnimationFrame(frame);
    R.post("scene-ready", R.correlation());
  } catch (error) {
    R.report(error, { operation: "upstream_load" });
    $("progress").textContent = error.message;
    $("js-startGame-btn").textContent = "重新加载资源";
    $("js-startGame-btn").disabled = false;
    $("js-startGame-btn").onclick = () => location.reload();
  }
})();
