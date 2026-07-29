package demo.gateway;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestTemplate;

class GatewayProxyFilterTest {
  @Test
  void rejectsUnknownPublicRoutesWithStableFallbackIdentity() throws Exception {
    RestTemplate restTemplate = new RestTemplate();
    MockHttpServletRequest request = new MockHttpServletRequest("GET", "/wp-admin/index.php");
    request.setRemoteAddr("198.51.100.20");
    request.addHeader("Host", "demo.example.com");
    request.addHeader("X-Demo-Language", "en");
    request.addHeader("X-Forwarded-For", "203.0.113.9");
    request.addHeader("User-Agent", "scanner|source=fake\nagent");
    request.addHeader("Referer", "https://scanner.example/probe?token=not-logged");
    MockHttpServletResponse response = new MockHttpServletResponse();
    Logger logger = (Logger) LoggerFactory.getLogger(GatewayProxyFilter.class);
    ListAppender<ILoggingEvent> appender = new ListAppender<>();
    appender.start();
    logger.addAppender(appender);

    try {
      new GatewayProxyFilter(restTemplate, "http://order-service.test")
          .doFilter(request, response, new MockFilterChain());
    } finally {
      logger.detachAppender(appender);
      appender.stop();
    }

    assertThat(response.getStatus()).isEqualTo(404);
    assertThat(response.getHeader("Cache-Control")).isEqualTo("no-store");
    assertThat(response.getHeader("X-Content-Type-Options")).isEqualTo("nosniff");
    assertThat(appender.list)
        .singleElement()
        .satisfies(
            event -> {
              assertThat(event.getFormattedMessage())
                  .contains("Gateway local response")
                  .contains("public_route=unmatched")
                  .contains("route_class=unmatched")
                  .contains("traffic_type=internet_probe")
                  .contains("client_ip=203.0.113.9")
                  .contains("peer_ip=198.51.100.20")
                  .contains("forwarded_for=203.0.113.9")
                  .contains("user_agent=scanner_source=fake agent")
                  .contains("referer=https://scanner.example/probe")
                  .doesNotContain("token=not-logged");
              assertThat(event.getMDCPropertyMap())
                  .containsEntry("public_route", "unmatched")
                  .containsEntry("route_class", "unmatched")
                  .containsEntry("traffic_type", "internet_probe")
                  .containsEntry("client_ip", "203.0.113.9")
                  .containsEntry("peer_ip", "198.51.100.20")
                  .containsEntry("user_agent", "scanner_source=fake agent")
                  .containsEntry("referer", "https://scanner.example/probe");
            });
    assertThat(MDC.get("route_class")).isNull();
    assertThat(MDC.get("client_ip")).isNull();
  }

  @Test
  void resolvesClientIpFromRealIpThenFallsBackToPeerIp() throws Exception {
    GatewayProxyFilter filter =
        new GatewayProxyFilter(new RestTemplate(), "http://order-service.test");
    Logger logger = (Logger) LoggerFactory.getLogger(GatewayProxyFilter.class);
    ListAppender<ILoggingEvent> appender = new ListAppender<>();
    appender.start();
    logger.addAppender(appender);

    try {
      MockHttpServletRequest realIpRequest =
          new MockHttpServletRequest("GET", "/unknown-from-proxy");
      realIpRequest.setRemoteAddr("10.0.0.8");
      realIpRequest.addHeader("X-Real-IP", "198.51.100.88");
      filter.doFilter(realIpRequest, new MockHttpServletResponse(), new MockFilterChain());

      MockHttpServletRequest peerIpRequest =
          new MockHttpServletRequest("GET", "/unknown-direct");
      peerIpRequest.setRemoteAddr("198.51.100.89");
      filter.doFilter(peerIpRequest, new MockHttpServletResponse(), new MockFilterChain());
    } finally {
      logger.detachAppender(appender);
      appender.stop();
    }

    assertThat(appender.list)
        .extracting(ILoggingEvent::getMDCPropertyMap)
        .anySatisfy(context -> assertThat(context).containsEntry("client_ip", "198.51.100.88"))
        .anySatisfy(context -> assertThat(context).containsEntry("client_ip", "198.51.100.89"));
  }

