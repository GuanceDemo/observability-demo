package demo.vehicle.flink;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.sdk.testing.exporter.InMemorySpanExporter;
import io.opentelemetry.sdk.trace.SdkTracerProvider;
import io.opentelemetry.sdk.trace.data.SpanData;
import io.opentelemetry.sdk.trace.export.SimpleSpanProcessor;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class RunContextExporterTest {
  static final String JOB = "0123456789abcdef0123456789abcdef";
  static final String RUN = "00000000-0000-4000-8000-000000000001";
  static final ObjectMapper JSON = new ObjectMapper();
  static SpanData span() {
    var exporter = InMemorySpanExporter.create();
    try (var provider = SdkTracerProvider.builder().addSpanProcessor(SimpleSpanProcessor.create(exporter)).build()) {
      var span = provider.get("test").spanBuilder("flink.clean_and_detect")
          .setStartTimestamp(Instant.parse("2026-11-18T03:00:00Z")).startSpan();
      span.end(Instant.parse("2026-11-18T03:00:00.100Z"));
      return exporter.getFinishedSpanItems().get(0);
    }
  }
  static String job(String observed) {
    return "{\"job_name\":\"vehicle_clean_and_detect\",\"run_id\":\"" + RUN
        + "\",\"started_at\":\"2026-11-18T02:00:00+00:00\",\"updated_at\":\"" + observed
        + "\",\"finished_at\":null,\"metadata\":{\"jobId\":\"" + JOB + "\"}}";
  }

  @Test void requiresOriginalEngineAndUniquelyObservedWholeSpanInterval() throws Exception {
    var data = span();
    var jobs = JSON.readTree("[" + job("2026-11-18T03:00:01Z") + "]");
    assertEquals(RUN, RunContextExporter.match(jobs, JOB, data));
    assertNull(RunContextExporter.match(jobs, "f".repeat(32), data));
    assertNull(RunContextExporter.match(JSON.readTree("[" + job("2026-11-18T02:59:59Z") + "]"), JOB, data));
    assertNull(RunContextExporter.match(JSON.readTree("[" + job("2026-11-18T03:00:01Z") + "," + job("2026-11-18T03:00:01Z") + "]"), JOB, data));
    var tagged = RunContextExporter.tagged(data, RUN);
    assertEquals(data.getTraceId(), tagged.getTraceId());
    assertEquals(data.getSpanId(), tagged.getSpanId());
    assertEquals(data.getParentSpanId(), tagged.getParentSpanId());
    assertEquals(data.getStartEpochNanos(), tagged.getStartEpochNanos());
    assertEquals(data.getEndEpochNanos(), tagged.getEndEpochNanos());
  }

  @Test void exportsAfterRealObservationWithoutStretchingDurationOrExposingReport() throws Exception {
    var requests = new AtomicInteger();
    var server = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/api/report", exchange -> {
      String observed = requests.incrementAndGet() == 1 ? "2026-11-18T02:59:59Z" : "2026-11-18T03:00:01Z";
      byte[] body = ("{\"jobs\":[" + job(observed) + "],\"batch\":{\"secretCanary\":\"NEVER_EXPORT_REPORT\"}}").getBytes();
      exchange.sendResponseHeaders(200, body.length); exchange.getResponseBody().write(body); exchange.close();
    });
    server.start();
    try {
      var delegate = InMemorySpanExporter.create();
      try (var exporter = new RunContextExporter(delegate,
          "http://127.0.0.1:" + server.getAddress().getPort() + "/api/report", JOB, 2000, 10)) {
        exporter.export(List.of(span())).join(3, java.util.concurrent.TimeUnit.SECONDS);
        var actual = delegate.getFinishedSpanItems().get(0);
        assertEquals(RUN, actual.getAttributes().get(RunContextExporter.RUN));
        assertEquals(100_000_000, actual.getEndEpochNanos() - actual.getStartEpochNanos());
        assertFalse(actual.getAttributes().toString().contains("NEVER_EXPORT_REPORT"));
        assertTrue(requests.get() >= 2);
      }
    } finally { server.stop(0); }
  }

  @Test void unavailableContextExportsOriginalSpanWithUnknownInsteadOfInventingRun() {
    var delegate = InMemorySpanExporter.create();
    try (var exporter = new RunContextExporter(delegate, "http://127.0.0.1:1/api/report", JOB, 0, 1)) {
      exporter.export(List.of(span()));
      var actual = delegate.getFinishedSpanItems().get(0);
      assertNull(actual.getAttributes().get(RunContextExporter.RUN));
      assertEquals("unknown", actual.getAttributes().get(AttributeKey.stringKey("run_correlation")));
    }
  }
}
