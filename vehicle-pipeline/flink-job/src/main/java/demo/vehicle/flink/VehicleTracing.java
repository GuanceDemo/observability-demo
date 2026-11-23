package demo.vehicle.flink;

import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.api.trace.*;
import io.opentelemetry.context.Context;
import io.opentelemetry.exporter.otlp.http.trace.OtlpHttpSpanExporter;
import io.opentelemetry.sdk.resources.Resource;
import io.opentelemetry.sdk.trace.SdkTracerProvider;
import io.opentelemetry.sdk.trace.export.BatchSpanProcessor;
import io.opentelemetry.sdk.trace.export.SpanExporter;
import java.time.Duration;
import java.util.Map;

/** Processing spans end after validation/collection, not after Parquet checkpoint commit. */
final class VehicleTracing implements AutoCloseable {
  private final SdkTracerProvider provider;
  VehicleTracing(SdkTracerProvider provider) { this.provider = provider; }

  static VehicleTracing configured() {
    return configured(System.getenv());
  }
  static VehicleTracing configured(Map<String, String> env) {
    return configured(env, "");
  }
  static VehicleTracing configured(Map<String, String> env, String engineJobId) {
    String endpoint = env.getOrDefault("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "");
    if (endpoint.isBlank()) return new VehicleTracing(null);
    SpanExporter exporter = OtlpHttpSpanExporter.builder().setEndpoint(endpoint).setTimeout(Duration.ofSeconds(3)).build();
    String contextUrl = env.getOrDefault("VEHICLE_RUN_CONTEXT_URL", "");
    if (!contextUrl.isBlank()) exporter = new RunContextExporter(exporter, contextUrl, engineJobId);
    var resource = Resource.create(Attributes.builder()
        .put("service.name", "vehicle-flink-consumer").put("service.version", "0.1.0")
        .put("service.instance.id", env.getOrDefault("HOSTNAME", "unknown"))
        .put("deployment.environment.name", "demo").put("pipeline", "vehicle-telemetry")
        .put("job_namespace", env.getOrDefault("JOB_NAMESPACE", "vehicle-demo.telemetry"))
        .put("job_name", "vehicle_clean_and_detect").put("flink.job.id", engineJobId)
        .put("topic", "vehicle.telemetry.raw.v1").put("consumer_group", "vehicle-flink-clean-v1")
        .put("component", "flink")
        .put("cluster", env.getOrDefault("VEHICLE_CLUSTER", "unknown")).build());
    return new VehicleTracing(SdkTracerProvider.builder().setResource(resource)
        .addSpanProcessor(BatchSpanProcessor.builder(exporter).setMaxQueueSize(256)
            .setMaxExportBatchSize(32).build()).build());
  }

  Span start(RawEvent raw) {
    if (provider == null || !valid(raw.traceparent)) return Span.getInvalid();
    String[] parts = raw.traceparent.split("-");
    var parent = SpanContext.createFromRemoteParent(parts[1], parts[2],
        TraceFlags.fromHex(parts[3], 0), TraceState.getDefault());
    return provider.get("vehicle-processing").spanBuilder("flink.clean_and_detect")
        .setParent(Context.root().with(Span.wrap(parent))).setSpanKind(SpanKind.CONSUMER)
        .setAttribute("messaging.system", "kafka")
        .setAttribute("messaging.destination.name", "vehicle.telemetry.raw.v1")
        .setAttribute("messaging.consumer.group.name", "vehicle-flink-clean-v1")
        .setAttribute("messaging.destination.partition.id", Integer.toString(raw.kafkaPartition))
        .setAttribute("messaging.kafka.offset", raw.kafkaOffset)
        .setAttribute("messaging.operation.type", "process").startSpan();
  }
  static boolean valid(String value) {
    return value != null && value.matches("00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}")
        && !value.substring(3, 35).equals("0".repeat(32))
        && !value.substring(36, 52).equals("0".repeat(16));
  }
  @Override public void close() { if (provider != null) provider.close(); }
}
