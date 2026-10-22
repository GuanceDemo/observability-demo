package demo.order;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import java.util.Map;
import java.sql.SQLException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@RestController
class SalesReportController {
  private static final Logger log = LoggerFactory.getLogger(SalesReportController.class);
  private final SalesReportStore store;
  SalesReportController(SalesReportStore store) { this.store = store; }

  @GetMapping("/api/reports/sales")
  ResponseEntity<Map<String, Object>> sales() {
    try {
      return ResponseEntity.ok().header("Cache-Control", "no-store").body(store.read());
    } catch (SQLException exception) {
      // This optional read pool must never turn a report outage into a checkout outage.
      // Driver messages can contain connection details; return/log only a safe classification.
      log.warn("Sales report unavailable: error_type={}", exception.getClass().getSimpleName());
      return ResponseEntity.status(503).header("Cache-Control", "no-store")
          .body(Map.of("status", "unavailable", "code", "REPORT_DATABASE_UNAVAILABLE"));
    }
  }
}
