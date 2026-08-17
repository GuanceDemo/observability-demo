package demo.order;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import jakarta.servlet.http.Cookie;
import java.time.Instant;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.http.HttpEntity;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.lang.Nullable;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

class DemoAuthTest {
  private static final String VISITOR_ID = "visitor-12345678-1234-4123-8123-123456789abc";

  @Test
  void sessionApiListsPersonasAndUsesSecureBrowserSessionCookie() throws Exception {
    DemoSessionService sessions = new DemoSessionService();
    MockMvc mvc = authMvc(sessions);

    mvc.perform(get("/api/demo/auth/session"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.authenticated").value(false))
        .andExpect(jsonPath("$.user").doesNotExist())
        .andExpect(jsonPath("$.personas.length()").value(3))
        .andExpect(jsonPath("$.personas[0].id").value("demo-reader-001"))
        .andExpect(jsonPath("$.personas[1].tier").value("pro"))
        .andExpect(jsonPath("$.personas[2].email").value("reader-c@example.invalid"));

    MvcResult login =
        mvc.perform(
                post("/api/demo/auth/session")
                    .header("X-Forwarded-Proto", "https")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"userId\":\"demo-reader-001\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.authenticated").value(true))
            .andExpect(jsonPath("$.user.name").value("Demo Reader A"))
            .andReturn();

    String setCookie = login.getResponse().getHeader("Set-Cookie");
    assertThat(setCookie)
        .contains(DemoSessionService.COOKIE_NAME + "=")
        .contains("Path=/")
        .contains("Secure")
        .contains("HttpOnly")
        .contains("SameSite=Strict")
        .doesNotContain("Max-Age");
    String token = setCookie.substring(setCookie.indexOf('=') + 1, setCookie.indexOf(';'));
    assertThat(token).matches("[A-Za-z0-9_-]{43}");

    String httpCookie =
        mvc.perform(
                post("/api/demo/auth/session")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"userId\":\"demo-reader-002\"}"))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getHeader("Set-Cookie");
    assertThat(httpCookie).doesNotContain("Secure");
  }

