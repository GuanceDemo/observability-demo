import {Buffer} from 'buffer';
import {buildRumUrl, buildTraceUrl, openTraceUrl} from '../src/traceLink';
import type {BusinessFaultRun} from '../src/businessFaults';

describe('trace deep link', () => {
  it('requires both console URL and workspace', () => {
    expect(buildTraceUrl('1234', {})).toBe('');
    expect(
      buildTraceUrl('1234', {
        observabilityConsoleUrl: 'https://console.guance.com',
      }),
    ).toBe('');
  });

  it('builds the same tracing link contract as the web workbench', () => {
    const url = buildTraceUrl('1234567890', {
      observabilityConsoleUrl: 'https://console.guance.com/',
      workspaceId: 'wksp-demo',
    });
    expect(url).toContain('https://console.guance.com/tracing/link/all?');
    expect(url).toContain('w=wksp-demo');
    expect(url).toContain('query=trace_id%3A1234567890');
    expect(url).toContain('trace_id=1234567890');
  });

  it('opens views for the configured application and exact fault run using the console query format', () => {
    for (const id of ['fault-a', 'fault-ab', 'fault-abc']) {
      const run: BusinessFaultRun = {id, scenarioId: 'mobile_content_slow', layer: 'network', phase: 'triggered', startedAt: 1};
      const config = {observabilityConsoleUrl: 'https://console.guance.com/', workspaceId: 'wksp-demo'};
      const url = buildRumUrl(run, 'android-app', config);
      expect(url).toContain('/rum/viewer?');
      expect(url).toContain('appIds=android-app');
      const encoded = decodeURIComponent(url.split('query=')[1]).slice(4);
      expect(Buffer.from(encoded, 'base64').toString()).toBe(`fault_run_id:${id}`);
      expect(buildRumUrl(null, 'android-app', config)).toBe('');
      expect(buildRumUrl(run, '', config)).toBe('');
    }
  });

  it('uses the native Guance App launcher before the web fallback', async () => {
    const openGuanceUrl = jest.fn(async () => true);
    const fallback = jest.fn(async () => undefined);

    await openTraceUrl(
      'https://console.guance.com/tracing/link?trace_id=123',
      {openGuanceUrl},
      fallback,
    );

    expect(openGuanceUrl).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('falls back to the web URL when the native launcher is unavailable', async () => {
    const fallback = jest.fn(async () => undefined);
    const url = 'https://console.guance.com/tracing/link?trace_id=123';

    await openTraceUrl(url, undefined, fallback);

    expect(fallback).toHaveBeenCalledWith(url);
  });
});
