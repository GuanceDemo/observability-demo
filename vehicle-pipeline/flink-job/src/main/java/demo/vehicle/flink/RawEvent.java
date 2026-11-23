package demo.vehicle.flink;

import java.io.Serializable;

public class RawEvent implements Serializable {
  private static final long serialVersionUID = 2205343594419227106L;
  public String payload;
  public int kafkaPartition;
  public long kafkaOffset;
  public long ingestedAt;
  public String traceparent;
  public RawEvent() {}
  public RawEvent(String payload, int partition, long offset, long timestamp) {
    this.payload = payload; this.kafkaPartition = partition; this.kafkaOffset = offset; this.ingestedAt = timestamp;
  }
}
