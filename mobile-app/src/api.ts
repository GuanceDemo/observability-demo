import {joinGatewayPath} from './config';
import {getTraceHeaders} from './observability';
import type {
  DemoPublicConfig,
  FaultCatalog,
  MobileRumConfig,
  OrderResult,
  TraceLookup,
} from './types';

export interface BusinessRequestContext {
  keyRequest: string;
  businessRequestId: string;
  baggage: string;
}

export function createBusinessRequestContext(
  keyRequest: string,
  project = 'mall-demo',
  random = Math.random,
): BusinessRequestContext {
  const nonce = `${Date.now().toString(36)}-${random()
    .toString(36)
    .slice(2, 10)}`;
  const businessRequestId = `biz-mobile-${nonce}`;
  return {
    keyRequest,
    businessRequestId,
    baggage: [
      `project=${project}`,
      `key_request=${keyRequest}`,
      'biz_chain=selfheal_checkout',
      `biz_request_id=${businessRequestId}`,
    ].join(','),
  };
}

export async function buildBusinessHeaders(
  url: string,
  context: BusinessRequestContext,
  traceHeaderProvider: (
    requestUrl: string,
  ) => Promise<Record<string, string>> = getTraceHeaders,
): Promise<Record<string, string>> {
  const traceHeaders = await traceHeaderProvider(url);
  return {
    ...traceHeaders,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Key-Request': context.keyRequest,
    'X-Business-Request-Id': context.businessRequestId,
    baggage: context.baggage,
  };
}

export class DemoApi {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async getMobileConfig(): Promise<MobileRumConfig> {
    return this.json<MobileRumConfig>('/api/demo/mobile-config');
  }

  async getPublicConfig(): Promise<DemoPublicConfig> {
    return this.json<DemoPublicConfig>('/api/demo/config');
  }

  async getFaultCatalog(): Promise<FaultCatalog> {
    return this.json<FaultCatalog>('/api/demo/faults');
  }

  async enableServerFault(scenarioId: string): Promise<Record<string, unknown>> {
    return this.businessJson<Record<string, unknown>>(
      `/api/demo/faults/${encodeURIComponent(scenarioId)}/enable`,
      'POST',
      `mobile_fault_enable_${scenarioId}`,
    );
  }

  async recoverFaults(): Promise<Record<string, unknown>> {
    return this.businessJson<Record<string, unknown>>(
      '/api/demo/faults/off',
      'POST',
      'mobile_fault_recover_all',
    );
  }

  async purchase(project: string): Promise<OrderResult> {
    return this.businessJson<OrderResult>(
      '/api/orders/demo',
      'GET',
      'checkout_submit_order',
      project,
    );
  }

  async runPurchaseTraffic(
    project: string,
    count = 5,
  ): Promise<OrderResult[]> {
    const results: OrderResult[] = [];
    for (let index = 0; index < count; index += 1) {
      results.push(await this.purchase(project));
    }
    return results;
  }

  async slowResource(project: string): Promise<Record<string, unknown>> {
    return this.businessJson<Record<string, unknown>>(
      '/api/demo/slow-resource?delayMs=2600',
      'GET',
      'mobile_slow_resource',
      project,
    );
  }

  async findTrace(
    businessRequestId: string,
    orderId = '',
  ): Promise<TraceLookup> {
    const params = [
      `biz_request_id=${encodeURIComponent(businessRequestId)}`,
      orderId ? `order_id=${encodeURIComponent(orderId)}` : '',
      'limit=12',
    ]
      .filter(Boolean)
      .join('&');
    return this.json<TraceLookup>(`/api/demo/logs?${params}`);
  }

  private async businessJson<T>(
    path: string,
    method: 'GET' | 'POST',
    keyRequest: string,
    project = 'mall-demo',
  ): Promise<T> {
    const url = joinGatewayPath(this.baseUrl, path);
    const context = createBusinessRequestContext(keyRequest, project);
    const headers = await buildBusinessHeaders(url, context);
    return this.fetchJson<T>(url, {method, headers});
  }

  private json<T>(path: string): Promise<T> {
    return this.fetchJson<T>(joinGatewayPath(this.baseUrl, path), {
      headers: {Accept: 'application/json'},
    });
  }

  private async fetchJson<T>(url: string, init: RequestInit): Promise<T> {
    const response = await this.fetchImpl(url, init);
    const text = await response.text();
    let payload: unknown = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = {message: text};
      }
    }
    if (!response.ok) {
      const detail =
        typeof payload === 'object' &&
        payload !== null &&
        'message' in payload &&
        typeof payload.message === 'string'
          ? payload.message
          : `HTTP ${response.status}`;
      throw new Error(detail);
    }
    return payload as T;
  }
}
