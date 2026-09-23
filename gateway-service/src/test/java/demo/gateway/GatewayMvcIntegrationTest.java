package demo.gateway;

import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.servlet.HandlerMapping;

@SpringBootTest(
    properties = {
      "gateway.order-url=http://order-service.test",
      "gateway.game-url=http://game-service.test"
    })
@AutoConfigureMockMvc
class GatewayMvcIntegrationTest {
  @Autowired private MockMvc mockMvc;
  @Autowired private RestTemplate gatewayRestTemplate;

  private MockRestServiceServer downstream;

  @BeforeEach
  void setUp() {
    downstream = MockRestServiceServer.bindTo(gatewayRestTemplate).build();
  }

  @Test
  void resolvesGatewayRequestsThroughSpringMvcWithAStableRoutePattern() throws Exception {
    downstream
        .expect(requestTo("http://order-service.test/api/demo/auth/session"))
        .andExpect(method(HttpMethod.GET))
        .andRespond(withSuccess("{}", MediaType.APPLICATION_JSON));

    mockMvc
        .perform(get("/api/demo/auth/session"))
        .andExpect(status().isOk())
        .andExpect(content().json("{}"))
        .andExpect(
            request()
                .attribute(
                    HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE,
                    "/api/demo/auth/session"));

    downstream.verify();
  }

  @Test
  void exposesTemplateInsteadOfConcreteDynamicPath() throws Exception {
    downstream
        .expect(requestTo("http://order-service.test/api/demo/faults/payment_error/enable"))
        .andExpect(method(HttpMethod.POST))
        .andRespond(withSuccess("{}", MediaType.APPLICATION_JSON));

    mockMvc
        .perform(post("/api/demo/faults/payment_error/enable"))
        .andExpect(status().isOk())
        .andExpect(
            request()
                .attribute(
                    HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE,
                    "/api/demo/faults/{faultName}/enable"));

    downstream.verify();
  }

  @Test
  void leavesActuatorRequestsToActuatorHandlerMappings() throws Exception {
    mockMvc
        .perform(get("/actuator/health"))
        .andExpect(status().isOk())
        .andExpect(
            request().attribute(GatewayProxyHandler.ROUTE_DECISION_ATTRIBUTE, nullValue()));

    downstream.verify();
  }
  @Test
  void preservesBusinessTagsAndOnlyTrustsVerifiedResponseIdentity() throws Exception {
    var recorded = new GatewaySpanTagsTest.RecordingSpan();
    try (var tags = org.mockito.Mockito.mockStatic(GatewaySpanTags.class)) {
      tags.when(() -> GatewaySpanTags.apply(org.mockito.ArgumentMatchers.anyMap()))
          .thenAnswer(invocation -> {
            GatewaySpanTags.applyToSpan(recorded, invocation.getArgument(0));
            return null;
          });
      // Use the actual tag writer while replacing only the optional Agent lookup.
      tags.when(() -> GatewaySpanTags.applyToSpan(
          org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.anyMap()))
          .thenCallRealMethod();
      downstream.expect(requestTo("http://order-service.test/api/demo/auth/session"))
          .andRespond(withSuccess("{}", MediaType.APPLICATION_JSON)
              .header("X-Demo-Authenticated-User-Id", "demo-reader-001")
              .header("X-Demo-Authenticated-User-Tier", "standard"));
      mockMvc.perform(get("/api/demo/auth/session")
              .header("X-Business-Request-Id", "biz-tag-regression")
              .header("X-Key-Request", "checkout_submit_order")
              .header("X-Demo-User-Id", "spoofed-user")
              .header("X-Demo-Visitor-Id", "visitor-00000000-0000-0000-0000-000000000001")
              .header("User-Agent", "route-tag-test"))
          .andExpect(status().isOk())
          .andExpect(request().attribute(
              HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE, "/api/demo/auth/session"))
          .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.header()
              .doesNotExist("X-Demo-Authenticated-User-Id"));
      org.assertj.core.api.Assertions.assertThat(recorded.tags)
          .containsEntry("biz_request_id", "biz-tag-regression")
          .containsEntry("key_request", "checkout_submit_order")
          .containsEntry("public_route", "demo.auth.session.get")
          .containsEntry("route_class", "demo_api")
          .containsEntry("traffic_type", "public_demo")
          .containsEntry("visitor_id", "visitor-00000000-0000-0000-0000-000000000001")
          .containsEntry("user_id", "demo-reader-001")
          .containsEntry("user_tier", "standard")
          .containsEntry("auth_state", "authenticated")
          .containsEntry("user_agent", "route-tag-test")
          .doesNotContainKey("http.route");
      downstream.verify();
    }
  }

}
