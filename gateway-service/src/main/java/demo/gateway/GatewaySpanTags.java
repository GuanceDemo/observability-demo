package demo.gateway;

import java.util.Map;

/** Business classifications on the Agent-created span; HTTP route metadata belongs to MVC. */
final class GatewaySpanTags {
  private GatewaySpanTags() {}

  static void apply(Map<String, String> tags) {
    try {
      Class<?> globalTracer = Class.forName("datadog.trace.api.GlobalTracer");
      Object tracer = globalTracer.getMethod("get").invoke(null);
      Object span = tracer.getClass().getMethod("activeSpan").invoke(tracer);
      if (span != null) {
        applyToSpan(span, tags);
      }
    } catch (ReflectiveOperationException | LinkageError ignored) {
      // Tracing is optional: deployments without an Agent must still serve requests.
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
