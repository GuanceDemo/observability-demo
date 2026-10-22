package demo.order;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.*;
import java.time.*;
import java.util.*;
import javax.sql.DataSource;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
class SalesReportStore implements DisposableBean {
  private final DataSource dataSource;

  @Autowired
  SalesReportStore(@Value("${reports.enabled:false}") boolean enabled,
                   @Value("${reports.jdbc-url:}") String url,
                   @Value("${reports.username:mall_reports_reader}") String user,
                   @Value("${reports.password:}") String password) {
    if (!enabled || url.isBlank() || password.isBlank()) { dataSource = null; return; }
    HikariConfig config = new HikariConfig();
    config.setPoolName("sales-report-reader"); config.setJdbcUrl(url);
    config.setUsername(user); config.setPassword(password); config.setReadOnly(true);
    config.setMaximumPoolSize(2); config.setMinimumIdle(0); config.setConnectionTimeout(2500);
    config.setInitializationFailTimeout(-1); config.setIdleTimeout(60000);
    config.addDataSourceProperty("connectionTimeZone", "UTC");
    config.addDataSourceProperty("forceConnectionTimeZoneToSession", "true");
    config.addDataSourceProperty("connectTimeout", "2000"); config.addDataSourceProperty("socketTimeout", "4000");
    dataSource = new HikariDataSource(config);
  }
  SalesReportStore(DataSource dataSource) { this.dataSource = dataSource; }

  Map<String, Object> read() throws SQLException {
    if (dataSource == null) return Map.of("status", "disabled");
    try (Connection connection = dataSource.getConnection()) {
      connection.setReadOnly(true); connection.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
      connection.setAutoCommit(false);
      List<Map<String,Object>> days = query(connection, """
          SELECT order_date AS date,order_count AS orders,units,revenue_cent AS revenueCent,
            avg_order_cent AS averageOrderCent,revenue_share_pct AS revenueSharePct,is_partial AS partial,
            previous_revenue_cent AS previousRevenueCent,revenue_change_pct AS revenueChangePct,
            moving_avg_3d_cent AS movingAverage3dCent,cumulative_revenue_cent AS cumulativeRevenueCent,
            upstream_run_id AS upstreamRunId,source_run_id AS sourceRunId,source_updated_at AS sourceUpdatedAt,
            run_id AS runId,processed_at AS processedAt
          FROM demo_sales_trend ORDER BY order_date
          """);
      List<Map<String,Object>> jobs = new ArrayList<>();
      for (String job : List.of("business_daily", "sales_trend")) {
        jobs.addAll(query(connection, """
            SELECT job,state,run_id AS runId,upstream_run_id AS upstreamRunId,
              source_updated_at AS sourceUpdatedAt,started_at AS startedAt,finished_at AS finishedAt,
              row_count AS rowCount,error_code AS errorCode
            FROM report_runs WHERE job=? ORDER BY started_at DESC LIMIT 1
            """, job));
      }
      connection.commit();
      return payload(days, jobs, Instant.now());
    }
  }
  static Map<String,Object> payload(List<Map<String,Object>> days, List<Map<String,Object>> jobs, Instant now) {
    if (days.isEmpty()) return Map.of("status", "empty", "days", days, "jobs", jobs);
    Map<String,Object> last = days.get(days.size()-1);
    Instant sourceTime = (Instant) last.get("sourceUpdatedAt");
    long age = Math.max(0, Duration.between(sourceTime, now).getSeconds());
    long revenue = 0, orders = 0, units = 0;
    for (var day : days) {
      revenue = Math.addExact(revenue, ((Number) day.get("revenueCent")).longValue());
      orders = Math.addExact(orders, ((Number) day.get("orders")).longValue());
      units = Math.addExact(units, ((Number) day.get("units")).longValue());
    }
    Map<String,Object> result = new LinkedHashMap<>();
    result.put("status", "ready"); result.put("stale", age > 900); result.put("ageSeconds", age);
    result.put("timezone", "Asia/Shanghai"); result.put("sourceUpdatedAt", sourceTime);
    result.put("generatedAt", last.get("processedAt")); result.put("runId", last.get("runId"));
    result.put("upstreamRunId", last.get("upstreamRunId")); result.put("sourceRunId", last.get("sourceRunId"));
    result.put("summary", Map.of("revenueCent", revenue, "orders", orders, "units", units,
        "averageOrderCent", orders == 0 ? BigDecimal.ZERO
            : BigDecimal.valueOf(revenue).divide(BigDecimal.valueOf(orders), 2, RoundingMode.HALF_UP)));
    result.put("days", days); result.put("jobs", jobs);
    return result;
  }
  private List<Map<String,Object>> query(Connection connection, String sql, Object... args) throws SQLException {
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setQueryTimeout(3);
      for (int i=0; i<args.length; i++) statement.setObject(i+1,args[i]);
      try (ResultSet rs = statement.executeQuery()) {
        List<Map<String,Object>> rows = new ArrayList<>();
        while (rs.next()) {
          Map<String,Object> row = new LinkedHashMap<>();
          for (int i=1; i<=rs.getMetaData().getColumnCount(); i++) {
            String key = rs.getMetaData().getColumnLabel(i);
            int type = rs.getMetaData().getColumnType(i);
            Object value;
            if (type == Types.TIMESTAMP) {
              Timestamp timestamp = rs.getTimestamp(i, Calendar.getInstance(TimeZone.getTimeZone("UTC")));
              value = timestamp == null ? null : timestamp.toInstant();
            } else if (type == Types.DATE) value = rs.getObject(i, LocalDate.class).toString();
            else if (key.equals("partial")) value = rs.getBoolean(i);
            else value = rs.getObject(i);
            row.put(key, value);
          }
          rows.add(row);
        }
        return rows;
      }
    }
  }
  @Override public void destroy() { if (dataSource instanceof HikariDataSource pool) pool.close(); }
}
