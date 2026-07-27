import {Linking, NativeModules} from 'react-native';

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
