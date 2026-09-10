jest.mock('../src/observability', () => ({
  getTraceHeaders: jest.fn(async () => ({})),
}));

import {
  DemoApi,
  BookContentRequestError,
  buildBusinessHeaders,
  createBusinessRequestContext,
} from '../src/api';

describe('mobile business request propagation', () => {
  it('creates business correlation fields', () => {
    const context = createBusinessRequestContext(
      'checkout_submit_order',
      'mall-demo',
      () => 0.123456,
    );
    expect(context.keyRequest).toBe('checkout_submit_order');
    expect(context.businessRequestId).toMatch(/^biz-mobile-/);
    expect(context.baggage).toContain('project=mall-demo');
    expect(context.baggage).toContain('biz_chain=selfheal_checkout');
    expect(context.baggage).toContain(
      `biz_request_id=${context.businessRequestId}`,
    );
  });

  it('merges X-Key-Request, business ID, baggage and DDTrace headers', async () => {
    const context = {
      keyRequest: 'checkout_submit_order',
      businessRequestId: 'biz-mobile-test-123456',
      baggage:
        'project=mall-demo,key_request=checkout_submit_order,biz_request_id=biz-mobile-test-123456',
    };
    const headers = await buildBusinessHeaders(
      'https://demo.example/api/orders/demo',
      context,
      async () => ({
        'x-datadog-trace-id': '1234',
        'x-datadog-parent-id': '5678',
        'x-datadog-sampling-priority': '1',
      }),
    );
    expect(headers).toMatchObject({
      'X-Key-Request': 'checkout_submit_order',
      'X-Business-Request-Id': 'biz-mobile-test-123456',
      baggage: context.baggage,
      'x-datadog-trace-id': '1234',
      'x-datadog-parent-id': '5678',
      'x-datadog-sampling-priority': '1',
    });
  });

  it('does not let trace helpers overwrite required business headers', async () => {
    const context = createBusinessRequestContext(
      'checkout_submit_order',
      'mall-demo',
      () => 0.5,
    );
    const headers = await buildBusinessHeaders(
      'https://demo.example/api/orders/demo',
      context,
      async () => ({
        baggage: 'sdk-value=1',
        'X-Key-Request': 'sdk-overwrite',
        'x-datadog-trace-id': '101',
      }),
    );

    expect(headers.baggage).toBe(context.baggage);
    expect(headers['X-Key-Request']).toBe('checkout_submit_order');
    expect(headers['x-datadog-trace-id']).toBe('101');
  });

  it('uses the real authenticated order endpoint and mobile identity headers', async () => {
    const fetchImpl = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({orderId: 'order-1'}),
      }) as Response,
    );
    const api = new DemoApi('https://demo.example', fetchImpl as typeof fetch);
    await api.purchase(
      'mall-demo',
      {sku: 'sku-1001', quantity: 3, amountCent: 24700},
      {language: 'en', visitorId: 'visitor-test'},
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://demo.example/api/orders');
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({sku: 'sku-1001', quantity: 3, amountCent: 24700}),
    });
    expect(init?.headers).toMatchObject({
      'X-Demo-Language': 'en',
      'X-Demo-Visitor-Id': 'visitor-test',
      'X-Key-Request': 'checkout_submit_order',
    });
  });

  it('restores and creates persona sessions with cookie credentials', async () => {
    const session = {
      authenticated: true,
      user: {
        id: 'demo-reader-002',
        name: 'Demo Reader B',
        email: 'reader-b@example.invalid',
        tier: 'pro',
      },
      personas: [],
    };
    const fetchImpl = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(session),
      }) as Response,
    );
    const api = new DemoApi('https://demo.example', fetchImpl as typeof fetch);
    const metadata = {language: 'zh' as const, visitorId: 'visitor-test'};
    await expect(api.getAuthSession(metadata)).resolves.toEqual(session);
    await expect(
      api.login('demo-reader-002', 'mall-demo', metadata),
    ).resolves.toEqual(session);

    expect(fetchImpl.mock.calls[0][1]).toMatchObject({credentials: 'include'});
    expect(fetchImpl.mock.calls[1][1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({userId: 'demo-reader-002'}),
    });
  });
});

describe('real book content deadlines and correlation', () => {
  const metadata = {language: 'en' as const, visitorId: 'visitor-content',
    faultRunId: 'fault-test', faultId: 'mobile_content_timeout', faultPhase: 'triggered'};
  const bookId = 'observability-engineering';
  const content = {bookId, title: 'Book', description: 'Server content', parts: [['01', 'Chapter', 'Details']]};

  afterEach(() => jest.useRealTimers());

  it('loads server content and preserves the SDK trace headers alongside fault metadata', async () => {
    const {getTraceHeaders} = jest.requireMock('../src/observability');
    getTraceHeaders.mockResolvedValueOnce({'x-datadog-trace-id': '123'});
    const fetchImpl = jest.fn(async () => ({ok: true, text: async () => JSON.stringify(content)}) as Response);
    const api = new DemoApi('https://demo.example', fetchImpl as typeof fetch);
    const result = await api.bookContent(bookId, 'mall-demo', metadata, 'slow');
    expect(result.data).toEqual(content);
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining(`bookId=${bookId}&lang=en&mode=slow`), expect.objectContaining({
      method: 'GET', credentials: 'include', headers: expect.objectContaining({
        'x-datadog-trace-id': '123', 'X-Demo-Fault-Run-Id': 'fault-test',
        baggage: expect.stringContaining('fault_run_id=fault-test'),
      }), signal: expect.anything(),
    }));
  });

  it('actually aborts fetch at two seconds and reports the original cancellation stack', async () => {
    jest.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchImpl = jest.fn((_input: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => {
      signal = init?.signal ?? undefined;
      signal?.addEventListener('abort', () => {
        const error = new Error('Native request cancelled'); error.name = 'AbortError'; reject(error);
      });
    }));
    const api = new DemoApi('https://demo.example', fetchImpl as typeof fetch);
    const result = api.bookContent(bookId, 'mall-demo', metadata, 'timeout').catch(error => error);
    await jest.advanceTimersByTimeAsync(1999);
    expect(signal?.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    const error = await result;
    expect(signal?.aborted).toBe(true);
    expect(error).toBeInstanceOf(BookContentRequestError);
    expect(error).toMatchObject({timeout: true, cancelled: false, durationMs: 2000, originalName: 'AbortError'});
    expect(error.stack).toContain('Caused by: AbortError: Native request cancelled');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('distinguishes page cancellation from a deadline and clears its timer', async () => {
    jest.useFakeTimers();
    const fetchImpl = jest.fn((_input: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('Page closed')));
    }));
    const controller = new AbortController();
    const result = new DemoApi('https://demo.example', fetchImpl as typeof fetch)
      .bookContent(bookId, 'mall-demo', metadata, 'slow', controller.signal).catch(error => error);
    await jest.advanceTimersByTimeAsync(50);
    controller.abort();
    expect(await result).toMatchObject({timeout: false, cancelled: true});
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects an already-cancelled request before sending and rejects mismatched payloads', async () => {
    const fetchImpl = jest.fn(async () => ({ok: true, text: async () => JSON.stringify({...content, bookId: 'wrong-book'})}) as Response);
    const api = new DemoApi('https://demo.example', fetchImpl as typeof fetch);
    const controller = new AbortController(); controller.abort();
    await expect(api.bookContent(bookId, 'mall-demo', metadata, 'normal', controller.signal)).rejects.toMatchObject({cancelled: true});
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(api.bookContent(bookId, 'mall-demo', metadata)).rejects.toThrow('Invalid book content response');
  });
});
