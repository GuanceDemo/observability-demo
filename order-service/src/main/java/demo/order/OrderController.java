package demo.order;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/orders")
class OrderController {
  private static final Logger log = LoggerFactory.getLogger(OrderController.class);

  private final RestTemplate restTemplate;
  private final String inventoryUrl;
  private final String paymentUrl;
  private final FaultState faultState;
  private final OrderStore orderStore;
  private final int slowMs;

  OrderController(
      RestTemplate restTemplate,
      @Value("${inventory.url:http://127.0.0.1:8081}") String inventoryUrl,
      @Value("${payment.url:http://127.0.0.1:8082}") String paymentUrl,
      FaultState faultState,
      OrderStore orderStore,
      @Value("${fault.order-slow-ms:1600}") int slowMs) {
    this.restTemplate = restTemplate;
    this.inventoryUrl = inventoryUrl;
    this.paymentUrl = paymentUrl;
    this.faultState = faultState;
    this.orderStore = orderStore;
    this.slowMs = slowMs;
  }

  @GetMapping("/demo")
  Map<String, Object> createDemoOrder(
      @RequestHeader(value = "X-Key-Request", required = false) String keyRequest,
      @RequestHeader(value = "X-Business-Request-Id", required = false) String businessRequestId,
      @RequestHeader(value = "X-Demo-Language", required = false) String language,
      @RequestHeader(value = "baggage", required = false) String baggage,
      @RequestAttribute(value = DemoAuthContext.VISITOR_ATTRIBUTE, required = false)
          String visitorId) {
    return createOrder(
            new OrderRequest("sku-1001", 1, 1999),
            keyRequest,
            businessRequestId,
            language,
            baggage,
            visitorId,
            null)
        .getBody();
  }

  @PostMapping
  ResponseEntity<Map<String, Object>> createOrder(
      @RequestBody(required = false) OrderRequest request,
      @RequestHeader(value = "X-Key-Request", required = false) String keyRequest,
      @RequestHeader(value = "X-Business-Request-Id", required = false) String businessRequestId,
      @RequestHeader(value = "X-Demo-Language", required = false) String language,
      @RequestHeader(value = "baggage", required = false) String baggage,
      @RequestAttribute(value = DemoAuthContext.VISITOR_ATTRIBUTE, required = false)
          String visitorId,
      @RequestAttribute(value = DemoAuthContext.USER_ATTRIBUTE, required = false) DemoUser user) {
    OrderRequest orderRequest =
        request == null ? new OrderRequest("sku-1001", 1, 1999) : request.withDefaults();
    String orderId = "ord-" + UUID.randomUUID();
    Instant createdAt = Instant.now();
    RequestMetadata metadata =
        RequestMetadata.from(keyRequest, businessRequestId, language, baggage, visitorId, user);
    FaultSnapshot fault = faultState.current();

    log.info(
        metadata
            .language()
            .text(
                "创建订单：订单ID={} 商品={} 数量={} 金额={}分 关键请求={} 业务请求ID={} 上下文={}",
                "Creating order: order_id={} sku={} quantity={} amount_cent={} key_request={} biz_request_id={} context={}"),
        orderId,
        orderRequest.sku(),
        orderRequest.quantity(),
        orderRequest.amountCent(),
        metadata.keyRequestOrDash(),
        metadata.businessRequestIdOrDash(),
        metadata.baggageOrDash());
    orderStore.create(orderId, orderRequest, metadata, createdAt);
    log.info(
        metadata
            .language()
            .text(
                "订单已写入MySQL：订单ID={} 状态=CREATED 关键请求={} 业务请求ID={}",
                "Order persisted to MySQL: order_id={} status=CREATED key_request={} biz_request_id={}"),
        orderId,
        metadata.keyRequestOrDash(),
        metadata.businessRequestIdOrDash());
    if (fault.is("order_slow")) {
      fault.applyCurrentSpanTags();
      log.warn(
          metadata
              .language()
              .text(
                  "故障注入：模拟订单入口慢响应 订单ID={} 故障ID={} 层级={} 目标={} 等待毫秒={} 关键请求={} 业务请求ID={}",
                  "Fault injected: simulating slow order entry order_id={} fault_id={} layer={} target={} delay_ms={} key_request={} biz_request_id={}"),
          orderId,
          fault.mode(),
          fault.layer(),
          fault.target(),
          slowMs,
          metadata.keyRequestOrDash(),
          metadata.businessRequestIdOrDash());
      sleepForFault(slowMs);
    }
    try {
      reserveInventory(orderId, orderRequest, metadata);
      orderStore.updateStatus(orderId, "INVENTORY_RESERVED", Instant.now());
      pay(orderId, orderRequest, metadata);
      orderStore.updateStatus(orderId, "CONFIRMED", Instant.now());
    } catch (RuntimeException exception) {
      markOrderFailed(orderId, metadata);
      throw exception;
    }

    Map<String, Object> response = new LinkedHashMap<>();
    response.put("orderId", orderId);
    response.put("sku", orderRequest.sku());
    response.put("quantity", orderRequest.quantity());
    response.put("amountCent", orderRequest.amountCent());
    response.put("keyRequest", metadata.keyRequest());
    response.put("businessRequestId", metadata.businessRequestId());
    if (metadata.userId() != null) {
      response.put("userId", metadata.userId());
    }
    response.put("status", "CONFIRMED");
    response.put("createdAt", createdAt.toString());
    log.info(
        metadata
            .language()
            .text(
                "订单确认：订单ID={} 关键请求={} 业务请求ID={}",
                "Order confirmed: order_id={} key_request={} biz_request_id={}"),
        orderId,
        metadata.keyRequestOrDash(),
        metadata.businessRequestIdOrDash());
    ResponseEntity.BodyBuilder builder = ResponseEntity.ok();
    metadata.applyResponseHeaders(builder);
    return builder.body(response);
  }

