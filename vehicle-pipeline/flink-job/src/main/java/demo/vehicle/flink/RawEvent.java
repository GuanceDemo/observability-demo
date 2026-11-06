package demo.vehicle.flink;

import java.io.Serializable;

public class RawEvent implements Serializable {
  public String payload;
  public int kafkaPartition;
  public long kafkaOffset;
  public long ingestedAt;
  public RawEvent() {}
  public RawEvent(String payload, int partition, long offset, long timestamp) {
    this.payload = payload; this.kafkaPartition = partition; this.kafkaOffset = offset; this.ingestedAt = timestamp;
  }
}
