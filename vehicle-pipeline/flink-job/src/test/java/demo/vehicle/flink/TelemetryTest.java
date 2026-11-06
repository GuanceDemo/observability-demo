package demo.vehicle.flink;

import static org.junit.jupiter.api.Assertions.*;
import java.nio.file.Files;
import java.util.*;
import org.apache.avro.generic.GenericRecord;
import org.apache.flink.streaming.api.environment.StreamExecutionEnvironment;
import org.apache.hadoop.fs.Path;
import org.apache.parquet.avro.AvroParquetReader;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class TelemetryTest {
  @TempDir java.nio.file.Path temp;
  static RawEvent event(long seq, double soc, double temperature) {
    return new RawEvent("""
        {"schemaVersion":1,"eventId":"demo-vehicle-001:%d","vehicleId":"demo-vehicle-001",
         "tripId":"test-trip","sequence":%d,"eventTime":1793068500000,
         "speedKph":30,"odometerKm":12000.25,"batterySocPct":%s,"batteryTempC":%s,"mode":"DRIVE"}
        """.formatted(seq, seq, soc, temperature), 0, seq, 1793068500010L);
  }
  @Test void preservesDeployedHaSerializationIdentity() {
    assertEquals(-1526613859223632353L, java.io.ObjectStreamClass.lookup(CleanAndDetect.class).getSerialVersionUID());
  }
  @Test void preservesIdentityAndDerivesRelatedAnomalies() {
    var row = TelemetryParser.parse(event(1, 10, 60));
    assertEquals("demo-vehicle-001:1", row.eventId);
    assertEquals(1793068500000L, row.eventTime);
    assertTrue(row.anomaly); assertEquals("HIGH_TEMPERATURE,LOW_BATTERY", row.anomalyCode);
    var normal = TelemetryParser.parse(event(2, 50, 35));
    assertFalse(normal.anomaly); assertEquals("", normal.anomalyCode);
  }
  @Test void rejectsMalformedAndIncoherentSamplesWithoutLoggingRawValues() {
    for (String payload : List.of("{}", "null", "{", event(1, 101, 30).payload,
        event(1, 50, 30).payload.replace("\"mode\":\"DRIVE\"", "\"mode\":\"CHARGE\""),
        event(1, 50, 30).payload.replace("\"sequence\":1", "\"sequence\":1.5"),
        event(1, 50, 30).payload.replace("\"schemaVersion\":1", "\"schemaVersion\":2"))) {
      var error = assertThrows(IllegalArgumentException.class, () -> TelemetryParser.parse(new RawEvent(payload, 0, 0, 0)));
      assertTrue(error.getMessage().matches("[a-zA-Z0-9_]+"));
    }
  }
  @Test void fingerprintIgnoresTransportRetriesAndRejectsChangedBusinessFields() {
    var original = TelemetryParser.parse(event(1, 50, 30));
    var retry = TelemetryParser.parse(event(1, 50, 30)); retry.kafkaOffset = 100;
    assertEquals(TelemetryParser.fingerprint(original), TelemetryParser.fingerprint(retry));
    retry.batteryTempC = 60;
    assertNotEquals(TelemetryParser.fingerprint(original), TelemetryParser.fingerprint(retry));
  }
  @Test void optionalSamplingMetadataMustAppearTogether() {
    String payload = event(1, 50, 30).payload.replace("\"schemaVersion\":1", "\"schemaVersion\":1,\"sampleMonotonicMs\":100");
    assertThrows(IllegalArgumentException.class, () -> TelemetryParser.parse(new RawEvent(payload, 0, 0, 0)));
    var complete = payload.replace("\"sampleMonotonicMs\":100", "\"sampleMonotonicMs\":100,\"producerRunId\":\"run-test\"");
    assertDoesNotThrow(() -> TelemetryParser.parse(new RawEvent(complete, 0, 0, 0)));
  }
  @Test void realFlinkDeduplicatesAndCommitsReadableParquet() throws Exception {
    var env = StreamExecutionEnvironment.createLocalEnvironment(1);
    var records = List.of(event(1, 50, 30), event(1, 50, 30), event(2, 50, 60), event(3, 10, 30),
        event(1, 50, 61), new RawEvent("{", 0, 99, 1793068500010L));
    var clean = env.fromCollection(records).keyBy(TelemetryParser::key).process(new CleanAndDetect());
    clean.sinkTo(VehicleJob.sink(temp.resolve("clean").toUri().toString(), TelemetryRecord.class));
    clean.getSideOutput(CleanAndDetect.ANOMALIES).sinkTo(VehicleJob.sink(temp.resolve("anomalies").toUri().toString(), TelemetryRecord.class));
    clean.getSideOutput(CleanAndDetect.REJECTED).sinkTo(VehicleJob.sink(temp.resolve("quarantine").toUri().toString(), RejectedRecord.class));
    env.execute("vehicle-test-real-engine");
    List<GenericRecord> rows = read("clean");
    assertEquals(3, rows.size());
    assertEquals(Set.of("demo-vehicle-001:1", "demo-vehicle-001:2", "demo-vehicle-001:3"),
        new HashSet<>(rows.stream().map(row -> row.get("eventId").toString()).toList()));
    assertEquals(2, read("anomalies").size());
    assertEquals(Set.of("conflicting_event_id", "invalid_json"),
        new HashSet<>(read("quarantine").stream().map(row -> row.get("reason").toString()).toList()));
  }
  List<GenericRecord> read(String folder) throws Exception {
    List<GenericRecord> rows = new ArrayList<>();
    try (var files = Files.walk(temp.resolve(folder))) {
      for (var file : files.filter(p -> p.toString().endsWith(".parquet")).toList()) {
        try (var reader = AvroParquetReader.<GenericRecord>builder(new Path(file.toUri())).withDataModel(org.apache.avro.generic.GenericData.get()).build()) {
          GenericRecord row; while ((row = reader.read()) != null) rows.add(row);
        }
      }
    }
    return rows;
  }
}
