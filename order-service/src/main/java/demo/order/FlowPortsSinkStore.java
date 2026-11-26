package demo.order;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.ObjectReader;
import com.fasterxml.jackson.databind.node.TextNode;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

final class FlowPortsSinkStore {
  private static final int RECENT_LIMIT = 100;
  private static final ObjectReader JSON =
      new ObjectMapper().reader().with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);

  private final AtomicBoolean downstreamDown = new AtomicBoolean();
  private final Sink downstream = new Sink();
  private final Sink archive = new Sink();
  private long rejected503Count;
  private String latestVerifyId = "";
  private boolean drillTracked;

  synchronized void startDrill(String verifyId) {
    selectVerifyId(verifyId);
    drillTracked = true;
  }

  synchronized void recordDownstream(String payload) {
    if (downstreamDown.get()) {
      rejected503Count++;
      throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "FlowPorts demo downstream is down");
    }
    record(downstream, payload);
  }

  synchronized void recordArchive(String payload) {
    record(archive, payload);
  }

  boolean isDownstreamDown() {
    return downstreamDown.get();
  }

  synchronized Snapshot setDownstreamDown(boolean down) {
    downstreamDown.set(down);
    return snapshot();
  }

  synchronized Snapshot snapshot() {
    return new Snapshot(
        downstreamDown.get(), downstream.receivedTotal, rejected503Count, archive.receivedTotal,
        latestVerifyId, downstream.matchedCount, archive.matchedCount,
        downstream.recentEvents(), archive.recentEvents());
  }

  synchronized Snapshot reset() {
    downstreamDown.set(false);
    downstream.clear();
    archive.clear();
    rejected503Count = 0;
    latestVerifyId = "";
    drillTracked = false;
    return snapshot();
  }

  private void record(Sink sink, String payload) {
    JsonNode event = readJson(payload);
    if (event != null) {
      recordEvents(sink, event);
      return;
    }
    payload.lines().filter(line -> !line.isBlank()).forEach(line -> {
      JsonNode decoded = readJson(line);
      recordEvents(sink, decoded != null ? decoded : TextNode.valueOf(line));
    });
  }

  private void recordEvents(Sink sink, JsonNode event) {
    if (event.isArray()) {
      event.forEach(item -> recordEvents(sink, item));
      return;
    }
    String verifyId = verifyId(event);
    if (!drillTracked && !verifyId.isEmpty() && !latestVerifyId.equals(verifyId)) {
      selectVerifyId(verifyId);
    }
    sink.add(event, verifyId, latestVerifyId);
  }

  private void selectVerifyId(String verifyId) {
    latestVerifyId = verifyId;
    downstream.selectVerifyId(verifyId);
    archive.selectVerifyId(verifyId);
  }

  private static JsonNode readJson(String payload) {
    try {
      return JSON.readTree(payload);
    } catch (JsonProcessingException ignored) {
      return null;
    }
  }

  private static String verifyId(JsonNode event) {
    for (JsonNode field : List.of(
        event.path("verify_id"), event.path("fields").path("verify_id"), event.path("tags").path("verify_id"))) {
      if (field.isTextual() && !field.textValue().isBlank()) {
        return field.textValue().trim();
      }
    }
    return "";
  }

  private record Receipt(JsonNode event, String verifyId) {}

  private static final class Sink {
    private final Deque<Receipt> recent = new ArrayDeque<>(RECENT_LIMIT);
    private long receivedTotal;
    private long matchedCount;

    void add(JsonNode event, String verifyId, String latestVerifyId) {
      if (recent.size() == RECENT_LIMIT) {
        recent.removeLast();
      }
      recent.addFirst(new Receipt(event, verifyId));
      receivedTotal++;
      if (!verifyId.isEmpty() && verifyId.equals(latestVerifyId)) {
        matchedCount++;
      }
    }

    void selectVerifyId(String verifyId) {
      matchedCount = recent.stream().filter(receipt -> receipt.verifyId().equals(verifyId)).count();
    }

    List<JsonNode> recentEvents() {
      return recent.stream().map(Receipt::event).toList();
    }

    void clear() {
      recent.clear();
      receivedTotal = 0;
      matchedCount = 0;
    }
  }

  record Snapshot(
      boolean downstreamDown,
      long downstreamReceivedTotal,
      long downstreamRejected503Total,
      long archiveReceivedTotal,
      String latestVerifyId,
      long downstreamMatchedCount,
      long archiveMatchedCount,
      List<JsonNode> recentDownstreamEvents,
      List<JsonNode> recentArchiveEvents) {}
}
