package demo.order;

import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import java.sql.SQLException;
import java.time.Instant;
import java.util.*;
import java.math.BigDecimal;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class SalesReportControllerTest {
  @Test void optionalConnectionAndOutageHaveExplicitStates() throws Exception {
    var disabled = MockMvcBuilders.standaloneSetup(new SalesReportController(new SalesReportStore(false, "", "", ""))).build();
    disabled.perform(get("/api/reports/sales")).andExpect(status().isOk())
        .andExpect(header().string("Cache-Control", "no-store")).andExpect(jsonPath("$.status").value("disabled"));
    var store = mock(SalesReportStore.class);
    when(store.read()).thenThrow(new SQLException("sensitive database detail"));
    var mvc = MockMvcBuilders.standaloneSetup(new SalesReportController(store)).build();
    mvc.perform(get("/api/reports/sales")).andExpect(status().isServiceUnavailable())
        .andExpect(jsonPath("$.status").value("unavailable"))
        .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("sensitive"))));
    mvc.perform(post("/api/reports/sales")).andExpect(status().isMethodNotAllowed());
  }
  @Test void totalsUseCommittedBatchAndFreshnessUsesSourceTime() {
    Instant source = Instant.parse("2026-10-22T04:00:00Z");
    var first = new HashMap<String,Object>();
    first.put("revenueCent", 10001L); first.put("orders", 2L); first.put("units", 5L);
    first.put("sourceUpdatedAt", source); first.put("processedAt", source.plusSeconds(2000));
    first.put("runId", "spark-run"); first.put("upstreamRunId", "java-run"); first.put("sourceRunId", "python-run");
    var second = new HashMap<>(first); second.put("revenueCent", 1999L); second.put("orders",1L); second.put("units",2L);
    var payload = SalesReportStore.payload(List.of(first, second), List.of(), source.plusSeconds(1000));
    assertThat(payload.get("stale")).isEqualTo(true);
    assertThat(payload.get("summary")).isEqualTo(Map.of("revenueCent",12000L,"orders",3L,"units",7L,"averageOrderCent",new BigDecimal("4000.00")));
    assertThat(payload.get("runId")).isEqualTo("spark-run");
    assertThat(SalesReportStore.payload(List.of(),List.of(),source).get("status")).isEqualTo("empty");
  }
}