  private void markOrderFailed(String orderId, RequestMetadata metadata) {
    try {
      orderStore.updateStatus(orderId, "FAILED", Instant.now());
      log.warn(
          metadata
              .language()
              .text(
                  "订单状态已写入MySQL：订单ID={} 状态=FAILED 关键请求={} 业务请求ID={}",
                  "Order status persisted to MySQL: order_id={} status=FAILED key_request={} biz_request_id={}"),
          orderId,
          metadata.keyRequestOrDash(),
          metadata.businessRequestIdOrDash());
    } catch (RuntimeException persistenceException) {
      log.error(
          metadata
              .language()
              .text(
                  "订单失败状态写入MySQL失败：订单ID={} 关键请求={} 业务请求ID={} 原因={}",
                  "Failed to persist order failure status: order_id={} key_request={} biz_request_id={} reason={}"),
          orderId,
          metadata.keyRequestOrDash(),
          metadata.businessRequestIdOrDash(),
          persistenceException.getMessage());
    }
  }

  private void sleepForFault(int durationMs) {
    try {
      Thread.sleep(Math.max(100, Math.min(durationMs, 5000)));
    } catch (InterruptedException exception) {
      Thread.currentThread().interrupt();
      throw new ResponseStatusException(
          HttpStatus.SERVICE_UNAVAILABLE, "order slow fault interrupted", exception);
    }
  }

  private void reserveInventory(
      String orderId, OrderRequest orderRequest, RequestMetadata metadata) {
    InventoryRequest request =
        new InventoryRequest(orderId, orderRequest.sku(), orderRequest.quantity());
    try {
      restTemplate.postForEntity(
          inventoryUrl + "/api/inventory/reserve", metadata.withHeaders(request), Map.class);
    } catch (RestClientException e) {
      log.warn(
          metadata
              .language()
              .text(
                  "库存预留失败：订单ID={} 关键请求={} 业务请求ID={} 原因={}",
                  "Inventory reservation failed: order_id={} key_request={} biz_request_id={} reason={}"),
          orderId,
          metadata.keyRequestOrDash(),
          metadata.businessRequestIdOrDash(),
          e.getMessage());
      throw new ResponseStatusException(
          HttpStatus.SERVICE_UNAVAILABLE, "inventory reservation failed", e);
    }
  }

