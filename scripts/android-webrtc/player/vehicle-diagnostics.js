// Dedicated vehicle profile: no mall fault control, app ACK, or refresh intents.
export function startPlayerDiagnostics({window = globalThis.window, document = globalThis.document} = {}) {
  const params = new URLSearchParams(window.location.search);
  const parentOrigin = params.get('hostOrigin');
  const session = params.get('playerSession');
  const managedRecovery = params.get('managedRecovery') === '1' && Boolean(session);
  try {
    if (!parentOrigin || new URL(parentOrigin).origin !== parentOrigin
      || !['http:', 'https:'].includes(new URL(parentOrigin).protocol)) return () => {};
  } catch { return () => {}; }
  const clock = window.performance || globalThis.performance;
  let stopped = false;
  let recoveries = 0;
  let recoveredAt = 0;
  let lastTime = -1;
  let lastFrameAt = 0;
  const started = clock.now();
  const timer = window.setInterval(() => {
    if (stopped) return;
    const video = document.querySelector('video');
    const driver = window.__mallDemoJsepDriver;
    const now = clock.now();
    if (video && video.currentTime !== lastTime) {
      lastTime = video.currentTime;
      lastFrameAt = now;
    }
    const state = driver?.peerConnection?.connectionState || 'connecting';
    const ready = Boolean(state === 'connected' && video && !video.paused && video.videoWidth === 1280 && video.videoHeight === 720
      && video.readyState >= 2 && video.currentTime > 0 && now - lastFrameAt < 5000);
    window.parent.postMessage({source: 'vehicle-android-player', version: 1,
      type: 'status', payload: {ready, state, session, width: video?.videoWidth || 0, height: video?.videoHeight || 0}}, parentOrigin);
    if (!managedRecovery && !document.hidden && !ready && recoveries < 3 && now - started > 20000 && now - recoveredAt > 30000 && driver?.connected) {
      recoveries += 1;
      recoveredAt = now;
      driver.recoverConnection();
    }
  }, 1000);
  const stop = () => { stopped = true; window.clearInterval(timer); };
  window.addEventListener('pagehide', stop, {once: true});
  return stop;
}
