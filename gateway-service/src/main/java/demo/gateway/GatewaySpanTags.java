package demo.gateway;

import java.util.Map;

/** Request context on Agent-created spans; HTTP route metadata belongs to MVC. */
final class GatewaySpanTags {
  private GatewaySpanTags() {}

  static void apply(Map<String, String> tags) {
    try {
      Class<?> globalTracer = Class.forName("datadog.trace.api.GlobalTracer");
      Object tracer = globalTracer.getMethod("get").invoke(null);
      Object span = tracer.getClass().getMethod("activeSpan").invoke(tracer);
      applyToRequestSpans(span, tags);
    } catch (ReflectiveOperationException | LinkageError ignored) {
      // Tracing is optional: deployments without an Agent must still serve requests.
    }
  }

  static void applyToRequestSpans(Object span, Map<String, String> tags) {
    if (span == null) {
      return;
    }
    try {
      applyToSpan(span, tags);
      // MVC may make spring.handler active; HTTP status lives on the local server root.
      Object localRoot = span.getClass().getMethod("getLocalRootSpan").invoke(span);
      if (localRoot != null && localRoot != span) {
        applyToSpan(localRoot, tags);
      }
    } catch (ReflectiveOperationException | LinkageError ignored) {
      // Keep active-span enrichment if the optional local-root API is unavailable.
    }
  }

  static void applyToSpan(Object span, Map<String, String> tags)
      throws ReflectiveOperationException {
    var setTag = span.getClass().getMethod("setTag", String.class, String.class);
    for (var tag : tags.entrySet()) {
      if (tag.getValue() != null && !tag.getValue().isBlank() && !"-".equals(tag.getValue())) {
        setTag.invoke(span, tag.getKey(), tag.getValue());
      }
    }
  }
}
