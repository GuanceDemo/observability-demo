package demo.payment;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/payments")
class PaymentController {
  private static final Logger log = LoggerFactory.getLogger(PaymentController.class);

  private final FaultState faultState;
  private final PaymentRiskEngine paymentRiskEngine = new PaymentRiskEngine();
  private final int slowMs;
  private final int cpuBurnMs;

  PaymentController(
      FaultState faultState,
      @Value("${fault.payment-slow-ms:1800}") int slowMs,
      @Value("${fault.payment-cpu-burn-ms:1500}") int cpuBurnMs) {
    this.faultState = faultState;
    this.slowMs = slowMs;
    this.cpuBurnMs = cpuBurnMs;
  }

  @PostMapping("/pay")
  Map<String, Object> pay(
      @RequestBody(required = false) PaymentRequest request,
      @RequestHeader(value = "X-Key-Request", required = false) String keyRequest,
      @RequestHeader(value = "X-Business-Request-Id", required = false) String businessRequestId,
      @RequestHeader(value = "X-Demo-Language", required = false) String language,
      @RequestHeader(value = "baggage", required = false) String baggage,
      @RequestHeader(value = "X-Demo-Visitor-Id", required = false) String visitorId,
      @RequestHeader(value = "X-Demo-User-Id", required = false) String userId,
      @RequestHeader(value = "X-Demo-User-Tier", required = false) String userTier)
      throws InterruptedException {
    PaymentRequest paymentRequest =
        request == null ? new PaymentRequest("unknown", 1999) : request.withDefaults();
    RequestMetadata metadata =
        RequestMetadata.from(
            keyRequest, businessRequestId, language, baggage, visitorId, userId, userTier);
    if (paymentRequest.amountCent() <= 0) {
      log.warn(
          metadata
              .language()
              .text(
                  "支付拒绝：订单ID={} 金额={}分 原因=金额必须大于0 关键请求={} 业务请求ID={}",
                  "Payment rejected: order_id={} amount_cent={} reason=amount_must_be_positive key_request={} biz_request_id={}"),
          paymentRequest.orderId(),
          paymentRequest.amountCent(),
          metadata.keyRequestOrDash(),
          metadata.businessRequestIdOrDash());
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "amount must be positive");
    }

    FaultSnapshot fault = faultState.current();
    if (fault.is("payment_error")) {
      fault.applyCurrentSpanTags();
      ResponseStatusException exception =
          new ResponseStatusException(
              HttpStatus.BAD_GATEWAY, "simulated payment provider error");
      log.error(
          metadata
              .language()
              .text(
                  "故障注入：模拟支付服务 5xx 订单ID={} 故障ID={} 层级={} 目标={} 关键请求={} 业务请求ID={}",
                  "Fault injected: simulating payment-service 5xx order_id={} fault_id={} layer={} target={} key_request={} biz_request_id={}"),
          paymentRequest.orderId(),
          fault.mode(),
          fault.layer(),
          fault.target(),
          metadata.keyRequestOrDash(),
          metadata.businessRequestIdOrDash(),
          exception);
      throw exception;
    }
    if (fault.is("payment_cpu_burn")) {
      fault.applyCurrentSpanTags();
      log.warn(
          metadata
              .language()
              .text(
                  "故障注入：模拟支付服务 CPU 繁忙 订单ID={} 故障ID={} 层级={} 目标={} 持续毫秒={} 关键请求={} 业务请求ID={}",
                  "Fault injected: simulating payment-service CPU load order_id={} fault_id={} layer={} target={} duration_ms={} key_request={} biz_request_id={}"),
          paymentRequest.orderId(),
          fault.mode(),
          fault.layer(),
          fault.target(),
          cpuBurnMs,
          metadata.keyRequestOrDash(),
          metadata.businessRequestIdOrDash());
      paymentRiskEngine.runPaymentRiskAssessment(paymentRequest, cpuBurnMs);
    }
    if (fault.is("payment_slow")) {
      fault.applyCurrentSpanTags();
      log.warn(
          metadata
              .language()
              .text(
                  "故障注入：模拟支付服务慢方法 订单ID={} 故障ID={} 层级={} 目标={} 等待毫秒={} 关键请求={} 业务请求ID={}",
                  "Fault injected: simulating slow payment method order_id={} fault_id={} layer={} target={} delay_ms={} key_request={} biz_request_id={}"),
          paymentRequest.orderId(),
          fault.mode(),
          fault.layer(),
          fault.target(),
          slowMs,
          metadata.keyRequestOrDash(),
          metadata.businessRequestIdOrDash());
      Thread.sleep(Math.max(100, Math.min(slowMs, 5000)));
    }

