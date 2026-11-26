package demo.order;

import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.LongSupplier;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

final class FlowPortsDrillRunner {
  static final int HEALTHCHECK_NOISE_COUNT = 20;
  static final int STAGING_ORDER_COUNT = 10;
  static final int PROD_HIGH_RISK_COUNT = 5;
  static final int TOTAL_MESSAGE_COUNT =
      HEALTHCHECK_NOISE_COUNT + STAGING_ORDER_COUNT + PROD_HIGH_RISK_COUNT;

  private static final int CONNECT_TIMEOUT_MS = 3000;

  private final AtomicBoolean running = new AtomicBoolean();
  private final LongSupplier clockMillis;

  FlowPortsDrillRunner() {
    this(System::currentTimeMillis);
  }

  FlowPortsDrillRunner(LongSupplier clockMillis) {
    this.clockMillis = clockMillis;
  }

  Summary execute(String host, int port, String protocol, String uiUrl, FlowPortsSinkStore sinks) {
    lock();
    try {
      String transport = protocol.trim().toLowerCase(Locale.ROOT);
      if (host.isBlank() || port < 1 || port > 65535
          || (!transport.equals("udp") && !transport.equals("tcp"))) {
        throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Invalid FlowPorts socket configuration");
      }

      long startedAtMs = clockMillis.getAsLong();
      String verifyId = "fp-" + Long.toHexString(startedAtMs / 1000L) + "-"
          + UUID.randomUUID().toString().substring(0, 6);
      List<String> messages = buildMessages(verifyId);
      InetSocketAddress target = new InetSocketAddress(InetAddress.getByName(host), port);
      sinks.startDrill(verifyId);
      if (transport.equals("udp")) {
        sendUdp(target, messages);
      } else {
        sendTcp(target, messages);
      }

      long completedAtMs = Math.max(startedAtMs, clockMillis.getAsLong());
      return new Summary(
          verifyId, "verify_id:" + verifyId, TOTAL_MESSAGE_COUNT, HEALTHCHECK_NOISE_COUNT,
          STAGING_ORDER_COUNT, PROD_HIGH_RISK_COUNT, messages.size(), host + ":" + port, transport,
          startedAtMs / 1000L - 5, (completedAtMs + 999L) / 1000L + 60,
          uiUrl, sinks.isDownstreamDown());
    } catch (IOException exception) {
      throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Could not send FlowPorts socket batch", exception);
    } finally {
      running.set(false);
    }
  }

  FlowPortsSinkStore.Snapshot reset(FlowPortsSinkStore sinks) {
    lock();
    try {
      return sinks.reset();
    } finally {
      running.set(false);
    }
  }

  private void lock() {
    if (!running.compareAndSet(false, true)) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "FlowPorts drill is already running");
    }
  }

  private static List<String> buildMessages(String verifyId) {
    List<String> messages = new ArrayList<>(TOTAL_MESSAGE_COUNT);
    for (int i = 1; i <= HEALTHCHECK_NOISE_COUNT; i++) {
      messages.add(cef(
          "100", "Health Check", 0, "ops-bot-01", "Platform Operations", "Readiness probe returned OK",
          verifyId, "production", "low", "ops-bot", "healthcheck", i));
    }
    for (int i = 1; i <= STAGING_ORDER_COUNT; i++) {
      messages.add(cef(
          "200", "Order Submitted", 3, "mall-staging-01", "Order Processing", "Book order submitted successfully",
          verifyId, "staging", "low", "std-001", "order", i));
    }
    for (int i = 1; i <= PROD_HIGH_RISK_COUNT; i++) {
      messages.add(cef(
          "300", "Risky Checkout", 8, "mall-prod-01", "Fraud Detection", "Checkout triggered a high risk rule",
          verifyId, "production", "high", i % 2 == 1 ? "vip-001" : "vip-002", "checkout_risk", i)
          + " phone=13800138000");
    }
    return messages;
  }

  private static String cef(
      String eventId, String eventName, int severity, String shost, String facility, String message,
      String verifyId, String env, String risk, String userId, String eventType, int sequence) {
    return "CEF:0|MallGateway|WAF|2.0|" + eventId + "|" + eventName + "|" + severity
        + "|shost=" + shost + " cs2=192.0.2." + sequence + " deviceFacility=" + facility
        + " msg=" + message + " verify_id=" + verifyId + " env=" + env + " risk_level=" + risk
        + " user_id=" + userId + " event_type=" + eventType;
  }

  private static void sendUdp(InetSocketAddress target, List<String> messages) throws IOException {
    try (DatagramSocket socket = new DatagramSocket()) {
      for (String message : messages) {
        byte[] data = (message + "\n").getBytes(StandardCharsets.UTF_8);
        socket.send(new DatagramPacket(data, data.length, target));
      }
    }
  }

  private static void sendTcp(InetSocketAddress target, List<String> messages) throws IOException {
    try (Socket socket = new Socket()) {
      socket.connect(target, CONNECT_TIMEOUT_MS);
      socket.getOutputStream().write((String.join("\n", messages) + "\n").getBytes(StandardCharsets.UTF_8));
    }
  }

  record Summary(
      String verifyId,
      String logQuery,
      int totalMessages,
      int healthcheckNoiseCount,
      int stagingOrderCount,
      int prodHighRiskCount,
      int sentCount,
      String socketTarget,
      String protocol,
      long windowStartSec,
      long windowEndSec,
      String flowportsUiUrl,
      boolean downstreamDown) {}
}