  @Test
  void servesRobotsAndFaviconWithoutCallingDownstream() throws Exception {
    GatewayProxyFilter filter =
        new GatewayProxyFilter(new RestTemplate(), "http://order-service.test");

    MockHttpServletResponse robotsResponse = new MockHttpServletResponse();
    filter.doFilter(
        new MockHttpServletRequest("GET", "/robots.txt"),
        robotsResponse,
        new MockFilterChain());

    assertThat(robotsResponse.getStatus()).isEqualTo(200);
    assertThat(robotsResponse.getContentType()).isEqualTo("text/plain;charset=UTF-8");
    assertThat(robotsResponse.getContentAsString())
        .isEqualTo("User-agent: *\nDisallow: /\n");
    assertThat(robotsResponse.getHeader("Cache-Control")).isEqualTo("public,max-age=3600");

    MockHttpServletResponse faviconResponse = new MockHttpServletResponse();
    filter.doFilter(
        new MockHttpServletRequest("GET", "/favicon.ico"),
        faviconResponse,
        new MockFilterChain());

    assertThat(faviconResponse.getStatus()).isEqualTo(204);
    assertThat(faviconResponse.getContentAsByteArray()).isEmpty();
    assertThat(faviconResponse.getHeader("Cache-Control")).isEqualTo("public,max-age=86400");
  }

  @Test
  void forwardsOrderRequestAndBusinessHeaders() throws Exception {
    RestTemplate restTemplate = new RestTemplate();
    restTemplate.setErrorHandler(new PassthroughResponseErrorHandler());
    MockRestServiceServer server = MockRestServiceServer.bindTo(restTemplate).build();
    server
        .expect(requestTo("http://order-service.test/api/orders?source=shop"))
        .andExpect(method(HttpMethod.POST))
        .andExpect(header("X-Key-Request", "checkout_submit_order"))
        .andExpect(header("X-Business-Request-Id", "biz-gateway-1001"))
        .andExpect(header("X-Demo-Language", "en"))
        .andExpect(header("X-Gateway-Service", "gateway-service"))
        .andExpect(header("X-Forwarded-For", "198.51.100.21"))
        .andRespond(
            withSuccess("{\"status\":\"CONFIRMED\"}", MediaType.APPLICATION_JSON)
                .header("ext_trace_id", "downstream-trace"));

    MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/orders");
    request.setQueryString("source=shop");
    request.addHeader("Content-Type", "application/json");
    request.addHeader("X-Key-Request", "checkout_submit_order");
    request.addHeader("X-Business-Request-Id", "biz-gateway-1001");
    request.addHeader("X-Demo-Language", "en");
    request.addHeader("Host", "demo.example.com");
    request.addHeader("X-Forwarded-For", "203.0.113.10, 10.0.0.9");
    request.addHeader("User-Agent", "MallDemoTest/1.0");
    request.addHeader("Referer", "https://demo.example.com/shop.html?theme=colorful");
    request.setRemoteAddr("198.51.100.21");
    request.setContent("{\"sku\":\"sku-1001\"}".getBytes());
    MockHttpServletResponse response = new MockHttpServletResponse();
    Logger logger = (Logger) LoggerFactory.getLogger(GatewayProxyFilter.class);
    ListAppender<ILoggingEvent> appender = new ListAppender<>();
    appender.start();
    logger.addAppender(appender);

    try {
      new GatewayProxyFilter(restTemplate, "http://order-service.test/")
          .doFilter(request, response, new MockFilterChain());
    } finally {
      logger.detachAppender(appender);
      appender.stop();
    }

    assertThat(response.getStatus()).isEqualTo(200);
    assertThat(response.getHeader("X-Gateway-Service")).isEqualTo("gateway-service");
    assertThat(response.getHeader("ext_trace_id")).isNull();
    assertThat(response.getContentAsString()).contains("CONFIRMED");
    assertThat(appender.list)
        .anySatisfy(
            event -> {
              assertThat(event.getFormattedMessage()).contains("Gateway request received");
              assertThat(event.getFormattedMessage())
                  .contains("public_route=orders.create")
                  .contains("route_class=business_api")
                  .contains("traffic_type=public_demo")
                  .contains("client_ip=203.0.113.10")
                  .contains("peer_ip=198.51.100.21")
                  .contains("forwarded_for=203.0.113.10, 10.0.0.9")
                  .contains("referer=https://demo.example.com/shop.html")
                  .doesNotContain("theme=colorful");
              assertThat(event.getMDCPropertyMap())
                  .containsEntry("language", "en")
                  .containsEntry("public_route", "orders.create")
                  .containsEntry("route_class", "business_api")
                  .containsEntry("traffic_type", "public_demo")
                  .containsEntry("client_ip", "203.0.113.10")
                  .containsEntry("user_agent", "MallDemoTest/1.0")
                  .containsEntry("referer", "https://demo.example.com/shop.html");
            });
    server.verify();
  }
}
