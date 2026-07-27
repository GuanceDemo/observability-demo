import {buildTraceUrl, openTraceUrl} from '../src/traceLink';

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
