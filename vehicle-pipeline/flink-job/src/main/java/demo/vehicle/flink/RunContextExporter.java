package demo.vehicle.flink;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.sdk.common.CompletableResultCode;
import io.opentelemetry.sdk.trace.data.DelegatingSpanData;
import io.opentelemetry.sdk.trace.data.SpanData;
import io.opentelemetry.sdk.trace.export.SpanExporter;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

/** Resolve on the SDK export worker, never the Flink processing/checkpoint thread. */
final class RunContextExporter implements SpanExporter {
  static final AttributeKey<String> RUN = AttributeKey.stringKey("run_id");
  private static final ObjectMapper JSON = new ObjectMapper();
  private final SpanExporter delegate;
  private final URI endpoint;
  private final String engineJobId;
  private final long waitMillis, retryMillis;
  private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2))
      .followRedirects(HttpClient.Redirect.NEVER).build();

  RunContextExporter(SpanExporter delegate, String endpoint, String engineJobId) {
    this(delegate, endpoint, engineJobId, 25_000, 2_000);
  }

  RunContextExporter(SpanExporter delegate, String endpoint, String engineJobId, long waitMillis, long retryMillis) {
    this.delegate = delegate;
    this.endpoint = URI.create(endpoint);
    if (!List.of("http", "https").contains(this.endpoint.getScheme()) || this.endpoint.getHost() == null
        || this.endpoint.getUserInfo() != null || this.endpoint.getQuery() != null || this.endpoint.getFragment() != null
        || !this.endpoint.getPath().equals("/api/report") || !engineJobId.matches("[a-f0-9]{32}"))
      throw new IllegalArgumentException("invalid_run_context_configuration");
    this.engineJobId = engineJobId;
    this.waitMillis = waitMillis;
    this.retryMillis = retryMillis;
  }

  @Override public CompletableResultCode export(Collection<SpanData> spans) {
    List<SpanData> input = List.copyOf(spans);
    long deadline = System.nanoTime() + Duration.ofMillis(waitMillis).toNanos();
    List<SpanData> output = input.stream().map(s -> tagged(s, null)).toList();
    do {
      try {
        var request = HttpRequest.newBuilder(endpoint).timeout(Duration.ofSeconds(2)).GET().build();
        var response = http.send(request, HttpResponse.BodyHandlers.ofByteArray());
        if (response.statusCode() == 200 && response.body().length <= 1_048_576) {
          JsonNode jobs = JSON.readTree(response.body()).path("jobs");
          output = input.stream().map(s -> tagged(s, match(jobs, engineJobId, s))).toList();
          if (output.stream().allMatch(s -> s.getAttributes().get(RUN) != null)) break;
        }
      } catch (InterruptedException interrupted) {
        Thread.currentThread().interrupt();
        break;
      } catch (Exception unavailable) {
        // No URL, report payload or exception message is exported/logged.
      }
      if (System.nanoTime() >= deadline) break;
      try { Thread.sleep(Math.min(retryMillis, Math.max(1, (deadline - System.nanoTime()) / 1_000_000))); }
      catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); break; }
    } while (System.nanoTime() < deadline);
    return delegate.export(output);
  }

  static String match(JsonNode jobs, String engineJobId, SpanData span) {
    String found = null;
    for (JsonNode job : jobs) {
      if (!job.path("job_name").asText().equals("vehicle_clean_and_detect")
          || !job.path("metadata").path("jobId").asText().equals(engineJobId)) continue;
      try {
        long start = Instant.parse(job.path("started_at").asText()).toEpochMilli();
        long observed = Instant.parse(job.path("updated_at").asText()).toEpochMilli();
        long end = job.path("finished_at").isNull() || job.path("finished_at").isMissingNode()
            ? observed : Instant.parse(job.path("finished_at").asText()).toEpochMilli();
        if (start <= span.getStartEpochNanos() / 1_000_000 && span.getEndEpochNanos() / 1_000_000 < end
            && end <= observed) {
          String id = UUID.fromString(job.path("run_id").asText()).toString();
          if (found != null) return null; // Ambiguous evidence must never pick a Run.
          found = id;
        }
      } catch (IllegalArgumentException | java.time.DateTimeException invalid) { /* Invalid evidence remains unknown. */ }
    }
    return found;
  }

  static SpanData tagged(SpanData span, String runId) {
    var builder = span.getAttributes().toBuilder()
        .put("run_correlation", runId == null ? "unknown" : "observed_interval");
    builder.remove(RUN);
    if (runId != null) builder.put(RUN, runId);
    Attributes attributes = builder.build();
    return new DelegatingSpanData(span) {
      @Override public Attributes getAttributes() { return attributes; }
      @Override public int getTotalAttributeCount() {
        return span.getTotalAttributeCount() + attributes.size() - span.getAttributes().size();
      }
    };
  }

  @Override public CompletableResultCode flush() { return delegate.flush(); }
  @Override public CompletableResultCode shutdown() { return delegate.shutdown(); }
}
