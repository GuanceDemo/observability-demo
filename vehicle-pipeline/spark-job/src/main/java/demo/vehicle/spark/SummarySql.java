package demo.vehicle.spark;

import org.apache.spark.sql.Dataset;
import org.apache.spark.sql.Row;
import org.apache.spark.sql.SparkSession;
import org.apache.spark.storage.StorageLevel;

final class SummarySql {
  private SummarySql() {}
  static final String PREPARE = """
      SELECT *, timestamp_millis(eventTime) AS event_ts,
        GREATEST(0D, odometerKm - COALESCE(LAG(odometerKm) OVER
          (PARTITION BY vehicleId ORDER BY sequence), odometerKm)) AS distanceDeltaKm
      FROM vehicle_samples
      """;
  static final String MEASURES = """
      vehicleId AS vehicle_id, COUNT(*) AS sample_count,
      AVG(speedKph) AS avg_speed_kph, MAX(speedKph) AS max_speed_kph,
      SUM(distanceDeltaKm) AS distance_km, MIN(batterySocPct) AS min_soc_pct,
      MAX(batteryTempC) AS max_temp_c,
      SUM(CASE WHEN batteryTempC >= 55 THEN 1 ELSE 0 END) AS high_temp_samples,
      SUM(CASE WHEN batterySocPct <= 15 THEN 1 ELSE 0 END) AS low_soc_samples,
      SUM(CASE WHEN mode = 'CHARGE' THEN 1 ELSE 0 END) AS charge_samples,
      MIN(sequence) AS first_sequence, MAX(sequence) AS last_sequence
      """;
  static final String FIVE_MINUTES = "SELECT window(event_ts, '5 minutes').start AS bucket_start, " + MEASURES
      + " FROM vehicle_enriched GROUP BY window(event_ts, '5 minutes'), vehicleId ORDER BY bucket_start, vehicleId";
  static final String DAILY = "SELECT to_date(event_ts) AS day, " + MEASURES
      + " FROM vehicle_enriched GROUP BY to_date(event_ts), vehicleId ORDER BY day, vehicleId";
  static Dataset<Row> inputForMode(Dataset<Row> input, String mode) {
    // Simulate an upstream schema rename in this run's in-memory view only.
    // The unchanged business SQL must fail in Spark's analyzer, not in control code.
    return switch (mode) {
      case "normal" -> input;
      case "schema-mismatch" -> input.withColumnRenamed("batterySocPct", "batterySocPercent");
      default -> throw new IllegalArgumentException("invalid_mode");
    };
  }
  static void prepare(SparkSession spark, Dataset<Row> unique) {
    unique.createOrReplaceTempView("vehicle_samples");
    // Both report actions reuse the same ordered distance calculation.
    spark.sql(PREPARE).persist(StorageLevel.MEMORY_AND_DISK()).createOrReplaceTempView("vehicle_enriched");
  }
}
