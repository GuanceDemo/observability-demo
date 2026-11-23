package demo.vehicle.flink;

import static org.junit.jupiter.api.Assertions.*;
import io.opentelemetry.api.trace.StatusCode;
import io.opentelemetry.sdk.testing.exporter.InMemorySpanExporter;
import io.opentelemetry.sdk.trace.SdkTracerProvider;
import io.opentelemetry.sdk.trace.export.SimpleSpanProcessor;
import java.util.ArrayList;
import org.apache.flink.util.Collector;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.junit.jupiter.api.Test;

class VehicleTracingTest {
  static final String TRACE = "abcdef11111111111111111111111111";
  static final String PARENT = "2222222222222222";
  static final String CONTEXT = "00-" + TRACE + "-" + PARENT + "-01";

  @Test void kafkaHeaderBecomesRemoteParentWithoutChangingPayload() throws Exception {
    var kafka = new ConsumerRecord<byte[], byte[]>("vehicle.telemetry.raw.v1", 0, 12, null, "immutable".getBytes());
    kafka.headers().add("traceparent", CONTEXT.getBytes(java.nio.charset.StandardCharsets.US_ASCII));
    var decoded = new ArrayList<RawEvent>();
    new VehicleJob.RawDecoder().deserialize(kafka, new Collector<>() {
      public void collect(RawEvent raw) { decoded.add(raw); }
      public void close() {}
    });
    assertEquals("immutable", decoded.get(0).payload);
    var exporter = InMemorySpanExporter.create();
    try (var provider = SdkTracerProvider.builder().addSpanProcessor(SimpleSpanProcessor.create(exporter)).build()) {
      var span = new VehicleTracing(provider).start(decoded.get(0));
      span.setStatus(StatusCode.OK); span.end();
      var data = exporter.getFinishedSpanItems().get(0);
      assertEquals("flink.clean_and_detect", data.getName());
      assertEquals("kafka", data.getAttributes().get(io.opentelemetry.api.common.AttributeKey.stringKey("messaging.system")));
      assertEquals(TRACE, data.getTraceId()); assertEquals(PARENT, data.getParentSpanId());
      assertTrue(data.getParentSpanContext().isRemote());
      assertEquals(12L, data.getAttributes().get(io.opentelemetry.api.common.AttributeKey.longKey("messaging.kafka.offset")));
    }
  }
  @Test void missingMalformedAndUntracedRecordsStillDecode() throws Exception {
    assertFalse(VehicleTracing.valid(null));
    assertFalse(VehicleTracing.valid("00-" + "0".repeat(32) + "-" + PARENT + "-01"));
    assertFalse(VehicleTracing.valid(CONTEXT + "secret"));
    assertFalse(VehicleTracing.valid(CONTEXT.toUpperCase()));
    var exporter = InMemorySpanExporter.create();
    try (var provider = SdkTracerProvider.builder().addSpanProcessor(SimpleSpanProcessor.create(exporter)).build()) {
      var raw = new RawEvent("old-record", 0, 1, 1);
      assertFalse(new VehicleTracing(provider).start(raw).getSpanContext().isValid());
      raw.traceparent = CONTEXT.substring(0, 53) + "00";
      var span = new VehicleTracing(provider).start(raw);
      assertEquals(TRACE, span.getSpanContext().getTraceId());
      assertFalse(span.isRecording()); span.end();
      assertTrue(exporter.getFinishedSpanItems().isEmpty());
    }
  }
  @Test void configuredSdkExportsActualProtobufOverJdkHttp() throws Exception {
    var received = new java.util.concurrent.atomic.AtomicInteger();
    var server = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/otel/v1/traces", exchange -> {
      assertEquals("application/x-protobuf", exchange.getRequestHeaders().getFirst("Content-Type"));
      received.set(exchange.getRequestBody().readAllBytes().length);
      exchange.sendResponseHeaders(200, -1); exchange.close();
    });
    server.start();
    try {
      try (var tracing = VehicleTracing.configured(java.util.Map.of("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
          "http://127.0.0.1:" + server.getAddress().getPort() + "/otel/v1/traces"))) {
        var raw = new RawEvent("no-payload-in-span", 0, 1, 1); raw.traceparent = CONTEXT;
        tracing.start(raw).end();
      }
      assertTrue(received.get() > 0, "Configured SDK must load a working sender and flush protobuf");
    } finally { server.stop(0); }
  }
}
