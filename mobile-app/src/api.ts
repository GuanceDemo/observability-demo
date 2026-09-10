import {joinGatewayPath} from './config';
import {getTraceHeaders} from './observability';
import type {
  BookContent,
  DemoAuthSession,
  DemoPublicConfig,
  FaultCatalog,
  MobileRumConfig,
  OrderRequest,
  OrderResult,
  StoreLanguage,
  TraceLookup,
} from './types';

export interface BusinessRequestContext {
  keyRequest: string;
  businessRequestId: string;
  baggage: string;
}

export interface DemoRequestMetadata {
  language: StoreLanguage;
  visitorId: string;
  faultRunId?: string;
  faultId?: string;
  faultPhase?: string;
}

const DEFAULT_METADATA: DemoRequestMetadata = {
  language: 'zh',
  visitorId: '',
};

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
  metadata: DemoRequestMetadata = DEFAULT_METADATA,
): Promise<Record<string, string>> {
  const traceHeaders = await traceHeaderProvider(url);
  return {
    ...traceHeaders,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Key-Request': context.keyRequest,
    'X-Business-Request-Id': context.businessRequestId,
    'X-Demo-Language': metadata.language,
    ...(metadata.visitorId
      ? {'X-Demo-Visitor-Id': metadata.visitorId}
      : {}),
    baggage: context.baggage + (metadata.faultRunId
      ? `,fault_run_id=${encodeURIComponent(metadata.faultRunId)},fault_id=${encodeURIComponent(metadata.faultId ?? '')},fault_phase=${encodeURIComponent(metadata.faultPhase ?? '')}`
      : ''),
    ...(metadata.faultRunId ? {'X-Demo-Fault-Run-Id': metadata.faultRunId} : {}),
  };
}

