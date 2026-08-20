package demo.gateway;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Enumeration;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.ClientHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResponseErrorHandler;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.filter.OncePerRequestFilter;

final class PassthroughResponseErrorHandler implements ResponseErrorHandler {
  @Override
  public boolean hasError(ClientHttpResponse response) {
    return false;
  }

  @Override
  public void handleError(ClientHttpResponse response) {
    // Downstream 4xx/5xx responses are returned to the browser unchanged.
  }
}

@Component
class GatewayProxyFilter extends OncePerRequestFilter {
  private static final int MAX_REQUEST_BODY_BYTES = 1024 * 1024;
  private static final int MAX_SOURCE_FIELD_LENGTH = 512;
  private static final byte[] ROBOTS_RESPONSE =
      "User-agent: *\nDisallow: /\n".getBytes(StandardCharsets.UTF_8);
  private static final Logger log = LoggerFactory.getLogger(GatewayProxyFilter.class);
  private static final Set<String> HOP_BY_HOP_HEADERS =
      Set.of(
          "connection",
          "keep-alive",
          "proxy-authenticate",
          "proxy-authorization",
          "te",
          "trailer",
          "transfer-encoding",
          "upgrade",
          "host",
          "content-length");
  private static final Set<String> TRACE_PROPAGATION_HEADERS =
      Set.of(
          "traceparent",
          "tracestate",
          "x-datadog-trace-id",
          "x-datadog-parent-id",
          "x-datadog-sampling-priority",
          "x-datadog-origin",
          "x-datadog-tags");
  private static final Set<String> GATEWAY_MANAGED_RESPONSE_HEADERS =
      Set.of(
          "ext_trace_id",
          "x-demo-authenticated-user-id",
          "x-demo-authenticated-user-tier");
  private static final Set<String> CLIENT_IDENTITY_HEADERS =
      Set.of(
          "x-demo-visitor-id",
          "x-demo-user-id",
          "x-demo-user-tier",
          "x-demo-auth-state",
          "x-demo-authenticated-user-id",
          "x-demo-authenticated-user-tier");
  private static final Pattern VISITOR_ID =
      Pattern.compile("visitor-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");

  private final RestTemplate restTemplate;
  private final String orderUrl;
  private final PublicRoutePolicy publicRoutePolicy;

  GatewayProxyFilter(
      RestTemplate gatewayRestTemplate,
      @Value("${gateway.order-url:http://127.0.0.1:8083}") String orderUrl) {
    this.restTemplate = gatewayRestTemplate;
    this.orderUrl = trimTrailingSlash(orderUrl);
    this.publicRoutePolicy = new PublicRoutePolicy();
  }

