package demo.vehicle.spark;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.*;
import java.time.*;
import java.util.*;
import org.apache.hadoop.fs.FileSystem;
import org.apache.hadoop.fs.Path;
import org.apache.spark.sql.*;
import org.apache.spark.storage.StorageLevel;
import static org.apache.spark.sql.functions.*;

public final class ReportMain {
  private static final ObjectMapper JSON = new ObjectMapper();
  private ReportMain() {}
  public static void main(String[] args) {
    String mode = args.length == 0 ? "normal" : args[0];
    if (!Set.of("normal", "schema-mismatch").contains(mode)) { System.err.println("invalid_mode"); System.exit(1); }
    try { System.exit(run(Settings.fromEnv(), mode)); }
    catch (Exception error) { System.err.println("vehicle_report_failed:" + error.getClass().getSimpleName()); System.exit(1); }
  }
  static int run(Settings settings, String mode) throws Exception {
    try (Connection db = DriverManager.getConnection(settings.jdbcUrl(), settings.mysqlUser(), settings.mysqlPassword())) {
      try (var query = db.createStatement(); var result = query.executeQuery("SELECT GET_LOCK('vehicle-summary',0)")) {
        if (!result.next() || result.getInt(1) != 1) return 4;
      }
      var lineage = new ReportLineage(settings);
      UUID runId = UUID.randomUUID(); Instant started = Instant.now();
      db.setAutoCommit(false);
      recover(db, lineage);
      try (var insert = db.prepareStatement("INSERT INTO pipeline_runs(run_id,job_name,engine,state,started_at,updated_at) VALUES(?,?,'SPARK','START',?,?)")) {
        insert.setString(1, runId.toString()); insert.setString(2, ReportLineage.JOB);
        insert.setTimestamp(3, Timestamp.from(started)); insert.setTimestamp(4, Timestamp.from(started)); insert.executeUpdate();
      }
      int catalogIndex = 0;
      for (String event : lineage.catalog()) enqueue(db, runId, "catalog:" + catalogIndex++, event);
      enqueue(db, runId, "START", lineage.event(runId, "START", null, null, null, null, null)); db.commit();
      SparkSession spark = null;
      long stageStarted = System.nanoTime();
      String currentStage = "initialize";
      try {
        spark = SparkSession.builder().appName("vehicle_summary").master("local[2]")
            .config("spark.ui.enabled", "false").config("spark.sql.shuffle.partitions", "2")
            .config("spark.sql.session.timeZone", "Asia/Shanghai").config("spark.driver.host", "127.0.0.1")
            .config("spark.hadoop.fs.s3a.endpoint", settings.s3Endpoint())
            .config("spark.hadoop.fs.s3a.path.style.access", "true")
            .config("spark.hadoop.fs.s3a.access.key", settings.s3AccessKey())
            .config("spark.hadoop.fs.s3a.secret.key", settings.s3SecretKey())
            .config("spark.hadoop.fs.s3a.aws.credentials.provider", "org.apache.hadoop.fs.s3a.SimpleAWSCredentialsProvider")
            .config("spark.hadoop.fs.s3a.connection.ssl.enabled", Boolean.toString(settings.s3Endpoint().startsWith("https:")))
            .config("spark.sql.parquet.datetimeRebaseModeInRead", "CORRECTED").getOrCreate();
        spark.sparkContext().setLogLevel("WARN");
        stageStarted = stage(runId, "initialize", stageStarted);
        currentStage = "snapshot";
        var root = new Path("s3a://" + settings.lakeBucket() + "/clean");
        FileSystem fs = root.getFileSystem(spark.sparkContext().hadoopConfiguration());
        long startMs = dayStart(started);
        List<String> objects = snapshot(fs, root, startMs, started.toEpochMilli(), settings.maxObjects());
        if (objects.isEmpty()) throw new SourceUnavailable("NO_COMMITTED_INPUT");
        String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
            .digest(String.join("\n", objects).getBytes(StandardCharsets.UTF_8)));
        stageStarted = stage(runId, "snapshot", stageStarted);
        currentStage = "read";
        Dataset<Row> raw = spark.read().parquet(objects.toArray(String[]::new))
            .select("eventId", "vehicleId", "sequence", "eventTime", "speedKph", "odometerKm", "batterySocPct", "batteryTempC", "mode")
            .persist(StorageLevel.MEMORY_AND_DISK());
        long inputRows = raw.count();
        stageStarted = stage(runId, "read", stageStarted);
        currentStage = "deduplicate";
        Dataset<Row> unique = raw.filter(col("eventTime").geq(startMs).and(col("eventTime").lt(started.toEpochMilli())))
            .dropDuplicates("eventId").persist(StorageLevel.MEMORY_AND_DISK());
        Row range = unique.agg(count(lit(1)), min("eventTime"), max("eventTime")).first();
        long uniqueRows = range.getLong(0);
        if (uniqueRows == 0) throw new SourceUnavailable("NO_ELIGIBLE_INPUT");
        raw.unpersist();
        long first = range.getLong(1), last = range.getLong(2);
        if (started.toEpochMilli() - last > 900_000) throw new SourceUnavailable("SOURCE_STALE");
        stageStarted = stage(runId, "deduplicate", stageStarted);
        currentStage = "aggregate";
        SummarySql.prepare(spark, SummarySql.inputForMode(unique, mode));
        List<Row> five = spark.sql(SummarySql.FIVE_MINUTES).collectAsList(), daily = spark.sql(SummarySql.DAILY).collectAsList();
        stageStarted = stage(runId, "aggregate", stageStarted);
        currentStage = "publish";
        try (var delete = db.createStatement()) { delete.executeUpdate("DELETE FROM vehicle_summary_5m"); delete.executeUpdate("DELETE FROM vehicle_daily_summary"); }
        writeSummary(db, "vehicle_summary_5m", "bucket_start", five, runId);
        writeSummary(db, "vehicle_daily_summary", "day", daily, runId);
        try (var insert = db.prepareStatement("INSERT INTO report_batches VALUES(?,?,?,?,?,?,?,?,?,?)")) {
          insert.setString(1, runId.toString()); insert.setTimestamp(2, Timestamp.from(Instant.now())); insert.setString(3, hash);
          insert.setInt(4, objects.size()); insert.setLong(5, inputRows); insert.setLong(6, uniqueRows);
          insert.setLong(7, first); insert.setLong(8, last); insert.setLong(9, startMs); insert.setLong(10, started.toEpochMilli()); insert.executeUpdate();
        }
        finish(db, runId, "COMPLETE", inputRows, five.size() + daily.size(), null,
            JSON.writeValueAsString(Map.of("snapshotHash", hash, "objectCount", objects.size(), "uniqueRows", uniqueRows,
                "sourceMaxEventMs", last, "fiveMinuteRows", five.size(), "dailyRows", daily.size())));
        enqueue(db, runId, "COMPLETE", lineage.event(runId, "COMPLETE", hash, inputRows, (long) five.size(), (long) daily.size(), null));
        db.commit();
        stage(runId, "publish", stageStarted);
        System.out.println(JSON.writeValueAsString(Map.of("event", "vehicle_report_complete", "runId", runId.toString(),
            "engine", "Apache Spark 3.5.8", "inputRows", inputRows, "uniqueRows", uniqueRows, "fiveMinuteRows", five.size(), "dailyRows", daily.size())));
        return 0;
      } catch (Exception error) {
        db.rollback();
        String state = error instanceof SourceUnavailable ? "ABORT" : "FAIL";
        var failure = ReportFailure.capture(error, currentStage);
        finish(db, runId, state, null, null, failure.code(), JSON.writeValueAsString(failure.metadata()));
        enqueue(db, runId, state, lineage.failure(runId, state, failure)); db.commit();
        System.err.println(JSON.writeValueAsString(Map.of("event", "vehicle_report_failed", "runId", runId.toString(), "state", state,
            "code", failure.code(), "stage", failure.failureStage(), "errorType", failure.errorType())));
        return 2;
      } finally {
        if (spark != null) spark.stop();
        try (var unlock = db.createStatement()) { unlock.executeQuery("SELECT RELEASE_LOCK('vehicle-summary')").close(); }
      }
    }
  }
  static long dayStart(Instant instant) {
    return instant.atZone(ZoneId.of("Asia/Shanghai")).toLocalDate()
        .atStartOfDay(ZoneId.of("Asia/Shanghai")).toInstant().toEpochMilli();
  }
  static long stage(UUID runId, String name, long started) {
    long now = System.nanoTime();
    // Only fixed stage names, UUIDs and numbers; timing cannot fail the report commit.
    System.out.printf("{\"event\":\"vehicle_report_stage\",\"runId\":\"%s\",\"stage\":\"%s\",\"durationMs\":%d}%n",
        runId, name, (now - started) / 1_000_000);
    return now;
  }
  static List<String> snapshot(FileSystem fs, Path root, long startMs, long beforeMs, int max) throws Exception {
    List<String> files = new ArrayList<>();
    var hourFormat = java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd/HH").withZone(ZoneOffset.UTC);
    // Flink partitions by UTC processing hour. Never recurse through retained history.
    for (long hour = startMs; hour <= beforeMs; hour += 3_600_000) {
      Path partition = new Path(root, hourFormat.format(Instant.ofEpochMilli(hour)));
      if (!fs.exists(partition)) continue;
      var iterator = fs.listFiles(partition, false);
      while (iterator.hasNext()) {
        var file = iterator.next(); String name = file.getPath().getName();
        if (name.startsWith("part-") && name.endsWith(".parquet") && file.getModificationTime() <= beforeMs - 5000) {
          files.add(file.getPath().toString());
          if (files.size() > max) throw new SourceUnavailable("INPUT_OBJECT_LIMIT");
        }
      }
    }
    Collections.sort(files); return files;
  }
  static void writeSummary(Connection db, String table, String dateColumn, List<Row> rows, UUID runId) throws SQLException {
    if (!Set.of("vehicle_summary_5m", "vehicle_daily_summary").contains(table)) throw new IllegalArgumentException("table");
    try (var insert = db.prepareStatement("INSERT INTO " + table + " (" + dateColumn + ",vehicle_id,sample_count,avg_speed_kph,max_speed_kph,distance_km,min_soc_pct,max_temp_c,high_temp_samples,low_soc_samples,charge_samples,first_sequence,last_sequence,run_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)")) {
      for (Row row : rows) {
        if (dateColumn.equals("day")) insert.setDate(1, row.getDate(0)); else insert.setTimestamp(1, row.getTimestamp(0));
        insert.setString(2, row.getString(1)); insert.setLong(3, row.getLong(2));
        for (int i = 3; i <= 7; i++) insert.setDouble(i + 1, row.getDouble(i));
        for (int i = 8; i <= 12; i++) insert.setLong(i + 1, row.getLong(i));
        insert.setString(14, runId.toString()); insert.addBatch();
      }
      insert.executeBatch();
    }
  }
  static void enqueue(Connection db, UUID id, String state, String payload) throws SQLException {
    try (var insert = db.prepareStatement("INSERT INTO lineage_outbox(event_key,run_id,payload) VALUES(?,?,?)")) {
      insert.setString(1, id + ":" + state); insert.setString(2, id.toString()); insert.setString(3, payload); insert.executeUpdate();
    }
  }
  static void finish(Connection db, UUID id, String state, Long inputs, Integer outputs, String error, String metadata) throws SQLException {
    try (var update = db.prepareStatement("UPDATE pipeline_runs SET state=?,updated_at=UTC_TIMESTAMP(3),finished_at=UTC_TIMESTAMP(3),input_count=?,output_count=?,error_code=?,metadata=? WHERE run_id=?")) {
      update.setString(1, state); update.setObject(2, inputs); update.setObject(3, outputs); update.setString(4, error); update.setString(5, metadata); update.setString(6, id.toString()); update.executeUpdate();
    }
  }
  static void recover(Connection db, ReportLineage lineage) throws SQLException {
    List<UUID> ids = new ArrayList<>();
    try (var query = db.prepareStatement("SELECT run_id FROM pipeline_runs WHERE job_name=? AND state='START'")) {
      query.setString(1, ReportLineage.JOB);
      try (var rs = query.executeQuery()) { while (rs.next()) ids.add(UUID.fromString(rs.getString(1))); }
    }
    for (UUID id : ids) { finish(db, id, "ABORT", null, null, "PROCESS_INTERRUPTED", null); enqueue(db, id, "ABORT", lineage.event(id, "ABORT", null, null, null, null, "PROCESS_INTERRUPTED")); }
    db.commit();
  }
  static final class SourceUnavailable extends Exception { SourceUnavailable(String reason) { super(reason); } }
}
