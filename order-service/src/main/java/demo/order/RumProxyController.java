package demo.order;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.net.URI;
import java.util.Collections;
import java.util.Enumeration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/rum-proxy")
class RumProxyController {
  private static final int MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;
  private static final java.util.Set<String> HOP_BY_HOP_HEADERS =
      java.util.Set.of(
          "host",
          "connection",
          "content-length",
          "transfer-encoding",
          "upgrade",
          "keep-alive",
          "proxy-authenticate",
          "proxy-authorization",
          "te",
          "trailer",
          "accept-encoding");
  private static final java.util.Set<String> ALLOWED_PATHS =
      java.util.Set.of(
          "/v1/write/rum",
          "/v1/write/rum/replay",
          "/v1/write/rum/replay_assets",
          "/v1/check/rum/replay_assets",
          "/v1/write/logging");

  private final RestTemplate restTemplate;
  private final String datakitRumUrl;
  private final boolean enabled;

  RumProxyController(
      RestTemplate restTemplate,
      @Value("${datakit.rum.url:http://127.0.0.1:9529}") String datakitRumUrl,
      @Value("${rum.enabled:false}") boolean rumEnabled,
      @Value("${rum.mobile.enabled:false}") boolean mobileRumEnabled) {
    this.restTemplate = restTemplate;
    this.datakitRumUrl = datakitRumUrl.replaceAll("/+$", "");
    this.enabled = rumEnabled || mobileRumEnabled;
  }

  @RequestMapping("/**")
  ResponseEntity<byte[]> proxy(HttpServletRequest request) throws IOException {
    if (!enabled) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    }

    String path = request.getRequestURI();
    int proxyIndex = path.indexOf("/rum-proxy");
    String targetPath = proxyIndex >= 0 ? path.substring(proxyIndex + "/rum-proxy".length()) : path;
    if (targetPath.isBlank()) {
      targetPath = "/";
    }
    if (!ALLOWED_PATHS.contains(targetPath)) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    }
    if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
      return new ResponseEntity<>(new byte[0], corsHeaders(), HttpStatus.NO_CONTENT);
    }
    String query = request.getQueryString();
    String targetUrl =
        datakitRumUrl + targetPath + (query == null || query.isBlank() ? "" : "?" + query);

    HttpHeaders headers = copyRequestHeaders(request);
    byte[] body = request.getInputStream().readNBytes(MAX_REQUEST_BODY_BYTES + 1);
    if (body.length > MAX_REQUEST_BODY_BYTES) {
      throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE);
    }
    HttpEntity<byte[]> entity = new HttpEntity<>(body == null ? new byte[0] : body, headers);
    try {
      ResponseEntity<byte[]> response =
          restTemplate.exchange(
              URI.create(targetUrl), HttpMethod.valueOf(request.getMethod()), entity, byte[].class);

      HttpHeaders responseHeaders = mergeCorsHeaders(copyResponseHeaders(response.getHeaders()));
      return new ResponseEntity<>(response.getBody(), responseHeaders, response.getStatusCode());
    } catch (RestClientResponseException exception) {
      HttpHeaders responseHeaders =
          mergeCorsHeaders(
              copyResponseHeaders(
                  exception.getResponseHeaders() == null
                      ? HttpHeaders.EMPTY
                      : exception.getResponseHeaders()));
      return new ResponseEntity<>(
          exception.getResponseBodyAsByteArray(), responseHeaders, exception.getStatusCode());
    }
  }

  private HttpHeaders copyRequestHeaders(HttpServletRequest request) {
    HttpHeaders headers = new HttpHeaders();
    for (String name : Collections.list(request.getHeaderNames())) {
      if (!HOP_BY_HOP_HEADERS.contains(name.toLowerCase())) {
        Enumeration<String> values = request.getHeaders(name);
        while (values.hasMoreElements()) {
          headers.add(name, values.nextElement());
        }
      }
    }
    return headers;
  }

  private HttpHeaders copyResponseHeaders(HttpHeaders source) {
    HttpHeaders headers = new HttpHeaders();
    source.forEach(
        (name, values) -> {
          if (!HOP_BY_HOP_HEADERS.contains(name.toLowerCase())) {
            headers.put(name, values);
          }
        });
    return headers;
  }

  private HttpHeaders corsHeaders() {
    HttpHeaders headers = new HttpHeaders();
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
    headers.set(
        "Access-Control-Allow-Headers",
        "Content-Type,Content-Encoding,X-Project,X-Key-Request,X-Business-Request-Id,baggage,x-datadog-origin,x-datadog-parent-id,x-datadog-sampling-priority,x-datadog-trace-id,x-datadog-tags,traceparent,tracestate");
    headers.set("Access-Control-Expose-Headers", "X-Key-Request,X-Business-Request-Id");
    return headers;
  }

  private HttpHeaders mergeCorsHeaders(HttpHeaders source) {
    HttpHeaders headers = new HttpHeaders();
    headers.addAll(source);
    headers.addAll(corsHeaders());
    return headers;
  }
}
