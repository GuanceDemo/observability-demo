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
}
