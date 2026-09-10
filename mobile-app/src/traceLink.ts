import {Linking, NativeModules} from 'react-native';
import type {BusinessFaultRun} from './businessFaults';

export interface TraceConsoleConfig {
  observabilityConsoleUrl?: string;
  workspaceId?: string;
}

interface GuanceLinkModule {
  openGuanceUrl(url: string): Promise<boolean>;
}

export async function openTraceUrl(
  traceUrl: string,
  nativeModule: GuanceLinkModule | undefined = NativeModules.DemoFaults as
    | GuanceLinkModule
    | undefined,
  fallback: (url: string) => Promise<unknown> = Linking.openURL,
): Promise<void> {
  if (!traceUrl) {
    return;
  }
  if (nativeModule?.openGuanceUrl) {
    try {
      await nativeModule.openGuanceUrl(traceUrl);
      return;
    } catch {
      // Fall back to the normal platform URL handler.
    }
  }
  await fallback(traceUrl);
}

export function buildTraceUrl(
  traceId: string,
  config: TraceConsoleConfig,
): string {
  if (
    !traceId ||
    !config.observabilityConsoleUrl ||
    !config.workspaceId
  ) {
    return '';
  }
  const base = config.observabilityConsoleUrl.replace(/\/+$/, '');
  const params = [
    ['lak', 'Tracing'],
    ['activeName', 'LinkToTrackLink'],
    ['w', config.workspaceId],
    ['time', '15m'],
    ['query', `trace_id:${traceId}`],
    ['cols', 'time,trace_id,service,resource,duration'],
    ['viewType', 'view'],
    ['refresh', '30'],
    ['trace_id', traceId],
  ]
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  return `${base}/tracing/link/all?${params}`;
}

export function buildRumUrl(run: BusinessFaultRun | null, appId: string, config: TraceConsoleConfig): string {
  if (!run || !appId || !config.observabilityConsoleUrl || !config.workspaceId) return '';
  // Same public explorer route/query encoding used by the web storefront.
  // Both entries open the filtered views; Replay is launched from a recorded view.
  const query = `b64-${encodeAsciiBase64(`fault_run_id:${run.id}`)}`;
  const params = Object.entries({
    lak: 'Rum', activeName: 'RumViewer', w: config.workspaceId, time: '1h',
    cols: 'time,view_name,time_spent,session_id', viewType: 'view',
    viewer_source: 'view', alias: 'view', appIds: appId, query,
  }).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
  return `${config.observabilityConsoleUrl.replace(/\/+$/, '')}/rum/viewer?${params}`;
}

// Fault IDs are generated from ASCII letters, digits and hyphens.
function encodeAsciiBase64(value: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let encoded = '';
  for (let i = 0; i < value.length; i += 3) {
    const a = value.charCodeAt(i);
    const b = value.charCodeAt(i + 1) || 0;
    const c = value.charCodeAt(i + 2) || 0;
    encoded += alphabet[Math.floor(a / 4)] + alphabet[(a % 4) * 16 + Math.floor(b / 16)];
    if (i + 1 < value.length) encoded += alphabet[(b % 16) * 4 + Math.floor(c / 64)];
    if (i + 2 < value.length) encoded += alphabet[c % 64];
  }
  return encoded;
}