    int latencyMs = ThreadLocalRandom.current().nextInt(80, 181);
    Thread.sleep(latencyMs);
    log.info(
        metadata
            .language()
            .text(
                "支付成功：订单ID={} 金额={}分 耗时={}ms 关键请求={} 业务请求ID={} 上下文={}",
                "Payment completed: order_id={} amount_cent={} duration_ms={} key_request={} biz_request_id={} context={}"),
        paymentRequest.orderId(),
        paymentRequest.amountCent(),
        latencyMs,
        metadata.keyRequestOrDash(),
        metadata.businessRequestIdOrDash(),
        metadata.baggageOrDash());

    Map<String, Object> response = new LinkedHashMap<>();
    response.put("orderId", paymentRequest.orderId());
    response.put("paymentId", "pay-" + paymentRequest.orderId());
    response.put("amountCent", paymentRequest.amountCent());
    response.put("keyRequest", metadata.keyRequest());
    response.put("businessRequestId", metadata.businessRequestId());
    response.put("status", "PAID");
    response.put("latencyMs", latencyMs);
    response.put("paidAt", Instant.now().toString());
    return response;
  }
}

class PaymentRiskEngine {
  private static volatile long lastRiskComputation;

  long runPaymentRiskAssessment(PaymentRequest paymentRequest, int durationMs) {
    long safeDurationMs = Math.max(100, Math.min(durationMs, 5000));
    long deadline = System.nanoTime() + safeDurationMs * 1_000_000L;
    long riskSeed = buildPaymentRiskSeed(paymentRequest);
    long guard = riskSeed;
    do {
      long riskScore =
          calculatePaymentRiskScore(paymentRequest.orderId(), paymentRequest.amountCent(), guard);
      long settlementScore = verifyMerchantSettlementRules(riskScore, paymentRequest.amountCent());
      guard = generatePaymentSignatureDigest(paymentRequest.orderId(), settlementScore);
    } while (System.nanoTime() < deadline);
    lastRiskComputation = guard;
    return guard;
  }

  private long buildPaymentRiskSeed(PaymentRequest paymentRequest) {
    String orderId = normalizedOrderId(paymentRequest.orderId());
    long seed = 0x9E3779B97F4A7C15L ^ paymentRequest.amountCent();
    for (int i = 0; i < orderId.length(); i++) {
      seed ^= (long) orderId.charAt(i) << ((i & 7) * 8);
      seed = Long.rotateLeft(seed, 11) * 0xBF58476D1CE4E5B9L;
    }
    return seed;
  }

  private long calculatePaymentRiskScore(String orderId, int amountCent, long seed) {
    String normalizedOrderId = normalizedOrderId(orderId);
    long score = seed ^ ((long) amountCent << 17);
    for (int i = 0; i < 80_000; i++) {
      long signal =
          normalizedOrderId.charAt(i % normalizedOrderId.length()) + (long) amountCent + i;
      score ^= signal * 0x94D049BB133111EBL;
      score = Long.rotateLeft(score, 13);
      score += (score >>> 7) ^ (score << 9);
    }
    return score;
  }

  private long verifyMerchantSettlementRules(long riskScore, int amountCent) {
    long settlementScore = riskScore ^ 0xD6E8FEB86659FD93L;
    for (int i = 0; i < 60_000; i++) {
      long feeRule = ((long) amountCent + i) * 31L;
      settlementScore += feeRule ^ (settlementScore >>> 11);
      settlementScore = Long.rotateLeft(settlementScore, 17) ^ (settlementScore << 3);
    }
    return settlementScore;
  }

  private long generatePaymentSignatureDigest(String orderId, long settlementScore) {
    String normalizedOrderId = normalizedOrderId(orderId);
    long signature = settlementScore;
    for (int i = 0; i < 50_000; i++) {
      long orderSignal = normalizedOrderId.charAt((i * 7) % normalizedOrderId.length());
      signature ^= orderSignal + 0x100000001B3L + i;
      signature *= 0xC2B2AE3D27D4EB4FL;
      signature ^= signature >>> 29;
    }
    return signature;
  }

  private String normalizedOrderId(String orderId) {
    return orderId == null || orderId.isBlank() ? "unknown-order" : orderId;
  }
}
