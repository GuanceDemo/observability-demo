package demo.order;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.cert.Certificate;
import java.security.cert.CertificateFactory;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;

interface BackendLogReader {
  List<BackendLogItem> recentMatchingLogLines(List<String> needles, int limit);
}

record BackendLogItem(
    String source, String service, String pod, String message, Instant timestamp) {
  private static final Pattern TRACE_ID = Pattern.compile("\\btrace_id=([0-9A-Fa-f]+)\\b");

  static boolean isTraceLookupMessage(String value) {
    String line = value == null ? "" : value;
    return line.contains("路径=/api/demo/logs") || line.contains("path=/api/demo/logs");
  }

  boolean isTraceLookupRequest() {
    return isTraceLookupMessage(message);
  }

  Map<String, Object> toMap() {
    Map<String, Object> item = new LinkedHashMap<>();
    item.put("source", source);
    item.put("service", service);
    item.put("pod", pod);
    item.put("message", message);
    String traceId = traceId();
    if (traceId != null && !traceId.isBlank()) {
      item.put("traceId", traceId);
    }
    if (timestamp != null) {
      item.put("timestamp", timestamp.toString());
    }
    return item;
  }

  String traceId() {
    Matcher matcher = TRACE_ID.matcher(message == null ? "" : message);
    return matcher.find() ? matcher.group(1) : "";
  }

  String displayLine() {
    return source + ": " + message;
  }
}

class CompositeBackendLogReader implements BackendLogReader {
  private final List<BackendLogReader> readers;

  CompositeBackendLogReader(BackendLogReader... readers) {
    this.readers = List.of(readers);
  }

  @Override
  public List<BackendLogItem> recentMatchingLogLines(List<String> needles, int limit) {
    List<BackendLogItem> matches = new ArrayList<>();
    for (BackendLogReader reader : readers) {
      matches.addAll(reader.recentMatchingLogLines(needles, limit));
    }
    matches.removeIf(BackendLogItem::isTraceLookupRequest);
    matches.sort(
        Comparator.comparing(
            BackendLogItem::timestamp, Comparator.nullsLast(Comparator.naturalOrder())));
    int fromIndex = Math.max(0, matches.size() - limit);
    return matches.subList(fromIndex, matches.size());
  }
}

class FileBackendLogReader implements BackendLogReader {
  private static final Pattern LOG_TIMESTAMP =
      Pattern.compile(
          "^(\\d{4}-\\d{2}-\\d{2}T[^\\s]+|\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}[.,]\\d{3})");

  private final String logDirectory;

  FileBackendLogReader(String logDirectory) {
    this.logDirectory = logDirectory;
  }

  @Override
  public List<BackendLogItem> recentMatchingLogLines(List<String> needles, int limit) {
    List<String> matches = new ArrayList<>();
    for (Path logFile : logFiles()) {
      if (!Files.isRegularFile(logFile)) {
        continue;
      }
      try (Stream<String> lines = Files.lines(logFile, StandardCharsets.UTF_8)) {
        String source = logFile.getFileName().toString();
        String service = source.replace(".log", "");
        lines
            .filter(line -> containsAny(line, needles))
            .filter(line -> !BackendLogItem.isTraceLookupMessage(line))
            .forEach(
                line -> {
                  matches.add(
                      new BackendLogItem(source, service, "", line, parseTimestamp(line))
                          .displayLine());
                  int maxBuffered = limit * 4;
                  if (matches.size() > maxBuffered) {
                    matches.remove(0);
                  }
                });
      } catch (RuntimeException | java.io.IOException ignored) {
        // Log display is best-effort and must not affect the demo control APIs.
      }
    }
    int fromIndex = Math.max(0, matches.size() - limit);
    return matches.subList(fromIndex, matches.size()).stream().map(this::toItem).toList();
  }

  private List<Path> logFiles() {
    Path base = Path.of(logDirectory);
    return List.of(
        base.resolve("gateway-service.log"),
        base.resolve("order-service.log"),
        base.resolve("inventory-service.log"),
        base.resolve("payment-service.log"));
  }

