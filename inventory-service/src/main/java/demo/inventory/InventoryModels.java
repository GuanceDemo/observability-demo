package demo.inventory;

import java.util.regex.Pattern;
import org.slf4j.MDC;

record InventoryRequest(String orderId, String sku, Integer quantity) {
  InventoryRequest withDefaults() {
    return new InventoryRequest(
        orderId == null || orderId.isBlank() ? "unknown" : orderId,
        sku == null || sku.isBlank() ? "sku-1001" : sku,
        quantity == null || quantity < 1 ? 1 : quantity);
  }
}

record RequestMetadata(
    String keyRequest,
    String businessRequestId,
    DemoLanguage language,
    String baggage,
    String visitorId,
    String userId,
    String userTier,
    String authState) {
  private static final Pattern VISITOR_ID =
      Pattern.compile("visitor-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");
  private static final Pattern IDENTITY_VALUE = Pattern.compile("[A-Za-z0-9_-]{1,128}");

  static RequestMetadata from(
      String keyRequest, String businessRequestId, String language, String baggage) {
    return from(keyRequest, businessRequestId, language, baggage, null, null, null);
  }

  static RequestMetadata from(
      String keyRequest,
      String businessRequestId,
      String language,
      String baggage,
      String visitorId,
      String userId,
      String userTier) {
    String safeUserId = safeIdentity(userId);
    return new RequestMetadata(
        blankToNull(keyRequest),
        blankToNull(businessRequestId),
        DemoLanguage.from(language),
        blankToNull(baggage),
        safeVisitor(visitorId),
        safeUserId,
        safeUserId == null ? null : safeIdentity(userTier),
        safeUserId == null ? "anonymous" : "authenticated");
  }

  String keyRequestOrDash() {
    return keyRequest == null ? "-" : keyRequest;
  }

  String businessRequestIdOrDash() {
    return businessRequestId == null ? "-" : businessRequestId;
  }

  String baggageOrDash() {
    return baggage == null ? "-" : baggage;
  }

  void applyCurrentSpanTags() {
    if (keyRequest != null) {
      MDC.put("key_request", keyRequest);
    }
    if (businessRequestId != null) {
      MDC.put("biz_request_id", businessRequestId);
    }
    MDC.put("language", language.code());
    putMdc("visitor_id", visitorId);
    putMdc("user_id", userId);
    putMdc("user_tier", userTier);
    MDC.put("auth_state", authState);
    try {
      Class<?> tracerClass =
          Class.forName("datadog.trace.bootstrap.instrumentation.api.AgentTracer");
      Object activeSpan = tracerClass.getMethod("activeSpan").invoke(null);
      applySpanTags(activeSpan);
    } catch (ReflectiveOperationException | LinkageError ignored) {
      // dd-java-agent is not available; keep application behavior unchanged.
    }
  }

  private void applySpanTags(Object span) throws ReflectiveOperationException {
    if (span == null || !Boolean.TRUE.equals(span.getClass().getMethod("isValid").invoke(span))) {
      return;
    }
    setTags(span);
    Object localRoot = span.getClass().getMethod("getLocalRootSpan").invoke(span);
    if (localRoot != null
        && Boolean.TRUE.equals(localRoot.getClass().getMethod("isValid").invoke(localRoot))) {
      setTags(localRoot);
    }
  }

  private void setTags(Object span) throws ReflectiveOperationException {
    ProcessIdentity.setTags(span);
    if (keyRequest != null) {
      span.getClass()
          .getMethod("setTag", String.class, String.class)
          .invoke(span, "key_request", keyRequest);
      span.getClass()
          .getMethod("setBaggageItem", String.class, String.class)
          .invoke(span, "key_request", keyRequest);
    }
    if (businessRequestId != null) {
      span.getClass()
          .getMethod("setTag", String.class, String.class)
          .invoke(span, "biz_request_id", businessRequestId);
      span.getClass()
          .getMethod("setBaggageItem", String.class, String.class)
          .invoke(span, "biz_request_id", businessRequestId);
    }
    span.getClass()
        .getMethod("setTag", String.class, String.class)
        .invoke(span, "language", language.code());
    setIdentityTag(span, "visitor_id", visitorId);
    setIdentityTag(span, "user_id", userId);
    setIdentityTag(span, "user_tier", userTier);
    setIdentityTag(span, "auth_state", authState);
    String bizChain = baggageValue("biz_chain");
    if (bizChain != null) {
      span.getClass()
          .getMethod("setTag", String.class, String.class)
          .invoke(span, "biz_chain", bizChain);
      span.getClass()
          .getMethod("setBaggageItem", String.class, String.class)
          .invoke(span, "biz_chain", bizChain);
    }
  }

  private void setIdentityTag(Object span, String key, String value)
      throws ReflectiveOperationException {
    if (value != null) {
      span.getClass().getMethod("setTag", String.class, String.class).invoke(span, key, value);
      span.getClass()
          .getMethod("setBaggageItem", String.class, String.class)
          .invoke(span, key, value);
    }
  }

  private static void putMdc(String key, String value) {
    if (value != null) {
      MDC.put(key, value);
    }
  }

  private static String safeVisitor(String value) {
    String candidate = blankToNull(value);
    return candidate != null && VISITOR_ID.matcher(candidate).matches() ? candidate : null;
  }

  private static String safeIdentity(String value) {
    String candidate = blankToNull(value);
    return candidate != null && IDENTITY_VALUE.matcher(candidate).matches() ? candidate : null;
  }

  private String baggageValue(String key) {
    if (baggage == null) {
      return null;
    }
    for (String item : baggage.split(",")) {
      String[] parts = item.trim().split("=", 2);
      if (parts.length == 2 && key.equals(parts[0].trim())) {
        return parts[1].trim();
      }
    }
    return null;
  }

  private static String blankToNull(String value) {
    return value == null || value.isBlank() ? null : value.trim();
  }
}
