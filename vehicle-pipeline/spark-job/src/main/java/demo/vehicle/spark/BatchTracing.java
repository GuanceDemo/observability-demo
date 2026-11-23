package demo.vehicle.spark;

import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.StatusCode;
import io.opentelemetry.context.Context;
import io.opentelemetry.exporter.otlp.http.trace.OtlpHttpSpanExporter;
import io.opentelemetry.sdk.resources.Resource;
import io.opentelemetry.sdk.trace.SdkTracerProvider;
import io.opentelemetry.sdk.trace.export.BatchSpanProcessor;
import io.opentelemetry.sdk.trace.samplers.Sampler;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** One independent execution trace per real lineage Run, never per input message. */
final class BatchTracing implements AutoCloseable {
  private static final Set<String> STAGES = Set.of("initialize", "snapshot", "read", "deduplicate", "aggregate", "publish");
  private final SdkTracerProvider provider;
  private final Attributes identity;
  private final Span root;
  private Span stage;
  private boolean ended;

  BatchTracing(SdkTracerProvider provider, String namespace, UUID runId, Instant started) {
    this.provider = provider;
    identity = Attributes.builder().put("job_namespace", namespace).put("job_name", ReportLineage.JOB)
        .put("run_id", runId.toString()).put("run_correlation", "execution").build();
    root = provider == null ? Span.getInvalid() : provider.get("vehicle-reporting").spanBuilder("spark.batch")
        .setNoParent().setAllAttributes(identity).setStartTimestamp(started).startSpan();
    next("initialize");
  }

  static BatchTracing configured(String namespace, UUID runId, Instant started) {
    return configured(System.getenv(), namespace, runId, started);
  }

  static BatchTracing configured(Map<String, String> env, String namespace, UUID runId, Instant started) {
    String endpoint = env.getOrDefault("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "");
    SdkTracerProvider provider = null;
    if (!endpoint.isBlank()) {
      try {
        double ratio = Double.parseDouble(env.getOrDefault("OTEL_TRACES_SAMPLER_ARG", "1.0"));
        var exporter = OtlpHttpSpanExporter.builder().setEndpoint(endpoint).setTimeout(Duration.ofSeconds(3)).build();
        provider = SdkTracerProvider.builder().setSampler(Sampler.parentBased(Sampler.traceIdRatioBased(ratio)))
            .setResource(Resource.create(Attributes.builder().put("service.name", "vehicle-spark-summary")
                .put("service.version", "0.1.0").put("service.instance.id", env.getOrDefault("HOSTNAME", "unknown"))
                .put("deployment.environment.name", "demo").put("pipeline", "vehicle-telemetry").put("component", "spark")
                .put("cluster", env.getOrDefault("VEHICLE_CLUSTER", "unknown"))
                .put("topic", "vehicle.telemetry.raw.v1").put("consumer_group", "vehicle-flink-clean-v1").build()))
            .addSpanProcessor(BatchSpanProcessor.builder(exporter).setMaxQueueSize(64).setMaxExportBatchSize(16).build()).build();
      } catch (RuntimeException invalid) { System.err.println("vehicle_batch_tracing_unavailable:" + invalid.getClass().getSimpleName()); }
    }
    return new BatchTracing(provider, namespace, runId, started);
  }

  void next(String name) {
    if (!STAGES.contains(name)) throw new IllegalArgumentException("invalid_trace_stage");
    if (stage != null) stage.end();
    stage = provider == null ? Span.getInvalid() : provider.get("vehicle-reporting").spanBuilder("spark." + name)
        .setParent(Context.root().with(root)).setAllAttributes(identity).startSpan();
  }

  void success(long inputs, long unique, long outputs, long objects, long sourceMaxEventMs) {
    root.setAttribute("batch.input_rows", inputs).setAttribute("batch.unique_rows", unique)
        .setAttribute("batch.output_rows", outputs).setAttribute("batch.input_files", objects)
        .setAttribute("batch.source_max_event_ms", sourceMaxEventMs).setAttribute("run.state", "COMPLETE");
    root.setStatus(StatusCode.OK);
    end();
  }

  void failure(String state, String code, String errorType) {
    root.setAttribute("run.state", state).setAttribute("error.code", code).setAttribute("error.type", errorType);
    root.setStatus(StatusCode.ERROR, "batch_execution_failed");
    stage.setStatus(StatusCode.ERROR, "batch_execution_failed").setAttribute("error.type", errorType);
    end();
  }

  private void end() {
    if (!ended) { ended = true; stage.end(); root.end(); }
  }

  @Override public void close() {
    end();
    if (provider != null) provider.close();
  }
}