  @Test
  void loginRotatesTokenAndLogoutInvalidatesSession() throws Exception {
    DemoSessionService sessions = new DemoSessionService();
    MockMvc mvc = authMvc(sessions);
    String firstToken = loginToken(mvc, "demo-reader-001", null);
    String secondToken = loginToken(mvc, "demo-reader-002", firstToken);

    assertThat(secondToken).isNotEqualTo(firstToken);
    mvc.perform(get("/api/demo/auth/session").cookie(sessionCookie(firstToken)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.authenticated").value(false))
        .andExpect(header().string("Set-Cookie", org.hamcrest.Matchers.containsString("Max-Age=0")));
    mvc.perform(get("/api/demo/auth/session").cookie(sessionCookie(secondToken)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.authenticated").value(true))
        .andExpect(jsonPath("$.user.id").value("demo-reader-002"));

    mvc.perform(delete("/api/demo/auth/session").cookie(sessionCookie(secondToken)))
        .andExpect(status().isNoContent())
        .andExpect(header().string("Set-Cookie", org.hamcrest.Matchers.containsString("Max-Age=0")));
    assertThat(sessions.resolve(secondToken)).isNull();
  }

  @Test
  void rejectsUnknownPersonaAndEvictsOldestSessionAtCapacity() throws Exception {
    AtomicInteger tokens = new AtomicInteger();
    DemoSessionService sessions =
        new DemoSessionService(() -> "token-" + tokens.incrementAndGet(), 2);
    MockMvc mvc = authMvc(sessions);

    mvc.perform(
            post("/api/demo/auth/session")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"userId\":\"not-a-persona\"}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.error").value("invalid_demo_user"));

    String first = sessions.login("demo-reader-001", null).token();
    String second = sessions.login("demo-reader-002", null).token();
    String third = sessions.login("demo-reader-003", null).token();
    assertThat(sessions.sessionCount()).isEqualTo(2);
    assertThat(sessions.resolve(first)).isNull();
    assertThat(sessions.resolve(second)).isNotNull();
    assertThat(sessions.resolve(third)).isNotNull();
  }

  @Test
  void anonymousOrderIsRejectedButPublicDemoRouteRemainsAvailable() throws Exception {
    DemoSessionService sessions = new DemoSessionService();
    RecordingRestTemplate restTemplate = new RecordingRestTemplate();
    RecordingOrderStore store = new RecordingOrderStore();
    MockMvc mvc = orderMvc(sessions, restTemplate, store);

    mvc.perform(
            post("/api/orders")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"sku\":\"sku-1001\",\"quantity\":1,\"amountCent\":1999}"))
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.error").value("authentication_required"));
    assertThat(MDC.get("auth_state")).isNull();

    mvc.perform(get("/api/orders/demo"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("CONFIRMED"));
  }

  @Test
  void authenticatedOrderPersistsAndPropagatesServerVerifiedIdentity() throws Exception {
    DemoSessionService sessions = new DemoSessionService();
    RecordingRestTemplate restTemplate = new RecordingRestTemplate();
    RecordingOrderStore store = new RecordingOrderStore();
    MockMvc mvc = orderMvc(sessions, restTemplate, store);
    String token = sessions.login("demo-reader-003", null).token();

    mvc.perform(
            post("/api/orders")
                .cookie(sessionCookie(token))
                .header("X-Demo-Visitor-Id", VISITOR_ID)
                .header("X-Demo-User-Id", "attacker")
                .header("X-Demo-User-Tier", "admin")
                .header("baggage", "user_id=attacker,user_tier=admin,auth_state=authenticated")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"sku\":\"sku-1001\",\"quantity\":2,\"amountCent\":3998}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.userId").value("demo-reader-003"))
        .andExpect(header().string(DemoAuthContext.INTERNAL_USER_ID_HEADER, "demo-reader-003"))
        .andExpect(header().string(DemoAuthContext.INTERNAL_USER_TIER_HEADER, "vip"));

    assertThat(store.createdMetadata.userId()).isEqualTo("demo-reader-003");
    assertThat(store.createdMetadata.visitorId()).isEqualTo(VISITOR_ID);
    assertThat(restTemplate.requests).hasSize(2);
    assertThat(restTemplate.requests)
        .allSatisfy(
            request -> {
              assertThat(request.getHeaders().getFirst("X-Demo-Visitor-Id"))
                  .isEqualTo(VISITOR_ID);
              assertThat(request.getHeaders().getFirst("X-Demo-User-Id"))
                  .isEqualTo("demo-reader-003");
              assertThat(request.getHeaders().getFirst("X-Demo-User-Tier")).isEqualTo("vip");
              assertThat(request.getHeaders().getFirst("X-Demo-Auth-State"))
                  .isEqualTo("authenticated");
              assertThat(request.getHeaders().getFirst("baggage"))
                  .contains("user_id=demo-reader-003")
                  .contains("user_tier=vip")
                  .doesNotContain("user_id=attacker")
                  .doesNotContain("user_tier=admin");
            });
  }

  @Test
  void existingDatabaseSchemaIsMigratedIdempotently() throws Exception {
    JdbcTemplate missingJdbc = mock(JdbcTemplate.class);
    DataSource missingDataSource = mock(DataSource.class);
    Connection missingConnection = mock(Connection.class);
    DatabaseMetaData missingMetadata = mock(DatabaseMetaData.class);
    ResultSet missingColumns = mock(ResultSet.class);
    ResultSet missingIndexes = mock(ResultSet.class);
    when(missingJdbc.getDataSource()).thenReturn(missingDataSource);
    when(missingDataSource.getConnection()).thenReturn(missingConnection);
    when(missingConnection.getMetaData()).thenReturn(missingMetadata);
    when(missingConnection.getCatalog()).thenReturn("selfheal");
    when(missingMetadata.getColumns(any(), any(), anyString(), anyString()))
        .thenReturn(missingColumns);
    when(missingMetadata.getIndexInfo(any(), any(), anyString(), anyBoolean(), anyBoolean()))
        .thenReturn(missingIndexes);
    when(missingColumns.next()).thenReturn(false);
    when(missingIndexes.next()).thenReturn(false);

    new OrderSchemaMigrator(missingJdbc).migrate();

    verify(missingJdbc).execute("ALTER TABLE demo_orders ADD COLUMN user_id VARCHAR(128) NULL");
    verify(missingJdbc).execute("CREATE INDEX idx_demo_orders_user ON demo_orders (user_id)");

    JdbcTemplate currentJdbc = mock(JdbcTemplate.class);
    DataSource currentDataSource = mock(DataSource.class);
    Connection currentConnection = mock(Connection.class);
    DatabaseMetaData currentMetadata = mock(DatabaseMetaData.class);
    ResultSet currentColumns = mock(ResultSet.class);
    ResultSet currentIndexes = mock(ResultSet.class);
    when(currentJdbc.getDataSource()).thenReturn(currentDataSource);
    when(currentDataSource.getConnection()).thenReturn(currentConnection);
    when(currentConnection.getMetaData()).thenReturn(currentMetadata);
    when(currentConnection.getCatalog()).thenReturn("selfheal");
    when(currentMetadata.getColumns(any(), any(), anyString(), anyString()))
        .thenReturn(currentColumns);
    when(currentMetadata.getIndexInfo(any(), any(), anyString(), anyBoolean(), anyBoolean()))
        .thenReturn(currentIndexes);
    when(currentColumns.next()).thenReturn(true);
    when(currentIndexes.next()).thenReturn(true, false);
    when(currentIndexes.getString("INDEX_NAME")).thenReturn("idx_demo_orders_user");

    new OrderSchemaMigrator(currentJdbc).migrate();

    verify(currentJdbc, never()).execute(anyString());
  }

  private MockMvc authMvc(DemoSessionService sessions) {
    return MockMvcBuilders.standaloneSetup(new DemoAuthController(sessions))
        .addInterceptors(new DemoIdentityInterceptor(sessions))
        .build();
  }

  private MockMvc orderMvc(
      DemoSessionService sessions, RecordingRestTemplate restTemplate, RecordingOrderStore store) {
    OrderController controller =
        new OrderController(
            restTemplate,
            "http://inventory-service.test",
            "http://payment-service.test",
            new FaultState(),
            store,
            1600);
    return MockMvcBuilders.standaloneSetup(controller)
        .addInterceptors(
            new DemoIdentityInterceptor(sessions), new KeyRequestSpanTagInterceptor())
        .build();
  }

  private String loginToken(MockMvc mvc, String userId, String previousToken) throws Exception {
    var builder =
        post("/api/demo/auth/session")
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"userId\":\"" + userId + "\"}");
    if (previousToken != null) {
      builder.cookie(sessionCookie(previousToken));
    }
    String header = mvc.perform(builder).andExpect(status().isOk()).andReturn().getResponse()
        .getHeader("Set-Cookie");
    assertThat(header).isNotNull();
    return header.substring(header.indexOf('=') + 1, header.indexOf(';'));
  }

  private Cookie sessionCookie(String token) {
    return new Cookie(DemoSessionService.COOKIE_NAME, token);
  }

  private static final class RecordingRestTemplate extends RestTemplate {
    private final List<HttpEntity<?>> requests = new ArrayList<>();

    @Override
    @SuppressWarnings("unchecked")
    public <T> ResponseEntity<T> postForEntity(
        String url, @Nullable Object request, Class<T> responseType, Object... uriVariables)
        throws RestClientException {
      if (request instanceof HttpEntity<?> entity) {
        requests.add(entity);
      }
      return (ResponseEntity<T>) ResponseEntity.ok(Map.of("status", "OK"));
    }
  }

  private static final class RecordingOrderStore implements OrderStore {
    private RequestMetadata createdMetadata;

    @Override
    public void create(
        String orderId, OrderRequest request, RequestMetadata metadata, Instant createdAt) {
      createdMetadata = metadata;
    }

    @Override
    public void updateStatus(String orderId, String status, Instant updatedAt) {}
  }
}
