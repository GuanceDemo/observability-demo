package demo.vehicle.flink;

import java.io.Serializable;

/** Public no-arg POJO is both a Flink state type and the Parquet reflection schema. */
public class TelemetryRecord implements Serializable {
  public String eventId;
  public String vehicleId;
  public String tripId;
  public long sequence;
  public long eventTime;
  public double speedKph;
  public double odometerKm;
  public double batterySocPct;
  public double batteryTempC;
  public String mode;
  public boolean anomaly;
  public String anomalyCode;
  public int kafkaPartition;
  public long kafkaOffset;
  public long ingestedAt;
  public TelemetryRecord() {}
}