  private BackendLogItem toItem(String displayLine) {
    int separator = displayLine.indexOf(": ");
    if (separator <= 0) {
      return new BackendLogItem("local-file", "", "", displayLine, null);
    }
    String source = displayLine.substring(0, separator);
    String message = displayLine.substring(separator + 2);
    return new BackendLogItem(
        source, source.replace(".log", ""), "", message, parseTimestamp(message));
  }

  private Instant parseTimestamp(String line) {
    Matcher matcher = LOG_TIMESTAMP.matcher(line);
    if (!matcher.find()) {
      return null;
    }
    String value = matcher.group(1).replace(' ', 'T').replace(',', '.');
    if (!value.endsWith("Z")) {
      value = value + "Z";
    }
    try {
      return Instant.parse(value);
    } catch (RuntimeException ignored) {
      return null;
    }
  }

  private boolean containsAny(String line, List<String> needles) {
    for (String needle : needles) {
      if (line.contains(needle)) {
        return true;
      }
    }
    return false;
  }
}

class KubernetesBackendLogReader implements BackendLogReader {
  private static final List<String> SERVICES =
      List.of("gateway-service", "order-service", "inventory-service", "payment-service");
  private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();
  private static final Path SERVICE_ACCOUNT_DIR =
      Path.of("/var/run/secrets/kubernetes.io/serviceaccount");

  private final boolean enabled;
  private final int tailLines;
  private final int sinceSeconds;
  private final String namespace;
  private final String token;
  private final String apiServer;
  private final HttpClient httpClient;

  KubernetesBackendLogReader(boolean enabled, int tailLines, int sinceSeconds) {
    this.enabled = enabled;
    this.tailLines = Math.max(40, Math.min(tailLines, 800));
    this.sinceSeconds = Math.max(60, Math.min(sinceSeconds, 3600));
    this.namespace = readNamespace();
    this.token = readServiceAccountToken();
    this.apiServer =
        System.getenv().getOrDefault("KUBERNETES_SERVICE_HOST", "kubernetes.default.svc");
    this.httpClient = buildHttpClient();
  }

  @Override
  public List<BackendLogItem> recentMatchingLogLines(List<String> needles, int limit) {
    if (!isAvailable()) {
      return List.of();
    }

    List<BackendLogItem> matches = new ArrayList<>();
    for (String service : SERVICES) {
      for (String pod : podsForService(service)) {
        matches.addAll(matchingPodLogs(service, pod, needles));
      }
    }
    matches.sort(
        Comparator.comparing(
            BackendLogItem::timestamp, Comparator.nullsLast(Comparator.naturalOrder())));
    int fromIndex = Math.max(0, matches.size() - limit);
    return matches.subList(fromIndex, matches.size());
  }

  private boolean isAvailable() {
    return enabled
        && namespace != null
        && !namespace.isBlank()
        && token != null
        && !token.isBlank()
        && httpClient != null;
  }

  private List<String> podsForService(String service) {
    String selector = urlEncode("app.kubernetes.io/component=" + service);
    String path = "/api/v1/namespaces/" + urlEncode(namespace) + "/pods?labelSelector=" + selector;
    try {
      String body = get(path);
      JsonNode items = OBJECT_MAPPER.readTree(body).path("items");
      List<String> pods = new ArrayList<>();
      if (items.isArray()) {
        for (JsonNode item : items) {
          String pod = item.path("metadata").path("name").asText("");
          String phase = item.path("status").path("phase").asText("");
          if (!pod.isBlank() && !"Succeeded".equals(phase) && !"Failed".equals(phase)) {
            pods.add(pod);
          }
        }
      }
      return pods;
    } catch (RuntimeException | java.io.IOException ignored) {
      return List.of();
    }
  }

  private List<BackendLogItem> matchingPodLogs(String service, String pod, List<String> needles) {
    String path =
        "/api/v1/namespaces/"
            + urlEncode(namespace)
            + "/pods/"
            + urlEncode(pod)
            + "/log?container="
            + urlEncode(service)
            + "&tailLines="
            + tailLines
            + "&sinceSeconds="
            + sinceSeconds
            + "&timestamps=true";
    try {
      String body = get(path);
      List<BackendLogItem> matches = new ArrayList<>();
      for (String rawLine : body.split("\\R")) {
        String line = rawLine.strip();
        if (!line.isEmpty()
            && containsAny(line, needles)
            && !BackendLogItem.isTraceLookupMessage(line)) {
          ParsedLogLine parsed = ParsedLogLine.from(line);
          matches.add(
              new BackendLogItem(
                  service + "/" + pod, service, pod, parsed.message(), parsed.timestamp()));
        }
      }
      return matches;
    } catch (RuntimeException ignored) {
      return List.of();
    }
  }

