// One recovery owner for the local player. Transport connectivity is not a picture.
const WAIT_MS = [10000, 15000, 30000, 30000];
const DOCUMENT_WAIT_MS = 30000;
const HEARTBEAT_MS = 5000;
const HEALTHY_RESET_MS = 30000;

export function startPlayerConnection({window, document, frame, button, status, loadPlayer, describeError}) {
  let generation = 0, session = '', origin = '', pending = false, stopped = false;
  let active = true, loaded = false, ready = false, terminal = false, attempts = 0;
  let waitingMs = 0, healthyMs = 0, lastReportAt = -Infinity;
  let lastTick = window.performance.now();
  let timer;
  const render = value => { if (status.textContent !== value) status.textContent = value; };

  async function connect(manual = false) {
    if (stopped) return;
    if (manual) attempts = 0;
    const current = ++generation;
    session = window.crypto.randomUUID();
    origin = ''; loaded = false; ready = false; terminal = false; pending = true;
    waitingMs = 0; healthyMs = 0; lastReportAt = -Infinity;
    button.disabled = true;
    render(attempts ? `正在自动重连车机画面（${attempts}/3）…` : '正在连接车机画面…');
    try {
      const config = await loadPlayer();
      if (stopped || current !== generation) return;
      const url = new URL(config.playerUrl, window.location.origin);
      if (url.origin !== window.location.origin || url.pathname !== '/vehicle-demo/player/' || url.username || url.password) throw new Error('INVALID_PLAYER_URL');
      origin = url.origin;
      url.searchParams.set('hostOrigin', origin);
      url.searchParams.set('playerSession', session);
      url.searchParams.set('managedRecovery', '1');
      // Discard the old browsing context as well as its media connection. A
      // pending src navigation can otherwise leave the previous document alive.
      const next = frame.cloneNode(false);
      next.addEventListener('load', () => {
        if (stopped || current !== generation || loaded) return;
        loaded = true; waitingMs = 0; lastTick = window.performance.now();
      }, {once: true});
      next.src = url.href;
      frame.replaceWith(next);
      frame = next;
    } catch (error) {
      if (stopped || current !== generation) return;
      terminal = /^(INVALID_PLAYER_URL|PLAYER_CONFIG_UNAVAILABLE|PLAYER_CONFIG_INVALID|PLAYER_ASSETS_MISSING)$/.test(error.message);
      render(describeError(error) + (terminal ? '' : '，稍后自动重试。'));
    } finally {
      if (!stopped && current === generation) {
        pending = false; button.disabled = false; lastTick = window.performance.now();
      }
    }
  }

  function message(event) {
    if (stopped || pending || event.origin !== origin || event.source !== frame.contentWindow) return;
    const data = event.data;
    if (data?.source !== 'vehicle-android-player' || data.version !== 1 || data.type !== 'status'
      || data.payload?.session !== session || typeof data.payload.ready !== 'boolean') return;
    lastReportAt = window.performance.now();
    // Diagnostics may start before the document load event.
    if (!loaded) { loaded = true; waitingMs = 0; lastTick = lastReportAt; }
    ready = data.payload.ready;
    if (ready) {
      terminal = false; waitingMs = 0;
      render('● 真实车机已连接 · 可直接点击操作');
    } else {
      healthyMs = 0;
      if (!terminal) render(data.payload.state === 'connected'
        ? '已连接，正在等待车机画面；超时将自动重连…' : '正在连接车机画面；超时将自动重连…');
    }
  }

  function tick() {
    const now = window.performance.now();
    const elapsed = now - lastTick;
    lastTick = now;
    if (stopped || document.hidden || !active || pending) return;
    if (ready && now - lastReportAt < HEARTBEAT_MS) {
      healthyMs += elapsed;
      if (healthyMs >= HEALTHY_RESET_MS) attempts = 0;
      return;
    }
    if (ready) render('车机画面暂时中断，正在等待恢复；超时将自动重连…');
    ready = false; healthyMs = 0;
    if (terminal) return;
    waitingMs += elapsed;
    if (waitingMs < (loaded ? WAIT_MS[attempts] : DOCUMENT_WAIT_MS)) return;
    if (attempts === 3) {
      terminal = true;
      render('暂未收到车机画面，自动重连已尝试 3 次；请稍后重新连接。');
      return;
    }
    attempts += 1;
    void connect();
  }

  function resumeClock() {
    lastTick = window.performance.now();
    waitingMs = 0; healthyMs = 0; ready = false;
  }
  function reconnect() { void connect(true); }
  function hide() {
    stopped = true; generation += 1; window.clearInterval(timer);
  }
  function show() {
    if (!stopped) return;
    stopped = false; resumeClock();
    timer = window.setInterval(tick, 1000);
    void connect(true);
  }
  window.addEventListener('message', message);
  window.addEventListener('pagehide', hide);
  window.addEventListener('pageshow', show);
  document.addEventListener('visibilitychange', resumeClock);
  button.addEventListener('click', reconnect);
  timer = window.setInterval(tick, 1000);
  void connect();
  return {
    setActive(value) { active = value; resumeClock(); },
    stop() {
      hide();
      window.removeEventListener('message', message);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', show);
      document.removeEventListener('visibilitychange', resumeClock);
      button.removeEventListener('click', reconnect);
    },
  };
}
