package demo.reports;

import com.sun.net.httpserver.HttpServer;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class HttpSinkTest {
  @Test void retriesSamePayloadAndUsesXTokenThenAcceptsCached() throws Exception {
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    List<String> bodies = new ArrayList<>(); List<String> tokens = new ArrayList<>(); AtomicInteger calls = new AtomicInteger();
    server.createContext("/v1/write/openlineage", exchange -> {
      bodies.add(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
      tokens.add(exchange.getRequestHeaders().getFirst("X-Token"));
      byte[] reply = "{\"error_code\":\"dataway.cached\"}".getBytes(StandardCharsets.UTF_8);
      exchange.getResponseHeaders().add("Retry-After", "0");
      exchange.sendResponseHeaders(calls.incrementAndGet() == 1 ? 429 : 200, reply.length);
      exchange.getResponseBody().write(reply); exchange.close();
    });
    server.start();
    try {
      Settings base = LineageTest.settings(3306);
      Settings s = new Settings(base.host(), base.port(), base.user(), base.password(),
          URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/v1/write/openlineage"),
          base.token(), base.jobNamespace(), base.datasetNamespace());
      new HttpSink(s).send("{\"runId\":\"same-id\"}");
      assertEquals(List.of("fixture-token", "fixture-token"), tokens);
      assertEquals(2, bodies.size()); assertEquals(bodies.get(0), bodies.get(1));
      server.removeContext("/v1/write/openlineage");
      server.createContext("/v1/write/openlineage", exchange -> {
        byte[] reply = "sensitive-response".getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(401, reply.length); exchange.getResponseBody().write(reply); exchange.close();
      });
      var failure = assertThrows(ReportWorker.DeliveryException.class, () -> new HttpSink(s).send("{}"));
      assertEquals("http_401", failure.getMessage());
    } finally { server.stop(0); }
  }
}
