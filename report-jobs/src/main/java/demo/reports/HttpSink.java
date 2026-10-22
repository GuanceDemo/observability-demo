package demo.reports;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.time.format.DateTimeFormatter;

final class HttpSink implements ReportWorker.Sink {
  private final Settings settings;
  private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5))
      .followRedirects(HttpClient.Redirect.NEVER).build();
  private final ObjectMapper mapper = new ObjectMapper();
  HttpSink(Settings settings) { this.settings = settings; }
  @Override public void send(String payload) throws ReportWorker.DeliveryException {
    String code = "network_error";
    for (int attempt = 0; attempt < 3; attempt++) {
      String retry = null;
      try {
        HttpRequest request = HttpRequest.newBuilder(settings.lineageUrl()).timeout(Duration.ofSeconds(10))
            .header("X-Token", settings.token()).header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(payload, StandardCharsets.UTF_8)).build();
        HttpResponse<java.io.InputStream> response = client.send(request, HttpResponse.BodyHandlers.ofInputStream());
        String body;
        try (var stream = response.body()) { body = new String(stream.readNBytes(65536), StandardCharsets.UTF_8); }
        int status = response.statusCode();
        if (status >= 200 && status < 300) {
          String error = "";
          try { var json = mapper.readTree(body); if (json != null) error = json.path("error_code").asText(""); }
          catch (IOException ignored) { /* An empty successful response is allowed. */ }
          if (!error.isEmpty() && !error.equals("dataway.cached")) throw new ReportWorker.DeliveryException("ingestion_rejected");
          return;
        }
        code = "http_" + status;
        if (status != 429 && status < 500) throw new ReportWorker.DeliveryException(code);
        retry = response.headers().firstValue("Retry-After").orElse(null);
      } catch (IOException exception) { code = "network_error"; }
      catch (InterruptedException exception) {
        Thread.currentThread().interrupt(); throw new ReportWorker.DeliveryException("interrupted");
      }
      if (attempt < 2) {
        try { Thread.sleep(retryDelay(attempt, retry)); }
        catch (InterruptedException exception) {
          Thread.currentThread().interrupt(); throw new ReportWorker.DeliveryException("interrupted");
        }
      }
    }
    throw new ReportWorker.DeliveryException(code);
  }
  static long retryDelay(int attempt, String retry) {
    if (retry != null) {
      try { return Math.min(10000, Math.max(0, Long.parseLong(retry) * 1000)); }
      catch (NumberFormatException ignored) {
        try { return Math.min(10000, Math.max(0, Duration.between(Instant.now(),
            ZonedDateTime.parse(retry, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant()).toMillis())); }
        catch (java.time.DateTimeException alsoIgnored) { /* bounded exponential fallback */ }
      }
    }
    return (1L << attempt) * 1000;
  }
}
