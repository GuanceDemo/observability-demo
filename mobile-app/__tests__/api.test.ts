jest.mock('../src/observability', () => ({
  getTraceHeaders: jest.fn(async () => ({})),
}));

import {
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
});
