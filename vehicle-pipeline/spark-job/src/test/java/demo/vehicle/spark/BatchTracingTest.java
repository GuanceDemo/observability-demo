package demo.vehicle.spark;

import static org.junit.jupiter.api.Assertions.*;
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.trace.StatusCode;
import io.opentelemetry.sdk.testing.exporter.InMemorySpanExporter;
import io.opentelemetry.sdk.trace.SdkTracerProvider;
import io.opentelemetry.sdk.trace.export.SimpleSpanProcessor;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class BatchTracingTest {
  static final UUID RUN = UUID.fromString("00000000-0000-4000-8000-000000000002");
  static final String NAMESPACE = "vehicle-demo.telemetry";

  @Test void successfulBatchHasOneRootAndRealStagesSharingTheLineageRun() throws Exception {
    var exporter = InMemorySpanExporter.create();
    var provider = SdkTracerProvider.builder().addSpanProcessor(SimpleSpanProcessor.create(exporter)).build();
    try (var tracing = new BatchTracing(provider, NAMESPACE, RUN, Instant.now())) {
      for (String stage : new String[]{"snapshot", "read", "deduplicate", "aggregate", "publish"}) tracing.next(stage);
      tracing.success(100, 90, 3, 2, 12345);
      var spans = exporter.getFinishedSpanItems();
      assertEquals(7, spans.size());
      var root = spans.stream().filter(s -> s.getName().equals("spark.batch")).findFirst().orElseThrow();
      assertFalse(root.getParentSpanContext().isValid());
      assertEquals(StatusCode.OK, root.getStatus().getStatusCode());
      assertEquals(3L, root.getAttributes().get(AttributeKey.longKey("batch.output_rows")));
      var settings = new Settings("db", 3306, "writer", "SECRET_NOT_EXPORTED", "http://lake:8333", "key", "secret", "vehicle-lake", NAMESPACE, "mysql://db", 12000);
      var event = new com.fasterxml.jackson.databind.ObjectMapper().readTree(new ReportLineage(settings).event(RUN, "COMPLETE", "hash", 100L, 2L, 1L, null));
      for (var span : spans) {
        assertEquals(event.path("run").path("runId").asText(), span.getAttributes().get(AttributeKey.stringKey("run_id")));
        assertEquals(event.path("job").path("name").asText(), span.getAttributes().get(AttributeKey.stringKey("job_name")));
        assertEquals(root.getTraceId(), span.getTraceId());
        if (span != root) assertEquals(root.getSpanId(), span.getParentSpanId());
        assertFalse(span.getAttributes().toString().contains("SECRET_NOT_EXPORTED"));
      }
    }
  }

  @Test void failureRecordsSafeClassificationAndActualFailedStage() {
    var exporter = InMemorySpanExporter.create();
    var provider = SdkTracerProvider.builder().addSpanProcessor(SimpleSpanProcessor.create(exporter)).build();
    try (var tracing = new BatchTracing(provider, NAMESPACE, RUN, Instant.now())) {
      tracing.next("aggregate");
      tracing.failure("FAIL", "SCHEMA_MISMATCH", "AnalysisException");
      var failed = exporter.getFinishedSpanItems().stream().filter(s -> s.getStatus().getStatusCode() == StatusCode.ERROR).toList();
      assertEquals(2, failed.size());
      assertTrue(failed.stream().anyMatch(s -> s.getName().equals("spark.aggregate")));
      assertTrue(failed.stream().anyMatch(s -> s.getName().equals("spark.batch")));
    }
  }

  @Test void configuredSenderFlushesBatchIdentityAsProtobufWithoutCredentials() throws Exception {
    var received = new AtomicReference<byte[]>();
    var server = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/otel/v1/traces", exchange -> {
      assertEquals("application/x-protobuf", exchange.getRequestHeaders().getFirst("Content-Type"));
      received.set(exchange.getRequestBody().readAllBytes());
      exchange.sendResponseHeaders(200, -1); exchange.close();
    });
    server.start();
    try {
      try (var tracing = BatchTracing.configured(Map.of("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
          "http://127.0.0.1:" + server.getAddress().getPort() + "/otel/v1/traces"), NAMESPACE, RUN, Instant.now())) {
        tracing.success(5, 5, 1, 1, 123);
      }
      assertNotNull(received.get());
      String payload = new String(received.get(), java.nio.charset.StandardCharsets.UTF_8);
      for (String value : new String[]{"vehicle-spark-summary", "spark.batch", RUN.toString(), NAMESPACE, "vehicle_summary"})
        assertTrue(payload.contains(value), value);
    } finally { server.stop(0); }
  }
}