  private String get(String pathAndQuery) {
    try {
      HttpRequest request =
          HttpRequest.newBuilder(apiUri(pathAndQuery))
              .timeout(Duration.ofSeconds(4))
              .header("Authorization", "Bearer " + token)
              .header("Accept", "application/json")
              .GET()
              .build();
      HttpResponse<String> response =
          httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
      if (response.statusCode() < 200 || response.statusCode() >= 300) {
        throw new IllegalStateException("Kubernetes API returned HTTP " + response.statusCode());
      }
      return response.body();
    } catch (java.io.IOException exception) {
      throw new IllegalStateException(exception);
    } catch (InterruptedException exception) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException(exception);
    }
  }

  private URI apiUri(String pathAndQuery) {
    String host = apiServer.startsWith("http") ? apiServer : "https://" + apiServer;
    String port = System.getenv("KUBERNETES_SERVICE_PORT_HTTPS");
    if (port == null || port.isBlank()) {
      port = System.getenv("KUBERNETES_SERVICE_PORT");
    }
    if (!apiServer.startsWith("http") && port != null && !port.isBlank()) {
      host = host + ":" + port;
    }
    return URI.create(host + pathAndQuery);
  }

  private HttpClient buildHttpClient() {
    try {
      Path caPath = SERVICE_ACCOUNT_DIR.resolve("ca.crt");
      if (!Files.isReadable(caPath)) {
        return HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
      }
      CertificateFactory certificateFactory = CertificateFactory.getInstance("X.509");
      Certificate certificate;
      try (java.io.InputStream input = Files.newInputStream(caPath)) {
        certificate = certificateFactory.generateCertificate(input);
      }
      KeyStore keyStore = KeyStore.getInstance(KeyStore.getDefaultType());
      keyStore.load(null, null);
      keyStore.setCertificateEntry("kubernetes-ca", certificate);
      TrustManagerFactory trustManagerFactory =
          TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
      trustManagerFactory.init(keyStore);
      SSLContext sslContext = SSLContext.getInstance("TLS");
      sslContext.init(null, trustManagerFactory.getTrustManagers(), null);
      return HttpClient.newBuilder()
          .sslContext(sslContext)
          .connectTimeout(Duration.ofSeconds(2))
          .build();
    } catch (Exception ignored) {
      return HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
    }
  }

  private String readNamespace() {
    String namespaceFromEnv = System.getenv("KUBERNETES_NAMESPACE");
    if (namespaceFromEnv != null && !namespaceFromEnv.isBlank()) {
      return namespaceFromEnv.trim();
    }
    Path namespacePath = SERVICE_ACCOUNT_DIR.resolve("namespace");
    try {
      return Files.readString(namespacePath, StandardCharsets.UTF_8).trim();
    } catch (java.io.IOException ignored) {
      return "";
    }
  }

  private String readServiceAccountToken() {
    try {
      return Files.readString(SERVICE_ACCOUNT_DIR.resolve("token"), StandardCharsets.UTF_8).trim();
    } catch (java.io.IOException ignored) {
      return "";
    }
  }

  private boolean containsAny(String line, List<String> needles) {
    for (String needle : needles) {
      if (line.contains(needle)) {
        return true;
      }
    }
    return false;
  }

  private String urlEncode(String value) {
    return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
  }
}

record ParsedLogLine(Instant timestamp, String message) {
  static ParsedLogLine from(String line) {
    int firstSpace = line.indexOf(' ');
    if (firstSpace > 0) {
      String possibleTimestamp = line.substring(0, firstSpace);
      try {
        return new ParsedLogLine(Instant.parse(possibleTimestamp), line.substring(firstSpace + 1));
      } catch (RuntimeException ignored) {
        // The line did not start with a Kubernetes timestamp.
      }
    }
    return new ParsedLogLine(null, line);
  }
}
