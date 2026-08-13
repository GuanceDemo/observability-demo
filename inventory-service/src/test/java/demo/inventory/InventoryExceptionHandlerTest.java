package demo.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

class InventoryExceptionHandlerTest {
  @Test
  void logsRedisTimeoutBeforeRequestIdentityIsCleared() throws Exception {
    Logger logger = (Logger) LoggerFactory.getLogger(InventoryExceptionHandler.class);
    ListAppender<ILoggingEvent> appender = new ListAppender<>();
    appender.start();
    logger.addAppender(appender);

    try {
      MockMvc mockMvc =
          MockMvcBuilders.standaloneSetup(new TimeoutController())
              .setControllerAdvice(new InventoryExceptionHandler())
              .addInterceptors(new KeyRequestSpanTagInterceptor())
              .build();

      mockMvc
          .perform(
              get("/api/inventory/timeout")
                  .header("X-Key-Request", "checkout_submit_order")
                  .header("X-Business-Request-Id", "biz-timeout-test")
                  .header("X-Demo-Language", "en"))
          .andExpect(status().isServiceUnavailable())
          .andExpect(jsonPath("$.status").value(503))
          .andExpect(jsonPath("$.error").value("Service Unavailable"))
          .andExpect(jsonPath("$.message").value("Redis command timed out"))
          .andExpect(jsonPath("$.path").value("/api/inventory/timeout"));

      ILoggingEvent errorEvent =
          appender.list.stream()
              .filter(event -> "ERROR".equals(event.getLevel().levelStr))
              .findFirst()
              .orElseThrow();
      Map<String, String> context = errorEvent.getMDCPropertyMap();
      assertThat(errorEvent.getFormattedMessage())
          .contains("Inventory request failed: Redis command timed out")
          .contains("status=503");
      assertThat(errorEvent.getThrowableProxy()).isNotNull();
      assertThat(context.get("host")).isNotBlank();
      assertThat(context.get("host_name")).isNotBlank();
      assertThat(context.get("pod_name")).isNotBlank();
      assertThat(context.get("pod_namespace")).isNotBlank();
      assertThat(context.get("container_name")).isNotBlank();
      assertThat(context.get("key_request")).isEqualTo("checkout_submit_order");
      assertThat(context.get("biz_request_id")).isEqualTo("biz-timeout-test");
    } finally {
      logger.detachAppender(appender);
      appender.stop();
    }
  }

  @RestController
  private static class TimeoutController {
    @GetMapping("/api/inventory/timeout")
    void timeout() {
      throw new QueryTimeoutException("Redis command timed out");
    }
  }
}
