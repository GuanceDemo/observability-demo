package demo.reports;

import java.nio.charset.StandardCharsets;
import java.sql.*;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import static org.junit.jupiter.api.Assertions.*;

@EnabledIfEnvironmentVariable(named="REPORT_MYSQL_PORT", matches="[0-9]+")
class ReportIntegrationTest {
  private Settings settings;
  private final List<String> delivered = new ArrayList<>();
  private int run(String mode) throws Exception {
    try (ReportWorker worker = new ReportWorker(settings, delivered::add)) { return worker.run(mode); }
  }
  @Test void realMysqlSparkRollbackPermissionsAndReplay() throws Exception {
    int port = Integer.parseInt(System.getenv("REPORT_MYSQL_PORT"));
    settings = LineageTest.settings(port);
    try (Connection root = DriverManager.getConnection("jdbc:mysql://127.0.0.1:" + port
        + "/?allowPublicKeyRetrieval=true&connectionTimeZone=UTC", "root", "integration-only"); Statement sql = root.createStatement()) {
      sql.execute("CREATE DATABASE mall_reports"); sql.execute("CREATE DATABASE mall_analytics");
      sql.execute("USE mall_reports");
      String schema = new String(getClass().getResourceAsStream("/schema.sql").readAllBytes(), StandardCharsets.UTF_8);
      for (String command : schema.split(";")) if (!command.isBlank()) sql.execute(command);
      sql.execute("CREATE TABLE mall_analytics.pipeline_runs(run_id CHAR(36),job VARCHAR(64),state VARCHAR(16),started_at DATETIME(3),finished_at DATETIME(3))");
      sql.execute("CREATE TABLE mall_analytics.demo_sales_daily(order_date DATE PRIMARY KEY,order_count BIGINT,units BIGINT,revenue_cent BIGINT,run_id CHAR(36),processed_at DATETIME(3))");
      sql.execute("CREATE USER 'mall_reports_writer'@'%' IDENTIFIED BY 'fixture-password'");
      sql.execute("GRANT SELECT ON mall_analytics.* TO 'mall_reports_writer'@'%'");
      sql.execute("GRANT SELECT,INSERT,UPDATE,DELETE ON mall_reports.* TO 'mall_reports_writer'@'%'");
      String source = UUID.randomUUID().toString();
      sql.execute("INSERT INTO mall_analytics.pipeline_runs VALUES ('" + UUID.randomUUID() + "','orders_clean','COMPLETE',UTC_TIMESTAMP(3)-INTERVAL 2 SECOND,UTC_TIMESTAMP(3)-INTERVAL 1 SECOND),('" + source + "','sales_aggregate','COMPLETE',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))");
      LocalDate today = LocalDate.now(ZoneId.of("Asia/Shanghai"));
      sql.execute("INSERT INTO mall_analytics.demo_sales_daily VALUES ('" + today.minusDays(2) + "',2,5,10001,'" + source + "',UTC_TIMESTAMP(3)),('" + today + "',1,2,1999,'" + source + "',UTC_TIMESTAMP(3))");
      assertEquals(0, run("daily")); assertEquals(0, run("trend"));
      try (Database db = new Database(settings)) {
        var daily = db.query("SELECT * FROM demo_business_daily ORDER BY order_date");
        var trend = db.query("SELECT * FROM demo_sales_trend ORDER BY order_date");
        assertEquals(7, daily.size()); assertEquals(7, trend.size());
        assertEquals(12000L, Reports.number(trend.get(6), "cumulative_revenue_cent"));
        assertNull(trend.get(6).get("revenue_change_pct"));
        assertEquals(source, trend.get(6).get("source_run_id"));
        assertEquals(2, run("fail-daily"));
        assertEquals(daily, db.query("SELECT * FROM demo_business_daily ORDER BY order_date"));
        assertEquals(2, run("fail-trend"));
        assertEquals(trend, db.query("SELECT * FROM demo_sales_trend ORDER BY order_date"));
        assertThrows(SQLException.class, () -> db.execute("DELETE FROM mall_analytics.demo_sales_daily"));
        assertThrows(SQLException.class, () -> db.execute("DROP TABLE demo_sales_trend"));
        // A business success survives telemetry failure; replay uses exactly the persisted JSON.
        try (ReportWorker worker = new ReportWorker(settings, payload -> { throw new ReportWorker.DeliveryException("http_503"); })) {
          assertEquals(3, worker.run("daily"));
        }
        var pending = db.query("SELECT payload FROM report_outbox WHERE delivered_at IS NULL ORDER BY id")
            .stream().map(row -> (String) row.get("payload")).toList();
        assertFalse(pending.isEmpty()); delivered.clear();
        assertEquals(0, run("replay")); assertEquals(pending, delivered);
        UUID crashed = UUID.randomUUID();
        db.execute("INSERT INTO report_runs(run_id,job,state,started_at) VALUES (?,'sales_trend','START',UTC_TIMESTAMP(3))", crashed.toString());
        db.execute("INSERT INTO report_outbox(payload) VALUES (?)", new Lineage(settings).event(Lineage.TREND, crashed, "START", null, null, null, null));
        assertEquals(0, run("replay"));
        assertEquals("ABORT", db.query("SELECT state FROM report_runs WHERE run_id=?", crashed.toString()).get(0).get("state"));
        assertTrue(db.lock()); assertEquals(4, run("daily")); db.query("SELECT RELEASE_LOCK('mall-report-jobs')");
        sql.execute("UPDATE mall_analytics.pipeline_runs SET finished_at=UTC_TIMESTAMP()-INTERVAL 1 HOUR");
        assertEquals(2, run("daily"));
        assertEquals("ABORT", db.query("SELECT state FROM report_runs WHERE job='business_daily' ORDER BY started_at DESC LIMIT 1").get(0).get("state"));
      }
    }
  }
}
