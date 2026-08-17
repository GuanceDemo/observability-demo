package demo.payment;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.net.InetAddress;
import java.nio.file.Files;
import java.nio.file.Path;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.web.servlet.HandlerInterceptor;

class KeyRequestSpanTagInterceptor implements HandlerInterceptor {
  private static final Logger log = LoggerFactory.getLogger(KeyRequestSpanTagInterceptor.class);

  @Override
  public boolean preHandle(
      HttpServletRequest request, HttpServletResponse response, Object handler) {
    ProcessIdentity.putMdc();
    RequestMetadata metadata =
        RequestMetadata.from(
            request.getHeader("X-Key-Request"),
            request.getHeader("X-Business-Request-Id"),
            request.getHeader("X-Demo-Language"),
            request.getHeader("baggage"),
            request.getHeader("X-Demo-Visitor-Id"),
            request.getHeader("X-Demo-User-Id"),
            request.getHeader("X-Demo-User-Tier"));
    metadata.applyCurrentSpanTags();
    log.info(
        metadata
            .language()
            .text(
                "接口入口：方法={} 路径={} 参数={} 关键请求={} 业务请求ID={} 客户端IP={} 客户端={}",
                "API request received: method={} path={} query={} key_request={} biz_request_id={} client_ip={} user_agent={}"),
        request.getMethod(),
        request.getRequestURI(),
        valueOrDash(request.getQueryString()),
        metadata.keyRequestOrDash(),
        metadata.businessRequestIdOrDash(),
        valueOrDash(request.getRemoteAddr()),
        valueOrDash(request.getHeader("User-Agent")));
    return true;
  }

  @Override
  public void afterCompletion(
      HttpServletRequest request, HttpServletResponse response, Object handler, Exception ex) {
    ProcessIdentity.clearMdc();
  }

  private String valueOrDash(String value) {
    return value == null || value.isBlank() ? "-" : value;
  }
}

final class ProcessIdentity {
  private static final String PROCESS_ID = Long.toString(ProcessHandle.current().pid());
  private static final String HOST_NAME =
      firstNonBlank(System.getenv("HOSTNAME"), localHostName(), "unknown");
  private static final String HOST =
      firstNonBlank(System.getenv("NODE_NAME"), System.getenv("KUBERNETES_NODE_NAME"), HOST_NAME);
  private static final String POD_NAME =
      firstNonBlank(
          System.getenv("KUBERNETES_POD_NAME"),
          System.getenv("POD_NAME"),
          System.getenv("HOSTNAME"),
          HOST_NAME);
  private static final String POD_NAMESPACE =
      firstNonBlank(
          System.getenv("POD_NAMESPACE"), System.getenv("KUBERNETES_NAMESPACE"), "unknown");
  private static final String CONTAINER_NAME =
      firstNonBlank(
          System.getenv("CONTAINER_NAME"),
          System.getenv("KUBERNETES_CONTAINER_NAME"),
          System.getenv("DD_SERVICE"),
          HOST_NAME);
  private static final String CONTAINER_ID =
      firstNonBlank(
          System.getenv("CONTAINER_ID"),
          System.getenv("KUBERNETES_CONTAINER_ID"),
          containerIdFromCgroup(),
          HOST_NAME);
  private static final String HOST_PROCESS_ID = hostProcessId(PROCESS_ID);

  private ProcessIdentity() {}

  static void putMdc() {
    MDC.put("process_id", PROCESS_ID);
    MDC.put("host_process_id", HOST_PROCESS_ID);
    MDC.put("container_process_id", PROCESS_ID);
    MDC.put("host", HOST);
    MDC.put("host_name", HOST_NAME);
    MDC.put("pod_name", POD_NAME);
    MDC.put("pod_namespace", POD_NAMESPACE);
    MDC.put("container_name", CONTAINER_NAME);
    MDC.put("container_id", CONTAINER_ID);
  }

  static void clearMdc() {
    MDC.remove("process_id");
    MDC.remove("host_process_id");
    MDC.remove("container_process_id");
    MDC.remove("host");
    MDC.remove("host_name");
    MDC.remove("pod_name");
    MDC.remove("pod_namespace");
    MDC.remove("container_name");
    MDC.remove("container_id");
    MDC.remove("key_request");
    MDC.remove("biz_request_id");
    MDC.remove("language");
    MDC.remove("visitor_id");
    MDC.remove("user_id");
    MDC.remove("user_tier");
    MDC.remove("auth_state");
    MDC.remove("fault_id");
    MDC.remove("fault_layer");
    MDC.remove("fault_kind");
    MDC.remove("fault_target");
  }

  static void setTags(Object span) throws ReflectiveOperationException {
    setTag(span, "process_id", PROCESS_ID);
    setTag(span, "host_process_id", HOST_PROCESS_ID);
    setTag(span, "container_process_id", PROCESS_ID);
    setTag(span, "host", HOST);
    setTag(span, "host_name", HOST_NAME);
    setTag(span, "pod_name", POD_NAME);
    setTag(span, "pod_namespace", POD_NAMESPACE);
    setTag(span, "container_name", CONTAINER_NAME);
    setTag(span, "container_id", CONTAINER_ID);
  }

  private static void setTag(Object span, String key, String value)
      throws ReflectiveOperationException {
    if (value != null && !value.isBlank()) {
      span.getClass().getMethod("setTag", String.class, String.class).invoke(span, key, value);
    }
  }

  private static String localHostName() {
    try {
      return InetAddress.getLocalHost().getHostName();
    } catch (Exception ignored) {
      return null;
    }
  }

  private static String hostProcessId(String fallback) {
    try {
      for (String line : Files.readAllLines(Path.of("/proc/self/status"))) {
        if (line.startsWith("NSpid:")) {
          String[] parts = line.substring("NSpid:".length()).trim().split("\\s+");
          if (parts.length > 0 && !parts[0].isBlank()) {
            return parts[0];
          }
        }
      }
    } catch (Exception ignored) {
      // /proc/self/status is Linux-specific; keep the container JVM pid elsewhere.
    }
    return fallback;
  }

  private static String containerIdFromCgroup() {
    try {
      for (String line : Files.readAllLines(Path.of("/proc/self/cgroup"))) {
        for (String part : line.split("[^0-9A-Fa-f]+")) {
          if (part.matches("[0-9A-Fa-f]{64}")) {
            return part;
          }
        }
      }
    } catch (Exception ignored) {
      // Container runtimes expose IDs differently; fall back to the stable hostname/env fields.
    }
    return null;
  }

  private static String firstNonBlank(String... values) {
    for (String value : values) {
      if (value != null && !value.isBlank()) {
        return value.trim();
      }
    }
    return "unknown";
  }
}
