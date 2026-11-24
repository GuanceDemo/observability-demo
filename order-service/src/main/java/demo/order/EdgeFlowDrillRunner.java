package demo.order;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.LongSupplier;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * Sends a bounded 125-request EdgeFlow tail-sampling contrast batch to {@code gateway-service}
 * over raw {@link Socket} HTTP/1.1 so {@code dd-java-agent} never propagates the control request's
 * parent trace context. Every request enters {@code gateway-service} as an independent root trace.
 */
final class EdgeFlowDrillRunner {
  static final int SCANNER_PROBE_COUNT = 20;
  static final int HEALTHY_ORDER_COUNT = 100;
  static final int PAYMENT_ERROR_ORDER_COUNT = 5;
  static final int BUSINESS_ORDER_TOTAL = HEALTHY_ORDER_COUNT + PAYMENT_ERROR_ORDER_COUNT;
  static final int TOTAL_REQUEST_COUNT = SCANNER_PROBE_COUNT + BUSINESS_ORDER_TOTAL;

  private static final int CONNECT_TIMEOUT_MS = 3000;
  private static final int READ_TIMEOUT_MS = 8000;
  private static final int WORKER_CONCURRENCY = 4;

  private final AtomicBoolean running = new AtomicBoolean(false);
  private final LongSupplier clockMillis;

  EdgeFlowDrillRunner() {
    this(System::currentTimeMillis);
  }

  EdgeFlowDrillRunner(LongSupplier clockMillis) {
    this.clockMillis = clockMillis;
  }

  Map<String, Object> execute(
      String gatewayBaseUrl,
      String languageCode,
      Runnable clearBackendFaults,
      Runnable enablePaymentErrorFault) {
    if (!running.compareAndSet(false, true)) {
      throw new ResponseStatusException(
          HttpStatus.CONFLICT, "EdgeFlow tail-sampling drill is already running");
    }
    try {
      Endpoint endpoint = parseHttpEndpoint(gatewayBaseUrl);
      String lang = (languageCode == null || languageCode.isBlank()) ? "zh" : languageCode.trim();
      long startedAtMs = clockMillis.getAsLong();
      String batchSuffix =
          Long.toHexString(startedAtMs / 1000L)
              + "-"
              + UUID.randomUUID().toString().replace("-", "").substring(0, 6);
      String batchId = "ef-" + batchSuffix;
      String traceQuery = "key_request:" + batchId;

      clearBackendFaults.run();

      int scannerRejected404Count = 0;
      int scannerSuccessCount = 0;
      for (int index = 1; index <= SCANNER_PROBE_COUNT; index += 1) {
        String path = String.format(Locale.ROOT, "/edgeflow-probe/unmatched-%02d", index);
        String bizId = String.format(Locale.ROOT, "biz-%s-scan-%02d", batchId, index);
        int status = sendRawGet(endpoint, path, batchId, bizId, lang);
        if (status == 404) {
          scannerRejected404Count += 1;
        } else if (status >= 200 && status < 300) {
          scannerSuccessCount += 1;
        }
      }

      int healthySuccessCount = 0;
      ExecutorService pool = Executors.newFixedThreadPool(WORKER_CONCURRENCY);
      try {
        List<Callable<Integer>> healthyTasks = new ArrayList<>(HEALTHY_ORDER_COUNT);
        for (int index = 1; index <= HEALTHY_ORDER_COUNT; index += 1) {
          final int seq = index;
          healthyTasks.add(
              () -> {
                String bizId = String.format(Locale.ROOT, "biz-%s-ok-%03d", batchId, seq);
                return sendRawGet(endpoint, "/api/orders/demo", batchId, bizId, lang);
              });
        }
        for (Future<Integer> future : pool.invokeAll(healthyTasks)) {
          int status = awaitStatus(future);
          if (status >= 200 && status < 300) {
            healthySuccessCount += 1;
          }
        }
      } catch (InterruptedException interrupted) {
        Thread.currentThread().interrupt();
        throw new ResponseStatusException(
            HttpStatus.INTERNAL_SERVER_ERROR, "EdgeFlow drill interrupted", interrupted);
      } finally {
        pool.shutdownNow();
      }

      int paymentError5xxCount = 0;
      boolean faultsRestored = false;
      try {
        enablePaymentErrorFault.run();
        for (int index = 1; index <= PAYMENT_ERROR_ORDER_COUNT; index += 1) {
          String bizId = String.format(Locale.ROOT, "biz-%s-err-%02d", batchId, index);
          int status = sendRawGet(endpoint, "/api/orders/demo", batchId, bizId, lang);
          if (status >= 500) {
            paymentError5xxCount += 1;
          }
        }
      } finally {
        clearBackendFaults.run();
        faultsRestored = true;
      }

      long completedAtMs = Math.max(startedAtMs, clockMillis.getAsLong());
      long windowStartSec = (startedAtMs / 1000L) - 5L;
      long windowEndSec = ((completedAtMs + 999L) / 1000L) + 35L;

      Map<String, Object> response = new LinkedHashMap<>();
      response.put("status", "COMPLETED");
      response.put("timestamp", Instant.ofEpochMilli(completedAtMs).toString());
      response.put("batchId", batchId);
      response.put("keyRequest", batchId);
      response.put("traceQuery", traceQuery);
      response.put("serviceName", "order-service");
      response.put("scannerProbeCount", SCANNER_PROBE_COUNT);
      response.put("scannerRejected404Count", scannerRejected404Count);
      response.put("scannerSuccessCount", scannerSuccessCount);
      response.put("healthyOrderCount", HEALTHY_ORDER_COUNT);
      response.put("healthySuccessCount", healthySuccessCount);
      response.put("paymentErrorOrderCount", PAYMENT_ERROR_ORDER_COUNT);
      response.put("paymentError5xxCount", paymentError5xxCount);
      response.put("businessOrderTotal", BUSINESS_ORDER_TOTAL);
      response.put("totalRequests", TOTAL_REQUEST_COUNT);
      response.put("expectedKeptScannerTraces", 0);
      response.put("expectedSampledHealthyApprox", 10);
      response.put("expectedKeptErrorTraces", PAYMENT_ERROR_ORDER_COUNT);
      response.put("windowStartSec", windowStartSec);
      response.put("windowEndSec", windowEndSec);
      response.put("durationMs", completedAtMs - startedAtMs);
      response.put("faultsRestored", faultsRestored);
      return response;
    } finally {
      running.set(false);
    }
  }