function metadataHeaders(
  metadata: DemoRequestMetadata = DEFAULT_METADATA,
): Record<string, string> {
  return {
    Accept: 'application/json',
    'X-Demo-Language': metadata.language,
    ...(metadata.visitorId
      ? {'X-Demo-Visitor-Id': metadata.visitorId}
      : {}),
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

  async getFaultCatalog(
    metadata: DemoRequestMetadata = DEFAULT_METADATA,
  ): Promise<FaultCatalog> {
    return this.json<FaultCatalog>('/api/demo/faults', metadata);
  }

  async getAuthSession(
    metadata: DemoRequestMetadata = DEFAULT_METADATA,
  ): Promise<DemoAuthSession> {
    return this.json<DemoAuthSession>('/api/demo/auth/session', metadata);
  }

  async login(
    userId: string,
    project: string,
    metadata: DemoRequestMetadata,
  ): Promise<DemoAuthSession> {
    return this.businessJson<DemoAuthSession>(
      '/api/demo/auth/session',
      'POST',
      'auth_login',
      project,
      metadata,
      {userId},
    );
  }

  async logout(
    project: string,
    metadata: DemoRequestMetadata,
  ): Promise<void> {
    await this.businessJson<unknown>(
      '/api/demo/auth/session',
      'DELETE',
      'auth_logout',
      project,
      metadata,
    );
  }

  async enableServerFault(
    scenarioId: string,
    metadata: DemoRequestMetadata = DEFAULT_METADATA,
  ): Promise<Record<string, unknown>> {
    return this.businessJson<Record<string, unknown>>(
      `/api/demo/faults/${encodeURIComponent(scenarioId)}/enable`,
      'POST',
      `mobile_fault_enable_${scenarioId}`,
      'mall-demo',
      metadata,
    );
  }

  async recoverFaults(
    metadata: DemoRequestMetadata = DEFAULT_METADATA,
  ): Promise<Record<string, unknown>> {
    return this.businessJson<Record<string, unknown>>(
      '/api/demo/faults/off',
      'POST',
      'mobile_fault_recover_all',
      'mall-demo',
      metadata,
    );
  }

  async purchase(
    project: string,
    order: OrderRequest,
    metadata: DemoRequestMetadata,
  ): Promise<OrderResult> {
    return this.businessJson<OrderResult>(
      '/api/orders',
      'POST',
      'checkout_submit_order',
      project,
      metadata,
      order,
    );
  }

  async runPurchaseTraffic(
    project: string,
    order: OrderRequest,
    count = 5,
    metadata: DemoRequestMetadata,
  ): Promise<OrderResult[]> {
    const results: OrderResult[] = [];
    for (let index = 0; index < count; index += 1) {
      results.push(await this.purchase(project, order, metadata));
    }
    return results;
  }

  async slowResource(
    project: string,
    metadata: DemoRequestMetadata = DEFAULT_METADATA,
  ): Promise<Record<string, unknown>> {
    return this.businessJson<Record<string, unknown>>(
      '/api/demo/slow-resource?delayMs=2600',
      'GET',
      'mobile_slow_resource',
      project,
      metadata,
    );
  }

  async bookContent(
    bookId: string,
    project: string,
    metadata: DemoRequestMetadata,
    mode: 'normal' | 'slow' | 'timeout' = 'normal',
    signal?: AbortSignal,
  ): Promise<{data: BookContent; businessRequestId: string; durationMs: number}> {
    const path = `/api/demo/mobile/book-content?bookId=${encodeURIComponent(bookId)}&lang=${metadata.language}&mode=${mode}`;
    const url = joinGatewayPath(this.baseUrl, path);
    const context = createBusinessRequestContext('mobile_book_content', project);
    const headers = await buildBusinessHeaders(url, context, getTraceHeaders, metadata);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort);
    if (signal?.aborted) abort();
    let deadlineReached = false;
    const startedAt = Date.now();
    const deadlineMs = mode === 'timeout' ? 2000 : 8000;
    const timer = setTimeout(() => {deadlineReached = true; controller.abort();}, deadlineMs);
    try {
      if (controller.signal.aborted) throw new Error('Content request cancelled');
      const data = await this.fetchJson<unknown>(url, {
        method: 'GET', headers, credentials: 'include', signal: controller.signal,
      });
      if (controller.signal.aborted) throw new Error('Content request cancelled');
      if (!isBookContent(data, bookId)) throw new Error('Invalid book content response');
      return {data, businessRequestId: context.businessRequestId, durationMs: Date.now() - startedAt};
    } catch (cause) {
      throw new BookContentRequestError(
        cause,
        deadlineReached,
        Boolean(signal?.aborted),
        context.businessRequestId,
        Date.now() - startedAt,
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  async findTrace(
    businessRequestId: string,
    orderId = '',
    metadata: DemoRequestMetadata = DEFAULT_METADATA,
  ): Promise<TraceLookup> {
    const params = [
      `biz_request_id=${encodeURIComponent(businessRequestId)}`,
      orderId ? `order_id=${encodeURIComponent(orderId)}` : '',
      'limit=12',
    ]
      .filter(Boolean)
      .join('&');
    return this.json<TraceLookup>(`/api/demo/logs?${params}`, metadata);
  }

  private async businessJson<T>(
    path: string,
    method: 'GET' | 'POST' | 'DELETE',
    keyRequest: string,
    project = 'mall-demo',
    metadata: DemoRequestMetadata = DEFAULT_METADATA,
    body?: unknown,
  ): Promise<T> {
    const url = joinGatewayPath(this.baseUrl, path);
    const context = createBusinessRequestContext(keyRequest, project);
    const headers = await buildBusinessHeaders(
      url,
      context,
      getTraceHeaders,
      metadata,
    );
    return this.fetchJson<T>(url, {
      method,
      headers,
      credentials: 'include',
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
  }

  private json<T>(
    path: string,
    metadata: DemoRequestMetadata = DEFAULT_METADATA,
  ): Promise<T> {
    return this.fetchJson<T>(joinGatewayPath(this.baseUrl, path), {
      headers: metadataHeaders(metadata),
      credentials: 'include',
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
      const error = new Error(detail) as Error & {status?: number};
      error.status = response.status;
      throw error;
    }
    return payload as T;
  }
}

export class BookContentRequestError extends Error {
  readonly originalName: string;
  constructor(
    cause: unknown,
    readonly timeout: boolean,
    readonly cancelled: boolean,
    readonly businessRequestId: string,
    readonly durationMs: number,
  ) {
    super(timeout ? 'Book content exceeded its request deadline'
      : cause instanceof Error ? cause.message : 'Book content request failed');
    this.name = timeout ? 'BookContentDeadlineError' : 'BookContentRequestError';
    this.originalName = cause instanceof Error ? cause.name : 'unknown';
    if (cause instanceof Error && cause.stack) this.stack += `\nCaused by: ${cause.stack}`;
  }
}

function isBookContent(value: unknown, bookId: string): value is BookContent {
  if (!value || typeof value !== 'object') return false;
  const content = value as Partial<BookContent>;
  return content.bookId === bookId && typeof content.title === 'string'
    && typeof content.description === 'string' && Array.isArray(content.parts)
    && content.parts.length <= 64 && content.parts.every(part => Array.isArray(part)
      && part.length === 3 && part.every(field => typeof field === 'string'));
}

export function isUnauthorized(error: unknown): boolean {
  return (
    error instanceof Error &&
    'status' in error &&
    (error as Error & {status?: number}).status === 401
  );
}
