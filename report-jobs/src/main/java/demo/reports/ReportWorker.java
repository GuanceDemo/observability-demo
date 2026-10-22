package demo.reports;

import java.sql.SQLException;
import java.time.*;
import java.util.*;
import static demo.reports.Reports.*;

final class ReportWorker implements AutoCloseable {
  interface Sink { void send(String payload) throws DeliveryException; }
  static final class DeliveryException extends Exception { DeliveryException(String code) { super(code); } }
  static final class UpstreamUnavailable extends Exception { UpstreamUnavailable(String code) { super(code); } }
  static final class InjectedFailure extends Exception {}
  private final Database db;
  private final Lineage lineage;
  private final Sink sink;
  private boolean deliveryFailed;
  ReportWorker(Settings settings, Sink sink) throws SQLException {
    db = new Database(settings); lineage = new Lineage(settings); this.sink = sink;
  }
  int run(String mode) throws Exception {
    if (!Set.of("daily", "trend", "fail-daily", "fail-trend", "replay").contains(mode))
      throw new IllegalArgumentException("Unknown mode");
    if (!db.lock()) { log("reports_busy", ""); return 4; }
    try {
      recover();
      flush();
      if (mode.equals("replay")) return deliveryFailed ? 3 : 0;
      String job = mode.endsWith("daily") ? Lineage.DAILY : Lineage.TREND;
      UUID run = UUID.randomUUID();
      db.begin();
      for (String event : lineage.catalog(job)) enqueue(event);
      db.execute("INSERT INTO report_runs(run_id,job,state,started_at) VALUES (?,?,'START',UTC_TIMESTAMP(3))", run.toString(), job);
      enqueue(lineage.event(job, run, "START", null, null, null, null));
      db.commit();
      flush();
      String state = "COMPLETE";
      String error = null;
      Source source = null;
      try {
        db.begin();
        source = readSource(job);
        db.commit();
        if (source.updatedAt().isBefore(Instant.now().minusSeconds(900))) throw new UpstreamUnavailable("UPSTREAM_STALE");
        db.execute("UPDATE report_runs SET upstream_run_id=?,source_updated_at=? WHERE run_id=?",
            source.runId(), source.updatedAt(), run.toString());
        List<Daily> daily = job.equals(Lineage.DAILY) ? Reports.daily(source) : Reports.existingDaily(source);
        List<Trend> trends = job.equals(Lineage.TREND) ? SparkTrends.calculate(daily) : List.of();
        db.begin();
        db.execute("DELETE FROM " + Lineage.output(job));
        if (mode.startsWith("fail-")) throw new InjectedFailure();
        if (job.equals(Lineage.DAILY)) writeDaily(daily, source, run);
        else writeTrend(trends, source, run);
        terminal(job, run, state, source, (long) daily.size(), null);
        db.commit();
      } catch (Exception exception) {
        db.rollback();
        state = exception instanceof UpstreamUnavailable ? "ABORT" : "FAIL";
        error = exception instanceof UpstreamUnavailable ? exception.getMessage()
            : exception instanceof InjectedFailure ? "INJECTED_AFTER_DELETE_ROLLED_BACK"
            : exception instanceof SQLException ? "SQL_ERROR" : "COMPUTE_ERROR";
        db.begin();
        terminal(job, run, state, source, null, error);
        db.commit();
      }
      log("report_finished", "job=" + job + " run_id=" + run + " state=" + state + (error == null ? "" : " error=" + error));
      flush();
      db.execute("DELETE FROM report_outbox WHERE delivered_at < UTC_TIMESTAMP() - INTERVAL 7 DAY");
      db.execute("DELETE FROM report_runs WHERE finished_at < UTC_TIMESTAMP() - INTERVAL 7 DAY");
      return !state.equals("COMPLETE") ? 2 : deliveryFailed ? 3 : 0;
    } finally { db.query("SELECT RELEASE_LOCK('mall-report-jobs')"); }
  }
  private Source readSource(String job) throws Exception {
    List<Map<String,Object>> meta = db.query(job.equals(Lineage.DAILY)
        ? "SELECT s.run_id,s.finished_at AS updated_at,(SELECT c.started_at FROM mall_analytics.pipeline_runs c WHERE c.job='orders_clean' AND c.state='COMPLETE' AND c.finished_at<=s.started_at ORDER BY c.finished_at DESC LIMIT 1) AS window_started_at FROM mall_analytics.pipeline_runs s WHERE s.job='sales_aggregate' AND s.state='COMPLETE' ORDER BY s.finished_at DESC LIMIT 1"
        : "SELECT run_id,source_updated_at AS updated_at FROM report_runs WHERE job='business_daily' AND state='COMPLETE' ORDER BY finished_at DESC LIMIT 1");
    if (meta.isEmpty()) throw new UpstreamUnavailable("UPSTREAM_NOT_READY");
    String id = (String) meta.get(0).get("run_id");
    Instant time = (Instant) meta.get(0).get("updated_at");
    List<Map<String,Object>> rows = db.query("SELECT * FROM " + Lineage.input(job) + " ORDER BY order_date");
    if (rows.stream().anyMatch(row -> !id.equals(row.get("run_id")))) throw new UpstreamUnavailable("UPSTREAM_BATCH_MISMATCH");
    if (job.equals(Lineage.TREND) && rows.size() != 7) throw new UpstreamUnavailable("UPSTREAM_INCOMPLETE");
    if (job.equals(Lineage.DAILY)) {
      Instant windowStart = (Instant) meta.get(0).get("window_started_at");
      if (windowStart == null) throw new UpstreamUnavailable("UPSTREAM_METADATA_MISSING");
      return new Source(id, time, rows, windowStart.atZone(Reports.SHANGHAI).toLocalDate());
    }
    return new Source(id, time, rows);
  }
  private void writeDaily(List<Daily> days, Source source, UUID run) throws SQLException {
    for (Daily d : days) db.execute("""
        INSERT INTO demo_business_daily (order_date,order_count,units,revenue_cent,avg_order_cent,revenue_share_pct,
          is_partial,source_run_id,source_updated_at,run_id,processed_at) VALUES (?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))
        """, d.date(), d.orders(), d.units(), d.revenue(), d.average(), d.share(), d.partial(),
        source.runId(), source.updatedAt(), run.toString());
  }
  private void writeTrend(List<Trend> trends, Source source, UUID run) throws SQLException {
    String origin = (String) source.rows().get(0).get("source_run_id");
    for (Trend t : trends) {
      Daily d = t.daily();
      db.execute("""
          INSERT INTO demo_sales_trend (order_date,order_count,units,revenue_cent,avg_order_cent,revenue_share_pct,
            is_partial,previous_revenue_cent,revenue_change_pct,moving_avg_3d_cent,cumulative_revenue_cent,
            upstream_run_id,source_run_id,source_updated_at,run_id,processed_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))
          """, d.date(), d.orders(), d.units(), d.revenue(), d.average(), d.share(), d.partial(), t.previous(),
          t.change(), t.movingAverage(), t.cumulative(), source.runId(), origin, source.updatedAt(), run.toString());
    }
  }
  private void terminal(String job, UUID run, String state, Source source, Long count, String error) throws SQLException {
    enqueue(lineage.event(job, run, state, source == null ? null : source.runId(),
        source == null ? null : (long) source.rows().size(), count, error));
    db.execute("UPDATE report_runs SET state=?,finished_at=UTC_TIMESTAMP(3),row_count=?,error_code=? WHERE run_id=?",
        state, count, error, run.toString());
  }
  private void recover() throws SQLException {
    for (var row : db.query("SELECT job,run_id FROM report_runs WHERE state='START'")) {
      String job = (String) row.get("job");
      if (!Set.of(Lineage.DAILY, Lineage.TREND).contains(job)) throw new IllegalStateException("Unknown stored job");
      db.begin();
      terminal(job, UUID.fromString((String) row.get("run_id")), "ABORT", null, null, "WORKER_INTERRUPTED");
      db.commit();
    }
  }
  private void enqueue(String payload) throws SQLException { db.execute("INSERT INTO report_outbox(payload) VALUES (?)", payload); }
  private void flush() throws SQLException {
    if (deliveryFailed) return;
    List<Map<String,Object>> rows;
    while (!(rows = db.query("SELECT id,payload FROM report_outbox WHERE delivered_at IS NULL ORDER BY id LIMIT 100")).isEmpty()) {
      for (var row : rows) {
        try { sink.send((String) row.get("payload")); }
        catch (DeliveryException exception) {
          deliveryFailed = true;
          db.execute("UPDATE report_outbox SET attempts=attempts+1,last_error=? WHERE id=?", exception.getMessage(), row.get("id"));
          log("lineage_pending", exception.getMessage()); return;
        }
        db.execute("UPDATE report_outbox SET attempts=attempts+1,delivered_at=UTC_TIMESTAMP(3),last_error=NULL WHERE id=?", row.get("id"));
      }
    }
  }
  static void log(String event, String details) { System.out.println("event=" + event + " service=mall-report-jobs " + details); }
  @Override public void close() throws SQLException { db.close(); }
}