  private static int awaitStatus(Future<Integer> future) {
    try {
      return future.get();
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
      return 0;
    } catch (ExecutionException exception) {
      return 0;
    }
  }

  private static int sendRawGet(
      Endpoint endpoint, String path, String keyRequest, String bizRequestId, String language) {
    String requestText =
        "GET "
            + path
            + " HTTP/1.1\r\n"
            + "Host: "
            + endpoint.hostHeader()
            + "\r\n"
            + "Connection: close\r\n"
            + "Accept: application/json\r\n"
            + "User-Agent: edgeflow-contrast-drill/1.0\r\n"
            + "X-Demo-Language: "
            + sanitizeHeaderValue(language)
            + "\r\n"
            + "X-Key-Request: "
            + sanitizeHeaderValue(keyRequest)
            + "\r\n"
            + "X-Business-Request-Id: "
            + sanitizeHeaderValue(bizRequestId)
            + "\r\n\r\n";

    try (Socket socket = new Socket()) {
      socket.connect(new InetSocketAddress(endpoint.host(), endpoint.port()), CONNECT_TIMEOUT_MS);
      socket.setSoTimeout(READ_TIMEOUT_MS);
      OutputStream out = socket.getOutputStream();
      out.write(requestText.getBytes(StandardCharsets.US_ASCII));
      out.flush();

      InputStream in = socket.getInputStream();
      BufferedReader reader =
          new BufferedReader(new InputStreamReader(in, StandardCharsets.ISO_8859_1));
      String statusLine = reader.readLine();
      int statusCode = parseStatusCode(statusLine);
      char[] drainBuffer = new char[1024];
      while (reader.read(drainBuffer) != -1) {
        // Drain response so the peer closes cleanly without TCP RST.
      }
      return statusCode;
    } catch (IOException exception) {
      return 0;
    }
  }

  private static int parseStatusCode(String statusLine) {
    if (statusLine == null || !statusLine.startsWith("HTTP/1.")) {
      return 0;
    }
    String[] parts = statusLine.split(" ");
    if (parts.length < 2) {
      return 0;
    }
    try {
      return Integer.parseInt(parts[1].trim());
    } catch (NumberFormatException ignored) {
      return 0;
    }
  }

  private static String sanitizeHeaderValue(String value) {
    return value == null ? "-" : value.replaceAll("[\\r\\n]", "");
  }

  private static Endpoint parseHttpEndpoint(String rawUrl) {
    String candidate =
        (rawUrl == null || rawUrl.isBlank()) ? "http://127.0.0.1:8080" : rawUrl.trim();
    URI uri = URI.create(candidate);
    if (!"http".equalsIgnoreCase(uri.getScheme())
        || uri.getHost() == null
        || uri.getHost().isBlank()) {
      throw new ResponseStatusException(
          HttpStatus.INTERNAL_SERVER_ERROR, "demo.gateway-url must be an internal http:// URL");
    }
    int port = uri.getPort() > 0 ? uri.getPort() : 80;
    String hostHeader = (port == 80) ? uri.getHost() : (uri.getHost() + ":" + port);
    return new Endpoint(uri.getHost(), port, hostHeader);
  }

  private record Endpoint(String host, int port, String hostHeader) {}
}