  @Override
  protected boolean shouldNotFilter(HttpServletRequest request) {
    String requestUri = request.getRequestURI();
    return "/actuator".equals(requestUri) || requestUri.startsWith("/actuator/");
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
      throws ServletException, IOException {
    String keyRequest = valueOrDash(request.getHeader("X-Key-Request"));
    String businessRequestId = valueOrDash(request.getHeader("X-Business-Request-Id"));
    String visitorId = safeVisitorId(request.getHeader("X-Demo-Visitor-Id"));
    DemoLanguage language = DemoLanguage.from(request.getHeader("X-Demo-Language"));
    PublicRoutePolicy.Decision route =
        publicRoutePolicy.evaluate(request.getMethod(), request.getRequestURI());
    RequestSource source = RequestSource.from(request);
    putRequestContext(keyRequest, businessRequestId, visitorId, language, route, source);
    applyCurrentSpanTags(keyRequest, businessRequestId, visitorId, language, route, source);

    try {
      if (!route.forwardsDownstream()) {
        writeLocalResponse(request, response, language, route, source);
        return;
      }

      URI downstream = downstreamUri(request);
      long startedAt = System.nanoTime();
      log.info(
          language.text(
              "网关接入：方法={} 路径={} 下游={} 路由={} 路由分类={} 流量类型={} 客户端IP={} 对端IP={} XFF={} Host={} User-Agent={} Referer={} 关键请求={} 业务请求ID={}",
              "Gateway request received: method={} path={} downstream={} public_route={} route_class={} traffic_type={} client_ip={} peer_ip={} forwarded_for={} host={} user_agent={} referer={} key_request={} biz_request_id={}"),
          request.getMethod(),
          request.getRequestURI(),
          downstream,
          route.routeId(),
          route.routeClass(),
          route.trafficType(),
          source.clientIp(),
          source.peerIp(),
          source.forwardedFor(),
          source.host(),
          source.userAgent(),
          source.referer(),
          keyRequest,
          businessRequestId);
      try {
        HttpHeaders headers = requestHeaders(request, visitorId);
        byte[] requestBody = request.getInputStream().readNBytes(MAX_REQUEST_BODY_BYTES + 1);
        if (requestBody.length > MAX_REQUEST_BODY_BYTES) {
          response.sendError(HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE);
          return;
        }
        HttpEntity<byte[]> entity =
            new HttpEntity<>(requestBody.length == 0 ? null : requestBody, headers);
        ResponseEntity<byte[]> downstreamResponse =
            restTemplate.exchange(
                downstream, HttpMethod.valueOf(request.getMethod()), entity, byte[].class);
        VerifiedIdentity identity = VerifiedIdentity.from(downstreamResponse.getHeaders());
        applyVerifiedIdentity(identity);
        writeResponse(response, downstreamResponse);
        long elapsedMs = Duration.ofNanos(System.nanoTime() - startedAt).toMillis();
        log.info(
            language.text(
                "网关完成：方法={} 路径={} 状态={} 耗时={}ms 路由={} 路由分类={} 流量类型={} 关键请求={} 业务请求ID={}",
                "Gateway request completed: method={} path={} status={} duration_ms={} public_route={} route_class={} traffic_type={} key_request={} biz_request_id={}"),
            request.getMethod(),
            request.getRequestURI(),
            downstreamResponse.getStatusCode().value(),
            elapsedMs,
            route.routeId(),
            route.routeClass(),
            route.trafficType(),
            keyRequest,
            businessRequestId);
      } catch (IllegalArgumentException | RestClientException exception) {
        long elapsedMs = Duration.ofNanos(System.nanoTime() - startedAt).toMillis();
        log.error(
            language.text(
                "网关失败：方法={} 路径={} 耗时={}ms 路由={} 路由分类={} 流量类型={} 关键请求={} 业务请求ID={} 原因={}",
                "Gateway request failed: method={} path={} duration_ms={} public_route={} route_class={} traffic_type={} key_request={} biz_request_id={} reason={}"),
            request.getMethod(),
            request.getRequestURI(),
            elapsedMs,
            route.routeId(),
            route.routeClass(),
            route.trafficType(),
            keyRequest,
            businessRequestId,
            exception.getMessage(),
            exception);
        response.sendError(HttpServletResponse.SC_BAD_GATEWAY, "gateway downstream request failed");
      }
    } finally {
      clearRequestContext();
    }
  }

  private void writeLocalResponse(
      HttpServletRequest request,
      HttpServletResponse response,
      DemoLanguage language,
      PublicRoutePolicy.Decision route,
      RequestSource source)
      throws IOException {
    int status;
    switch (route.action()) {
      case ROBOTS -> {
        status = HttpServletResponse.SC_OK;
        response.setStatus(status);
        response.setContentType("text/plain;charset=UTF-8");
        response.setContentLength(ROBOTS_RESPONSE.length);
        response.setHeader("Cache-Control", "public,max-age=3600");
        if (!"HEAD".equalsIgnoreCase(request.getMethod())) {
          response.getOutputStream().write(ROBOTS_RESPONSE);
        }
      }
      case FAVICON -> {
        status = HttpServletResponse.SC_NO_CONTENT;
        response.setStatus(status);
        response.setHeader("Cache-Control", "public,max-age=86400");
      }
      case REJECT -> {
        status = HttpServletResponse.SC_NOT_FOUND;
        response.setStatus(status);
        response.setHeader("Cache-Control", "no-store");
      }
      case FORWARD -> throw new IllegalStateException("forward routes cannot be handled locally");
      default -> throw new IllegalStateException("unsupported public route action");
    }
    response.setHeader("X-Content-Type-Options", "nosniff");
    log.info(
        language.text(
            "网关本地响应：方法={} 路径={} 状态={} 路由={} 路由分类={} 流量类型={} 客户端IP={} 对端IP={} XFF={} Host={} User-Agent={} Referer={}",
            "Gateway local response: method={} path={} status={} public_route={} route_class={} traffic_type={} client_ip={} peer_ip={} forwarded_for={} host={} user_agent={} referer={}"),
        request.getMethod(),
        request.getRequestURI(),
        status,
        route.routeId(),
        route.routeClass(),
        route.trafficType(),
        source.clientIp(),
        source.peerIp(),
        source.forwardedFor(),
        source.host(),
        source.userAgent(),
        source.referer());
  }

  private URI downstreamUri(HttpServletRequest request) {
    String query = request.getQueryString();
    return URI.create(
        orderUrl + request.getRequestURI() + (query == null || query.isBlank() ? "" : "?" + query));
  }

  private HttpHeaders requestHeaders(HttpServletRequest request, String visitorId) {
    HttpHeaders headers = new HttpHeaders();
    Enumeration<String> names = request.getHeaderNames();
    while (names != null && names.hasMoreElements()) {
      String name = names.nextElement();
      String normalized = name.toLowerCase(Locale.ROOT);
      if (HOP_BY_HOP_HEADERS.contains(normalized)
          || TRACE_PROPAGATION_HEADERS.contains(normalized)
          || CLIENT_IDENTITY_HEADERS.contains(normalized)) {
        continue;
      }
      Enumeration<String> values = request.getHeaders(name);
      while (values.hasMoreElements()) {
        headers.add(name, values.nextElement());
      }
    }
    headers.set("X-Forwarded-Host", valueOrDash(request.getHeader("Host")));
    headers.set("X-Forwarded-Proto", forwardedProto(request));
    headers.set("X-Forwarded-For", request.getRemoteAddr());
    headers.set("X-Gateway-Service", "gateway-service");
    if (visitorId != null) {
      headers.set("X-Demo-Visitor-Id", visitorId);
    }
    return headers;
  }

  private void writeResponse(
      HttpServletResponse response, ResponseEntity<byte[]> downstreamResponse) throws IOException {
    response.setStatus(downstreamResponse.getStatusCode().value());
    downstreamResponse
        .getHeaders()
        .forEach(
            (name, values) -> {
              String normalized = name.toLowerCase(Locale.ROOT);
              if (HOP_BY_HOP_HEADERS.contains(normalized)
                  || GATEWAY_MANAGED_RESPONSE_HEADERS.contains(normalized)) {
                return;
              }
              for (String value : values) {
                response.addHeader(name, value);
              }
            });
    response.setHeader("X-Gateway-Service", "gateway-service");
    byte[] body = downstreamResponse.getBody();
    if (body != null && body.length > 0) {
      response.getOutputStream().write(body);
    }
  }

  private void applyCurrentSpanTags(
      String keyRequest,
      String businessRequestId,
      String visitorId,
      DemoLanguage language,
      PublicRoutePolicy.Decision route,
      RequestSource source) {
    try {
      Class<?> globalTracer = Class.forName("datadog.trace.api.GlobalTracer");
      Object tracer = globalTracer.getMethod("get").invoke(null);
      Object span = tracer.getClass().getMethod("activeSpan").invoke(tracer);
      if (span != null) {
        setTag(
            span,
            "gateway.target",
            route.forwardsDownstream() ? "order-service" : "gateway-service");
        setTag(span, "key_request", keyRequest);
        setTag(span, "biz_request_id", businessRequestId);
        setTag(span, "visitor_id", valueOrDash(visitorId));
        setTag(span, "auth_state", "anonymous");
        setTag(span, "language", language.code());
        setTag(span, "public_route", route.routeId());
        setTag(span, "route_class", route.routeClass());
        setTag(span, "traffic_type", route.trafficType());
        setTag(span, "client_ip", source.clientIp());
        setTag(span, "peer_ip", source.peerIp());
        setTag(span, "request_host", source.host());
        setTag(span, "user_agent", source.userAgent());
        setTag(span, "referer", source.referer());
      }
    } catch (ReflectiveOperationException | LinkageError ignored) {
      // Unit tests and local builds do not require the runtime tracing agent.
    }
  }

  private void setTag(Object span, String key, String value) throws ReflectiveOperationException {
    if (!"-".equals(value)) {
      span.getClass().getMethod("setTag", String.class, String.class).invoke(span, key, value);
    }
  }

  private void putRequestContext(
      String keyRequest,
      String businessRequestId,
      String visitorId,
      DemoLanguage language,
      PublicRoutePolicy.Decision route,
      RequestSource source) {
    String processId = Long.toString(ProcessHandle.current().pid());
    String hostName = valueOrDash(System.getenv("HOSTNAME"));
    MDC.put("process_id", processId);
    MDC.put("host_process_id", processId);
    MDC.put("container_process_id", processId);
    MDC.put("host", valueOrDash(System.getenv("NODE_NAME")));
    MDC.put("host_name", hostName);
    MDC.put("pod_name", valueOrDash(System.getenv("POD_NAME")));
    MDC.put("pod_namespace", valueOrDash(System.getenv("POD_NAMESPACE")));
    MDC.put("container_name", valueOrDash(System.getenv("CONTAINER_NAME")));
    MDC.put("container_id", hostName);
    MDC.put("language", language.code());
    MDC.put("auth_state", "anonymous");
    if (visitorId != null) {
      MDC.put("visitor_id", visitorId);
    }
    MDC.put("public_route", route.routeId());
    MDC.put("route_class", route.routeClass());
    MDC.put("traffic_type", route.trafficType());
    MDC.put("client_ip", source.clientIp());
    MDC.put("peer_ip", source.peerIp());
    MDC.put("forwarded_for", source.forwardedFor());
    MDC.put("request_host", source.host());
    MDC.put("user_agent", source.userAgent());
    MDC.put("referer", source.referer());
    if (!"-".equals(keyRequest)) {
      MDC.put("key_request", keyRequest);
    }
    if (!"-".equals(businessRequestId)) {
      MDC.put("biz_request_id", businessRequestId);
    }
  }

  private void clearRequestContext() {
    for (String key :
        Set.of(
            "process_id",
            "host_process_id",
            "container_process_id",
            "host",
            "host_name",
            "pod_name",
            "pod_namespace",
            "container_name",
            "container_id",
            "key_request",
            "biz_request_id",
            "visitor_id",
            "user_id",
            "user_tier",
            "auth_state",
            "language",
            "public_route",
            "route_class",
            "traffic_type",
            "client_ip",
            "peer_ip",
            "forwarded_for",
            "request_host",
            "user_agent",
            "referer")) {
      MDC.remove(key);
    }
  }

  private void applyVerifiedIdentity(VerifiedIdentity identity) {
    if (identity.userId() == null) {
      return;
    }
    MDC.put("user_id", identity.userId());
    MDC.put("user_tier", identity.userTier());
    MDC.put("auth_state", "authenticated");
    try {
      Class<?> globalTracer = Class.forName("datadog.trace.api.GlobalTracer");
      Object tracer = globalTracer.getMethod("get").invoke(null);
      Object span = tracer.getClass().getMethod("activeSpan").invoke(tracer);
      if (span != null) {
        setTag(span, "user_id", identity.userId());
        setTag(span, "user_tier", identity.userTier());
        setTag(span, "auth_state", "authenticated");
      }
    } catch (ReflectiveOperationException | LinkageError ignored) {
      // Unit tests and local builds do not require the runtime tracing agent.
    }
  }

  private static String safeVisitorId(String value) {
    if (value == null) {
      return null;
    }
    String candidate = value.trim();
    return VISITOR_ID.matcher(candidate).matches() ? candidate : null;
  }

  private static String forwardedProto(HttpServletRequest request) {
    String forwarded = request.getHeader("X-Forwarded-Proto");
    if (forwarded != null) {
      String candidate = forwarded.split(",", 2)[0].trim();
      if ("http".equalsIgnoreCase(candidate) || "https".equalsIgnoreCase(candidate)) {
        return candidate.toLowerCase(Locale.ROOT);
      }
    }
    return request.isSecure() ? "https" : "http";
  }

  private record VerifiedIdentity(String userId, String userTier) {
    static VerifiedIdentity from(HttpHeaders headers) {
      String userId = safeIdentity(headers.getFirst("X-Demo-Authenticated-User-Id"));
      String userTier = safeIdentity(headers.getFirst("X-Demo-Authenticated-User-Tier"));
      return userId == null || userTier == null
          ? new VerifiedIdentity(null, null)
          : new VerifiedIdentity(userId, userTier);
    }

    private static String safeIdentity(String value) {
      if (value == null || !value.matches("[A-Za-z0-9_-]{1,128}")) {
        return null;
      }
      return value;
    }
  }

  private record RequestSource(
      String clientIp,
      String peerIp,
      String forwardedFor,
      String host,
      String userAgent,
      String referer) {
    static RequestSource from(HttpServletRequest request) {
      String peerIp = safeLogValue(request.getRemoteAddr());
      String forwardedFor = safeLogValue(request.getHeader("X-Forwarded-For"));
      String realIp = safeLogValue(request.getHeader("X-Real-IP"));
      return new RequestSource(
          resolveClientIp(forwardedFor, realIp, peerIp),
          peerIp,
          forwardedFor,
          safeLogValue(request.getHeader("Host")),
          safeLogValue(request.getHeader("User-Agent")),
          safeReferer(request.getHeader("Referer")));
    }

    private static String resolveClientIp(String forwardedFor, String realIp, String peerIp) {
      // Observability metadata only: an ingress or load balancer must overwrite forwarding headers
      // before this value can be treated as an authenticated client address.
      if (!"-".equals(forwardedFor)) {
        String firstForwardedAddress = forwardedFor.split(",", 2)[0].trim();
        if (!firstForwardedAddress.isEmpty()) {
          return safeLogValue(firstForwardedAddress);
        }
      }
      return "-".equals(realIp) ? peerIp : realIp;
    }

    private static String safeReferer(String value) {
      if (value == null || value.isBlank()) {
        return "-";
      }
      try {
        URI uri = URI.create(value.trim());
        StringBuilder sanitized = new StringBuilder();
        if (uri.getScheme() != null) {
          sanitized.append(uri.getScheme()).append("://");
        }
        if (uri.getRawAuthority() != null) {
          sanitized.append(uri.getRawAuthority());
        }
        if (uri.getRawPath() != null) {
          sanitized.append(uri.getRawPath());
        }
        return safeLogValue(sanitized.toString());
      } catch (IllegalArgumentException ignored) {
        return "-";
      }
    }

    private static String safeLogValue(String value) {
      if (value == null || value.isBlank()) {
        return "-";
      }
      StringBuilder sanitized =
          new StringBuilder(Math.min(value.length(), MAX_SOURCE_FIELD_LENGTH));
      for (int index = 0;
          index < value.length() && sanitized.length() < MAX_SOURCE_FIELD_LENGTH;
          index++) {
        char current = value.charAt(index);
        if (Character.isISOControl(current)) {
          sanitized.append(' ');
        } else if (current == '|') {
          sanitized.append('_');
        } else {
          sanitized.append(current);
        }
      }
      String result = sanitized.toString().trim();
      return result.isEmpty() ? "-" : result;
    }
  }

  private static String trimTrailingSlash(String value) {
    String result = value == null || value.isBlank() ? "http://127.0.0.1:8083" : value.trim();
    while (result.endsWith("/")) {
      result = result.substring(0, result.length() - 1);
    }
    return result;
  }

  private static String valueOrDash(String value) {
    return value == null || value.isBlank() ? "-" : value.trim();
  }
}
