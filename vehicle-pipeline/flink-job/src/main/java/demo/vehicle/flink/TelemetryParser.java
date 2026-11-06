package demo.vehicle.flink;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Set;

public final class TelemetryParser {
  private static final ObjectMapper JSON = new ObjectMapper();
  private static final Set<String> MODES = Set.of("DRIVE", "PARK", "CHARGE");
  private TelemetryParser() {}

  public static TelemetryRecord parse(RawEvent raw) {
    try {
      if (raw.payload.length() > 16384) throw new IllegalArgumentException("payload_too_large");
      JsonNode n = JSON.readTree(raw.payload);
      if (n == null || !n.isObject() || integer(n, "schemaVersion") != 1) throw new IllegalArgumentException("schema_version");
      var r = new TelemetryRecord();
      r.vehicleId = text(n, "vehicleId", 64); r.tripId = text(n, "tripId", 128);
      if (!r.vehicleId.matches("[a-zA-Z0-9_-]+")) throw new IllegalArgumentException("vehicle_id");
      r.sequence = integer(n, "sequence"); r.eventTime = integer(n, "eventTime");
      if (r.sequence < 1 || r.eventTime < 1) throw new IllegalArgumentException("sequence_or_time");
      r.eventId = text(n, "eventId", 160);
      if (!r.eventId.equals(r.vehicleId + ":" + r.sequence)) throw new IllegalArgumentException("event_id");
      r.mode = text(n, "mode", 16);
      if (!MODES.contains(r.mode)) throw new IllegalArgumentException("mode");
      r.speedKph = number(n, "speedKph", 0, 250);
      r.odometerKm = number(n, "odometerKm", 0, 100_000_000);
      r.batterySocPct = number(n, "batterySocPct", 0, 100);
      r.batteryTempC = number(n, "batteryTempC", -40, 120);
      if (!r.mode.equals("DRIVE") && r.speedKph != 0) throw new IllegalArgumentException("stationary_speed");
      boolean monotonic = n.has("sampleMonotonicMs"), producer = n.has("producerRunId");
      if (monotonic != producer) throw new IllegalArgumentException("sampling_metadata");
      if (monotonic && (integer(n, "sampleMonotonicMs") < 0 || text(n, "producerRunId", 128).isBlank()))
        throw new IllegalArgumentException("sampling_metadata");
      r.anomalyCode = (r.batteryTempC >= 55 ? "HIGH_TEMPERATURE" : "")
          + (r.batterySocPct <= 15 ? (r.batteryTempC >= 55 ? ",LOW_BATTERY" : "LOW_BATTERY") : "");
      r.anomaly = !r.anomalyCode.isEmpty();
      r.kafkaPartition = raw.kafkaPartition; r.kafkaOffset = raw.kafkaOffset; r.ingestedAt = raw.ingestedAt;
      return r;
    } catch (IllegalArgumentException e) { throw e; }
    catch (Exception e) { throw new IllegalArgumentException("invalid_json"); }
  }
  public static String key(RawEvent raw) {
    try { return parse(raw).vehicleId; } catch (IllegalArgumentException e) { return "_invalid"; }
  }
  public static String fingerprint(TelemetryRecord r) {
    // Transport coordinates differ on retries; the immutable business fields must agree.
    String value = String.join("|", r.eventId, r.tripId, Long.toString(r.eventTime),
        Double.toString(r.speedKph), Double.toString(r.odometerKm), Double.toString(r.batterySocPct),
        Double.toString(r.batteryTempC), r.mode);
    try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
    catch (Exception e) { throw new IllegalStateException("sha256_unavailable"); }
  }
  private static String text(JsonNode n, String field, int max) {
    JsonNode v = n.get(field);
    if (v == null || !v.isTextual() || v.asText().isBlank() || v.asText().length() > max) throw new IllegalArgumentException("invalid_" + field);
    return v.asText();
  }
  private static long integer(JsonNode n, String field) {
    JsonNode v = n.get(field);
    if (v == null || !v.isIntegralNumber() || !v.canConvertToLong()) throw new IllegalArgumentException("invalid_" + field);
    return v.longValue();
  }
  private static double number(JsonNode n, String field, double min, double max) {
    JsonNode v = n.get(field);
    if (v == null || !v.isNumber() || !Double.isFinite(v.doubleValue()) || v.doubleValue() < min || v.doubleValue() > max)
      throw new IllegalArgumentException("invalid_" + field);
    return v.doubleValue();
  }
}
