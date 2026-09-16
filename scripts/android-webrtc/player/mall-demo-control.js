/** Explicit parent/iframe protocol, separate from pointer and video transport. */
export function startDemoControl({window, fetch, gatewayEndpoint}) {
  const parentOrigin = new URLSearchParams(window.location.search).get('hostOrigin');
  if (!parentOrigin || !/^https?:\/\/[^/]+$/.test(parentOrigin)) return;
  let stopped = false;
  let polling = false;
  let busy = false;
  const controllers = new Set();
  const publish = (type, payload) => {
    if (!stopped) window.parent.postMessage({source: 'mall-demo-android-player', version: 1, type, payload}, parentOrigin);
  };
  const request = async (command) => {
    const controller = new window.AbortController();
    controllers.add(controller);
    const timer = window.setTimeout(() => controller.abort(), command ? 27000 : 5000);
    try {
      const response = await fetch(`${gatewayEndpoint()}/api/v1/emulator/demo-control`, {
        method: command ? 'POST' : 'GET', cache: 'no-store', signal: controller.signal,
        ...(command ? {headers: {'Content-Type': 'application/json'}, body: JSON.stringify(command)} : {}),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      window.clearTimeout(timer);
      controllers.delete(controller);
    }
  };
  const poll = async () => {
    if (stopped || polling) return;
    polling = true;
    try { publish('apk-state', await request()); }
    catch { publish('apk-state', {state: null, sampledAt: 0, unavailable: true}); }
    finally { polling = false; }
  };
  const receive = async (event) => {
    const data = event.data;
    if (event.source !== window.parent || event.origin !== parentOrigin || data?.source !== 'mall-demo-workbench'
        || data.version !== 1 || data.type !== 'apk-command') return;
    const command = data.payload;
    if (!command || !/^[a-f0-9]{32}$/.test(command.id) || !['refresh', 'inject', 'recover'].includes(command.action)) return;
    if (busy) { publish('apk-command-result', {id: command.id, status: 'busy'}); return; }
    busy = true;
    try { publish('apk-command-result', await request(command)); }
    catch { publish('apk-command-result', {id: command.id, status: 'unknown'}); }
    finally { busy = false; poll(); }
  };
  window.addEventListener('message', receive);
  const timer = window.setInterval(poll, 3000);
  window.addEventListener('pagehide', () => {
    stopped = true;
    window.clearInterval(timer);
    window.removeEventListener('message', receive);
    controllers.forEach(controller => controller.abort());
  }, {once: true});
  poll();
}
