package demo.payment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.server.ResponseStatusException;

class PaymentControllerTest {
  private MockMvc mockMvc;

  @BeforeEach
  void setUp() {
    mockMvc =
        MockMvcBuilders.standaloneSetup(new PaymentController(new FaultState(), 1800, 1500))
            .build();
  }

  @Test
  void payAcceptsPositiveAmount() throws Exception {
    mockMvc
        .perform(
            post("/api/payments/pay")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """
                    {"orderId":"ord-1001","amountCent":1999}
                    """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.orderId").value("ord-1001"))
        .andExpect(jsonPath("$.amountCent").value(1999))
        .andExpect(jsonPath("$.status").value("PAID"));
  }

  @Test
  void payDefaultsNonPositiveAmount() throws Exception {
    mockMvc
        .perform(
            post("/api/payments/pay")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """
                    {"orderId":"ord-1001","amountCent":0}
                    """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.amountCent").value(1999))
        .andExpect(jsonPath("$.status").value("PAID"));
  }

  @Test
  void paymentErrorLogsThrowableAtErrorAndKeepsBadGatewayResponse() throws Exception {
    FaultState faultState = new FaultState();
    faultState.enable("payment_error", 30);
    MockMvc faultMvc =
        MockMvcBuilders.standaloneSetup(new PaymentController(faultState, 1800, 1500)).build();
    Logger logger = (Logger) LoggerFactory.getLogger(PaymentController.class);
    ListAppender<ILoggingEvent> appender = new ListAppender<>();
    appender.start();
    logger.addAppender(appender);

    try {
      faultMvc
          .perform(
              post("/api/payments/pay")
                  .contentType(MediaType.APPLICATION_JSON)
                  .header("X-Demo-Language", "en")
                  .content(
                      """
                      {"orderId":"ord-payment-error","amountCent":1999}
                      """))
          .andExpect(status().isBadGateway())
          .andExpect(
              result ->
                  assertThat(result.getResolvedException())
                      .isInstanceOf(ResponseStatusException.class))
          .andExpect(
              result ->
                  assertThat(
                          ((ResponseStatusException) result.getResolvedException()).getReason())
                      .isEqualTo("simulated payment provider error"));

      List<ILoggingEvent> faultEvents =
          appender.list.stream()
              .filter(
                  event ->
                      event.getFormattedMessage().contains("simulating payment-service 5xx"))
              .toList();
      assertThat(faultEvents).hasSize(1);
      ILoggingEvent errorEvent = faultEvents.get(0);
      assertThat(errorEvent.getLevel().levelStr).isEqualTo("ERROR");
      assertThat(errorEvent.getFormattedMessage())
          .contains("order_id=ord-payment-error")
          .contains("fault_id=payment_error");
      assertThat(errorEvent.getThrowableProxy()).isNotNull();
      assertThat(errorEvent.getThrowableProxy().getClassName())
          .isEqualTo(ResponseStatusException.class.getName());
    } finally {
      logger.detachAppender(appender);
      appender.stop();
    }
  }

  @Test
  void canEnableAndDisablePaymentFault() throws Exception {
    FaultState faultState = new FaultState();
    MockMvc faultMvc =
        MockMvcBuilders.standaloneSetup(new FaultAdminController(faultState)).build();

    faultMvc
        .perform(post("/admin/fault/payment-slow"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.mode").value("payment_slow"))
        .andExpect(jsonPath("$.layer").value("service"));

    faultMvc
        .perform(get("/admin/fault"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.mode").value("payment_slow"));

    faultMvc
        .perform(post("/admin/fault/off"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.mode").value("none"));
  }

  @Test
  void paymentFaultExpiresAfterTtl() {
    AtomicReference<Instant> now = new AtomicReference<>(Instant.parse("2026-07-14T00:00:00Z"));
    FaultState state = new FaultState(now::get);
    state.enable("payment_slow", 30);
    assertThat(state.current().mode()).isEqualTo("payment_slow");

    now.set(now.get().plusSeconds(31));
    assertThat(state.current().mode()).isEqualTo("none");
  }

  @Test
  void requestMetadataAddsValidatedUserIdentityToMdc() {
    RequestMetadata metadata =
        RequestMetadata.from(
            "checkout_submit_order",
            "biz-payment-identity",
            "en",
            "auth_state=anonymous,user_id=attacker",
            "visitor-12345678-1234-4123-8123-123456789abc",
            "demo-reader-001",
            "standard");
    try {
      metadata.applyCurrentSpanTags();
      assertThat(MDC.get("visitor_id"))
          .isEqualTo("visitor-12345678-1234-4123-8123-123456789abc");
      assertThat(MDC.get("user_id")).isEqualTo("demo-reader-001");
      assertThat(MDC.get("user_tier")).isEqualTo("standard");
      assertThat(MDC.get("auth_state")).isEqualTo("authenticated");
    } finally {
      ProcessIdentity.clearMdc();
    }
  }
}
