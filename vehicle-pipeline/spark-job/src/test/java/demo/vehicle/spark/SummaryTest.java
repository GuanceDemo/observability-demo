package demo.vehicle.spark;

import static org.junit.jupiter.api.Assertions.*;
import java.nio.file.Files;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.apache.hadoop.conf.Configuration;
import org.apache.hadoop.fs.FileSystem;
import org.apache.hadoop.fs.Path;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.spark.sql.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class SummaryTest {
  @TempDir java.nio.file.Path temp;
  @Test void realSparkCountsUniqueEventsAcrossFiveMinuteAndShanghaiDayBoundaries() throws Exception {
    String first = """
        {"eventId":"v:1","vehicleId":"v","sequence":1,"eventTime":%d,"speedKph":30.0,"odometerKm":100.0,"batterySocPct":50.0,"batteryTempC":30.0,"mode":"DRIVE"}
        """.formatted(Instant.parse("2026-10-26T15:59:59Z").toEpochMilli());
    String second = """
        {"eventId":"v:2","vehicleId":"v","sequence":2,"eventTime":%d,"speedKph":40.0,"odometerKm":100.1,"batterySocPct":10.0,"batteryTempC":60.0,"mode":"DRIVE"}
        """.formatted(Instant.parse("2026-10-26T16:00:00Z").toEpochMilli());
    String third = """
        {"eventId":"v:3","vehicleId":"v","sequence":3,"eventTime":%d,"speedKph":0.0,"odometerKm":100.1,"batterySocPct":10.0,"batteryTempC":40.0,"mode":"CHARGE"}
        """.formatted(Instant.parse("2026-10-26T16:01:00Z").toEpochMilli());
    var input = temp.resolve("input.json"); Files.writeString(input, first + second + second + third);
    try (var spark = SparkSession.builder().master("local[2]").appName("vehicle-summary-test")
        .config("spark.ui.enabled", "false").config("spark.sql.shuffle.partitions", "2")
        .config("spark.sql.session.timeZone", "Asia/Shanghai").config("spark.driver.host", "127.0.0.1").getOrCreate()) {
      spark.sparkContext().setLogLevel("ERROR");
      spark.read().json(input.toString()).write().parquet(temp.resolve("parquet").toString());
      var actual = spark.read().parquet(temp.resolve("parquet").toString());
      assertEquals(4, actual.count());
      SummarySql.prepare(spark, actual.dropDuplicates("eventId"));
      var days = spark.sql(SummarySql.DAILY).collectAsList();
      var windows = spark.sql(SummarySql.FIVE_MINUTES).collectAsList();
      assertEquals(2, days.size()); assertEquals(2, windows.size());
      assertEquals("2026-10-26", days.get(0).getDate(0).toString());
      assertEquals("2026-10-27", days.get(1).getDate(0).toString());
      Row day = days.get(1);
      assertEquals(2, day.getLong(2)); assertEquals(20.0, day.getDouble(3));
      assertEquals(0.1, day.getDouble(5), 0.00001); assertEquals(1, day.getLong(8));
      assertEquals(2, day.getLong(9)); assertEquals(1, day.getLong(10));
      assertEquals(days.stream().mapToLong(r -> r.getLong(2)).sum(), windows.stream().mapToLong(r -> r.getLong(2)).sum());
      // A real schema mismatch reaches Spark's analyzer, never a hand-written failure exception.
      SummarySql.prepare(spark, SummarySql.inputForMode(actual.dropDuplicates("eventId"), "schema-mismatch"));
      var error = assertThrows(AnalysisException.class, () -> spark.sql(SummarySql.FIVE_MINUTES).collectAsList());
      assertEquals("UNRESOLVED_COLUMN.WITH_SUGGESTION", error.getErrorClass());
      var failure = ReportFailure.capture(error, "aggregate");
      assertEquals("aggregate", failure.failureStage());
      assertTrue(failure.stackTrace().contains("org.apache.spark.sql"));
      assertTrue(failure.message().contains("batterySocPct"));
      assertFalse(failure.message().contains("v:1"));
      var settings = new Settings("localhost", 3306, "test", "secret", "http://localhost:8333", "test", "secret", "vehicle-lake", "vehicle-demo.telemetry", "mysql://demo-observability-demo-mysql:3306", 12000);
      String event = new ReportLineage(settings).failure(UUID.randomUUID(), "FAIL", failure);
      var facet = new ObjectMapper().readTree(event).path("run").path("facets").path("errorMessage");
      assertEquals(error.getClass().getName(), facet.path("errorType").asText());
      assertEquals("aggregate", facet.path("failureStage").asText());
      assertEquals(0, facet.path("retryCount").asInt(-1));
      assertEquals(failure.stackTrace(), facet.path("stackTrace").asText());
      Files.createDirectories(java.nio.file.Path.of("target"));
      Files.writeString(java.nio.file.Path.of("target/schema-mismatch-event.json"), event);
      // Only the temporary view changed. Retrying normal SQL over the same Parquet succeeds.
      assertEquals(4, spark.read().parquet(temp.resolve("parquet").toString()).count());
      assertTrue(List.of(actual.columns()).contains("batterySocPct"));
      SummarySql.prepare(spark, SummarySql.inputForMode(actual.dropDuplicates("eventId"), "normal"));
      assertEquals(days, spark.sql(SummarySql.DAILY).collectAsList());
      assertEquals(windows, spark.sql(SummarySql.FIVE_MINUTES).collectAsList());
    }
  }
  @Test void failureEvidenceOmitsRawMessagesAndBoundsCauseChains() {
    var error = new IllegalStateException("password=secret123 jdbc://user:pass@host?token=private row=v:123",
        new RuntimeException("secret source payload"));
    var failure = ReportFailure.capture(error, "publish");
    String evidence = failure.metadata().toString();
    assertFalse(evidence.contains("secret123"));
    assertFalse(evidence.contains("user:pass"));
    assertFalse(evidence.contains("v:123"));
    assertFalse(evidence.contains("source payload"));
    assertTrue(failure.stackTrace().contains("Caused by: java.lang.RuntimeException"));
    assertTrue(failure.stackTrace().length() <= 12000);
  }
  @Test void lineageUsesRealEngineAndExactlyMatchingDatasetNames() throws Exception {
    var settings = new Settings("localhost", 3306, "test", "secret", "http://localhost:8333", "test", "secret", "vehicle-lake", "vehicle-demo.telemetry", "mysql://demo-observability-demo-mysql:3306", 12000);
    var id = UUID.randomUUID(); var lineage = new ReportLineage(settings); var json = new ObjectMapper();
    var start = json.readTree(lineage.event(id, "START", null, null, null, null, null));
    var complete = json.readTree(lineage.event(id, "COMPLETE", "abc", 100L, 2L, 1L, null));
    assertEquals(start.path("run").path("runId"), complete.path("run").path("runId"));
    assertEquals("SPARK", complete.path("job").path("facets").path("jobType").path("integration").asText());
    assertEquals("s3://vehicle-lake", complete.path("inputs").get(0).path("namespace").asText());
    assertEquals("clean", complete.path("inputs").get(0).path("name").asText());
    assertEquals(2, complete.path("outputs").size());
    assertTrue(complete.path("job").path("facets").path("sql").path("query").asText().contains("LAG"));
  }
  @Test void snapshotOnlyListsTodaysUtcHoursAndFreezesCommittedFiles() throws Exception {
    Instant started = Instant.parse("2026-11-03T06:45:00Z");
    long end = started.toEpochMilli(), start = ReportMain.dayStart(started);
    assertEquals(Instant.parse("2026-11-02T16:00:00Z").toEpochMilli(), start);
    try (var fs = FileSystem.getLocal(new Configuration())) {
      var root = new Path(temp.toUri());
      for (String file : List.of("2026-11-01/10/part-old.parquet", "2026-11-02/15/part-yesterday.parquet",
          "2026-11-02/16/part-first.parquet", "2026-11-03/06/part-last.parquet",
          "2026-11-03/06/part-new.parquet", "2026-11-03/06/.part-inprogress.parquet",
          "2026-11-03/07/part-future.parquet")) {
        Path path = new Path(root, file);
        fs.mkdirs(path.getParent());
        try (var out = fs.create(path)) { out.write(1); }
        fs.setTimes(path, end - (file.contains("new") ? 4999 : 5000), -1);
      }
      var paths = ReportMain.snapshot(fs, root, start, end, 2);
      assertEquals(2, paths.size());
      assertTrue(paths.get(0).endsWith("2026-11-02/16/part-first.parquet"));
      assertTrue(paths.get(1).endsWith("2026-11-03/06/part-last.parquet"));
      assertThrows(ReportMain.SourceUnavailable.class, () -> ReportMain.snapshot(fs, root, start, end, 1));
      assertTrue(ReportMain.snapshot(fs, new Path(root, "missing"), start, end, 2).isEmpty());
    }
  }
}