  private void pay(String orderId, OrderRequest orderRequest, RequestMetadata metadata) {
    PaymentRequest request = new PaymentRequest(orderId, orderRequest.amountCent());
    try {
      restTemplate.postForEntity(
          paymentUrl + "/api/payments/pay", metadata.withHeaders(request), Map.class);
    } catch (RestClientException e) {
      log.warn(
          metadata
              .language()
              .text(
                  "支付失败：订单ID={} 关键请求={} 业务请求ID={} 原因={}",
                  "Payment failed: order_id={} key_request={} biz_request_id={} reason={}"),
          orderId,
          metadata.keyRequestOrDash(),
          metadata.businessRequestIdOrDash(),
          e.getMessage());
      throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "payment failed", e);
    }
  }
}

interface OrderStore {
  void create(String orderId, OrderRequest request, RequestMetadata metadata, Instant createdAt);

  void updateStatus(String orderId, String status, Instant updatedAt);
}

@Component
class JdbcOrderStore implements OrderStore {
  private final JdbcTemplate jdbcTemplate;

  JdbcOrderStore(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  @Override
  public void create(
      String orderId, OrderRequest request, RequestMetadata metadata, Instant createdAt) {
    jdbcTemplate.update(
        """
        INSERT INTO demo_orders (
            order_id, sku, quantity, amount_cent, status,
            key_request, business_request_id, user_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'CREATED', ?, ?, ?, ?, ?)
        """,
        orderId,
        request.sku(),
        request.quantity(),
        request.amountCent(),
        metadata.keyRequest(),
        metadata.businessRequestId(),
        metadata.userId(),
        java.sql.Timestamp.from(createdAt),
        java.sql.Timestamp.from(createdAt));
  }

  @Override
  public void updateStatus(String orderId, String status, Instant updatedAt) {
    int updated =
        jdbcTemplate.update(
            "UPDATE demo_orders SET status = ?, updated_at = ? WHERE order_id = ?",
            status,
            java.sql.Timestamp.from(updatedAt),
            orderId);
    if (updated != 1) {
      throw new IllegalStateException("order row not found: " + orderId);
    }
  }
}

record OrderRequest(String sku, Integer quantity, Integer amountCent) {
  OrderRequest withDefaults() {
    return new OrderRequest(
        sku == null || sku.isBlank() ? "sku-1001" : sku,
        quantity == null || quantity < 1 ? 1 : quantity,
        amountCent == null || amountCent < 1 ? 1999 : amountCent);
  }
}

record InventoryRequest(String orderId, String sku, Integer quantity) {}

record PaymentRequest(String orderId, Integer amountCent) {}

record RequestMetadata(
    String keyRequest,
    String businessRequestId,
    DemoLanguage language,
    String baggage,
    String visitorId,
    String userId,
    String userTier,
    String authState) {
  private static final Pattern BAGGAGE_MEMBER_KEY = Pattern.compile("[A-Za-z0-9_.*/-]+");
  private static final Pattern VISITOR_ID =
      Pattern.compile("visitor-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");
  private static final Set<String> IDENTITY_BAGGAGE_KEYS =
      Set.of("visitor_id", "user_id", "user_tier", "auth_state");
  private static final char[] HEX = "0123456789ABCDEF".toCharArray();

  static RequestMetadata from(
      String keyRequest, String businessRequestId, String language, String baggage) {
    return from(keyRequest, businessRequestId, language, baggage, null, null);
  }

  static RequestMetadata from(
      String keyRequest,
      String businessRequestId,
      String language,
      String baggage,
      String visitorId,
      DemoUser user) {
    String safeVisitorId = safeVisitorId(visitorId);
    String authState = user == null ? "anonymous" : "authenticated";
    return new RequestMetadata(
        blankToNull(keyRequest),
        blankToNull(businessRequestId),
        DemoLanguage.from(language),
        trustedBaggage(baggage, safeVisitorId, user, authState),
        safeVisitorId,
        user == null ? null : user.id(),
        user == null ? null : user.tier(),
        authState);
  }

  HttpEntity<Object> withHeaders(Object body) {
    HttpHeaders headers = new HttpHeaders();
    if (keyRequest != null) {
      headers.set("X-Key-Request", keyRequest);
    }
    if (businessRequestId != null) {
      headers.set("X-Business-Request-Id", businessRequestId);
    }
    headers.set("X-Demo-Language", language.code());
    if (visitorId != null) {
      headers.set("X-Demo-Visitor-Id", visitorId);
    }
    if (userId != null) {
      headers.set("X-Demo-User-Id", userId);
    }
    if (userTier != null) {
      headers.set("X-Demo-User-Tier", userTier);
    }
    headers.set("X-Demo-Auth-State", authState);
    if (baggage != null) {
      headers.set("baggage", safeBaggageHeader(baggage));
    }
    return new HttpEntity<>(body, headers);
  }

  void applyResponseHeaders(ResponseEntity.BodyBuilder builder) {
    if (keyRequest != null) {
      builder.header("X-Key-Request", keyRequest);
    }
    if (businessRequestId != null) {
      builder.header("X-Business-Request-Id", businessRequestId);
    }
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
    if (visitorId != null) {
      MDC.put("visitor_id", visitorId);
    }
    if (userId != null) {
      MDC.put("user_id", userId);
    }
    if (userTier != null) {
      MDC.put("user_tier", userTier);
    }
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
    if (value == null) {
      return;
    }
    span.getClass().getMethod("setTag", String.class, String.class).invoke(span, key, value);
    span.getClass()
        .getMethod("setBaggageItem", String.class, String.class)
        .invoke(span, key, value);
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

  private static String trustedBaggage(
      String value, String visitorId, DemoUser user, String authState) {
    List<String> members = new ArrayList<>();
    if (value != null) {
      for (String item : value.split(",")) {
        String trimmed = item.trim();
        if (trimmed.isEmpty()) {
          continue;
        }
        String[] parts = trimmed.split("=", 2);
        String key = parts[0].trim();
        if (IDENTITY_BAGGAGE_KEYS.contains(key) || !BAGGAGE_MEMBER_KEY.matcher(key).matches()) {
          continue;
        }
        members.add(
            parts.length == 1 ? key : key + "=" + encodeBaggageValue(parts[1].trim()));
      }
    }
    if (visitorId != null) {
      members.add("visitor_id=" + visitorId);
    }
    if (user != null) {
      members.add("user_id=" + user.id());
      members.add("user_tier=" + user.tier());
    }
    members.add("auth_state=" + authState);
    return String.join(",", members);
  }

  private static String safeBaggageHeader(String value) {
    List<String> members = new ArrayList<>();
    for (String item : value.split(",")) {
      String trimmed = item.trim();
      if (trimmed.isEmpty()) {
        continue;
      }
      String[] parts = trimmed.split("=", 2);
      String key = parts[0].trim();
      if (!BAGGAGE_MEMBER_KEY.matcher(key).matches()) {
        continue;
      }
      if (parts.length == 1) {
        members.add(key);
      } else {
        members.add(key + "=" + encodeBaggageValue(parts[1].trim()));
      }
    }
    return String.join(",", members);
  }

  static String safeVisitorId(String value) {
    String candidate = blankToNull(value);
    return candidate != null && VISITOR_ID.matcher(candidate).matches() ? candidate : null;
  }

  private static String encodeBaggageValue(String value) {
    StringBuilder encoded = new StringBuilder();
    for (int offset = 0; offset < value.length(); ) {
      int codePoint = value.codePointAt(offset);
      if (isBaggageHeaderValueChar(codePoint)) {
        encoded.appendCodePoint(codePoint);
      } else {
        byte[] bytes = new String(Character.toChars(codePoint)).getBytes(StandardCharsets.UTF_8);
        for (byte valueByte : bytes) {
          encoded.append('%').append(HEX[(valueByte >> 4) & 0x0F]).append(HEX[valueByte & 0x0F]);
        }
      }
      offset += Character.charCount(codePoint);
    }
    return encoded.toString();
  }

  private static boolean isBaggageHeaderValueChar(int codePoint) {
    return codePoint >= 0x21
        && codePoint <= 0x7E
        && codePoint != ','
        && codePoint != ';'
        && codePoint != '"'
        && codePoint != '\\';
  }

  private static String blankToNull(String value) {
    return value == null || value.isBlank() ? null : value.trim();
  }
}
