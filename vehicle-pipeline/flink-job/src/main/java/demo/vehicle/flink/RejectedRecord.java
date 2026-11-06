package demo.vehicle.flink;

import java.io.Serializable;

/** Quarantine carries bounded raw simulated data; no raw payload enters lineage or logs. */
public class RejectedRecord implements Serializable {
  public String reason;
  public String payload;
  public int kafkaPartition;
  public long kafkaOffset;
  public long ingestedAt;
  public RejectedRecord() {}
  public RejectedRecord(RawEvent raw, String reason) {
    this.reason = reason; this.payload = raw.payload.substring(0, Math.min(4096, raw.payload.length()));
    kafkaPartition = raw.kafkaPartition; kafkaOffset = raw.kafkaOffset; ingestedAt = raw.ingestedAt;
  }
}
