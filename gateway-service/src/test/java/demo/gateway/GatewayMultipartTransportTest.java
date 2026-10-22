package demo.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/** Use real Tomcat: MockHttpServletRequest does not consume multipart input during parsing. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class GatewayMultipartTransportTest {
  private static final LinkedBlockingQueue<ForwardedRequest> FORWARDED =
      new LinkedBlockingQueue<>();
  private static final HttpServer DOWNSTREAM = startDownstream();
  @LocalServerPort private int port;

  @DynamicPropertySource
  static void downstreamUrl(DynamicPropertyRegistry registry) {
    registry.add("gateway.order-url", () -> "http://127.0.0.1:" + DOWNSTREAM.getAddress().getPort());
  }

  private static HttpServer startDownstream() {
    try {
      HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
      server.createContext("/", exchange -> {
        FORWARDED.add(new ForwardedRequest(exchange.getRequestMethod(),
            exchange.getRequestURI().toString(), exchange.getRequestHeaders().getFirst("Content-Type"),
            exchange.getRequestBody().readAllBytes()));
        exchange.sendResponseHeaders(200, -1);
        exchange.close();
      });
      server.start();
      return server;
    } catch (IOException exception) {
      throw new IllegalStateException("Cannot start test downstream", exception);
    }
  }

  @AfterAll
  static void stopDownstream() {
    DOWNSTREAM.stop(0);
  }

  @ParameterizedTest
  @CsvSource({
      "POST, /rum-proxy/v1/write/rum/replay",
      "PUT, /rum-proxy/v1/write/rum/replay",
      "POST, /rum-proxy/v1/write/rum/replay_assets"
  })
  void preservesMultipartMetadataAndBinarySegment(String method, String path) throws Exception {
    String boundary = "replay-boundary-transport-check";
    byte[] body = ("--" + boundary + "\r\n"
        + "Content-Disposition: form-data; name=\"event\"\r\n\r\n"
        + "{\"application\":{\"id\":\"transport-test\"}}\r\n"
        + "--" + boundary + "\r\n"
        + "Content-Disposition: form-data; name=\"segment\"; filename=\"segment\"\r\n"
        + "Content-Type: application/octet-stream\r\n\r\n"
        + "\u0000\u00ff\u008b\u001fBINARY\r\n"
        + "--" + boundary + "--\r\n").getBytes(StandardCharsets.ISO_8859_1);
    assertForwarded(method, path + "?precision=ms", "multipart/form-data; boundary=" + boundary, body);
  }

  @Test
  void preservesJsonBody() throws Exception {
    assertForwarded("POST", "/rum-proxy/v1/write/rum?precision=ms", "application/json",
        "{\"value\":\"中文\"}".getBytes(StandardCharsets.UTF_8));
  }

  private void assertForwarded(String method, String path, String contentType, byte[] body)
      throws Exception {
    HttpRequest request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
        .timeout(Duration.ofSeconds(10)).header("Content-Type", contentType)
        .method(method, HttpRequest.BodyPublishers.ofByteArray(body)).build();
    HttpResponse<Void> response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.discarding());
    assertThat(response.statusCode()).isEqualTo(200);
    ForwardedRequest forwarded = FORWARDED.poll(5, TimeUnit.SECONDS);
    assertThat(forwarded).isNotNull();
    assertThat(forwarded.method()).isEqualTo(method);
    assertThat(forwarded.path()).isEqualTo(path);
    assertThat(forwarded.contentType()).isEqualTo(contentType);
    assertThat(forwarded.body()).containsExactly(body);
  }

  private record ForwardedRequest(String method, String path, String contentType, byte[] body) {}
}
