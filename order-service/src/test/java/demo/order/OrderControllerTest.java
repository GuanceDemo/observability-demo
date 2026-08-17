package demo.order;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.lang.Nullable;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

class OrderControllerTest {
  @TempDir private Path tempDir;

  private final RecordingRestTemplate restTemplate = new RecordingRestTemplate();
  private final RecordingOrderStore orderStore = new RecordingOrderStore();
  private final MockMvc mockMvc =
      MockMvcBuilders.standaloneSetup(
              new OrderController(
                  restTemplate,
                  "http://inventory-service.test",
                  "http://payment-service.test",
                  new FaultState(),
                  orderStore,
                  1600))
          .build();

  @Test
  void demoOrderConfirmsOrderAndReturnsBusinessFields() throws Exception {
    mockMvc
        .perform(
            get("/api/orders/demo")
                .header("X-Key-Request", "checkout_submit_order")
                .header("X-Business-Request-Id", "biz-1001")
                .header("baggage", "biz_chain=selfheal_checkout"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("CONFIRMED"))
        .andExpect(jsonPath("$.sku").value("sku-1001"))
        .andExpect(jsonPath("$.quantity").value(1))
        .andExpect(jsonPath("$.keyRequest").value("checkout_submit_order"))
        .andExpect(jsonPath("$.businessRequestId").value("biz-1001"));

    assertThat(restTemplate.calledUrls)
        .containsExactly(
            "http://inventory-service.test/api/inventory/reserve",
            "http://payment-service.test/api/payments/pay");
    assertThat(orderStore.statuses).containsExactly("CREATED", "INVENTORY_RESERVED", "CONFIRMED");
  }

  @Test
  void demoOrderPreservesProjectBaggageForDownstreamServices() throws Exception {
    Logger logger = (Logger) LoggerFactory.getLogger(OrderController.class);
    ListAppender<ILoggingEvent> appender = new ListAppender<>();
    appender.start();
    logger.addAppender(appender);
    try {
      mockMvc
          .perform(
              get("/api/orders/demo")
                  .header("X-Key-Request", "checkout_submit_order")
                  .header("X-Business-Request-Id", "biz-1001")
                  .header("X-Demo-Language", "en")
                  .header(
                      "baggage",
                      "project=mall-demo,"
                          + "key_request=checkout_submit_order,"
                          + "biz_chain=selfheal_checkout,biz_request_id=biz-1001"))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.status").value("CONFIRMED"));
    } finally {
      logger.detachAppender(appender);
      appender.stop();
    }

    assertThat(restTemplate.requests).hasSize(2);
    assertThat(restTemplate.requests)
        .allSatisfy(
            request -> {
              String baggage = request.getHeaders().getFirst("baggage");
              assertThat(baggage)
                  .contains("project=mall-demo")
                  .contains("key_request=checkout_submit_order")
                  .contains("biz_chain=selfheal_checkout")
                  .contains("biz_request_id=biz-1001");
              assertThat(baggage).matches("^[\\x21-\\x7E]+$");
              assertThat(request.getHeaders().getFirst("X-Demo-Language")).isEqualTo("en");
            });
    assertThat(appender.list)
        .anySatisfy(
            event -> assertThat(event.getFormattedMessage()).contains("Creating order:"));
  }

  @Test
  void logsEndpointMatchesBackendLogLinesByBusinessRequest() throws Exception {
    String businessRequestId = "biz-1001-abcdef";
    String orderId = "ord-1001-abcdef";
    Files.writeString(
        tempDir.resolve("gateway-service.log"),
        ("2026-06-20 03:13:19.150 INFO [main] demo.gateway.GatewayProxyFilter - 网关接入：方法=GET 路径=/api/orders/demo 下游=http://order-service:8080/api/orders/demo 关键请求=checkout_submit_order 业务请求ID=%s | service=gateway-service env=test version=1.0.0 project=mall-demo trace_id=1057687758430268391 span_id=2206721340737204861 process_id=1 host=demo-node pod_name=gateway-service-abc pod_namespace=demo container_name=gateway-service%n"
                + "2026-06-20 03:13:19.355 INFO [main] demo.gateway.GatewayProxyFilter - Gateway request: method=GET path=/api/demo/logs downstream=http://order-service:8080/api/demo/logs?biz_request_id=%s | service=gateway-service env=test version=1.0.0 project=mall-demo trace_id=887766554433221100 span_id=2206721340737204999%n")
            .formatted(businessRequestId, businessRequestId));
    Files.writeString(
        tempDir.resolve("order-service.log"),
        ("2026-06-20 03:13:19.165 INFO [main] demo.order.OrderController - 创建订单：订单ID=%s 商品=sku-1001 数量=1 金额=1999分 关键请求=checkout_submit_order 业务请求ID=%s | service=order-service env=test version=1.0.0 project=mall-demo trace_id=1057687758430268391 span_id=4456721340737204861 process_id=1 host_process_id=101 container_process_id=1 host=demo-node host_name=order-service-abc pod_name=order-service-abc pod_namespace=demo container_name=order-service container_id=container-order-abc%n"
                + "2026-06-20 03:13:19.360 INFO [main] demo.order.KeyRequestSpanTagInterceptor - 接口入口：方法=GET 路径=/api/demo/logs 参数=biz_request_id=%s&order_id=%s 关键请求=- 业务请求ID=- | service=order-service env=test version=1.0.0 project=mall-demo trace_id=998877665544332211 span_id=4456721340737204999%n")
            .formatted(orderId, businessRequestId, businessRequestId, orderId));
    Files.writeString(
        tempDir.resolve("inventory-service.log"),
        "2026-06-20 03:13:19.172 INFO [main] demo.inventory.InventoryController - 预留库存：订单ID=%s 商品=sku-1001 数量=1 库存模式=none 关键请求=checkout_submit_order 业务请求ID=%s | service=inventory-service env=test version=1.0.0 project=mall-demo trace_id=1057687758430268391 span_id=9906721340737204861 process_id=1 host_process_id=102 container_process_id=1 host=demo-node host_name=inventory-service-abc pod_name=inventory-service-abc pod_namespace=demo container_name=inventory-service container_id=container-inventory-abc%n"
            .formatted(orderId, businessRequestId));
    Files.writeString(
        tempDir.resolve("payment-service.log"),
        "2026-06-20 03:13:19.330 INFO [main] demo.payment.PaymentController - 支付成功：订单ID=%s 金额=1999分 耗时=120ms 关键请求=checkout_submit_order 业务请求ID=%s | service=payment-service env=test version=1.0.0 project=mall-demo trace_id=1057687758430268391 span_id=1206721340737204861 process_id=1 host_process_id=103 container_process_id=1 host=demo-node host_name=payment-service-abc pod_name=payment-service-abc pod_namespace=demo container_name=payment-service container_id=container-payment-abc%n"
            .formatted(orderId, businessRequestId));

    MockMvc logMvc = MockMvcBuilders.standaloneSetup(newDemoController()).build();

    logMvc
        .perform(
            get("/api/demo/logs")
                .param("biz_request_id", businessRequestId)
                .param("order_id", orderId)
                .param("limit", "8"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items.length()").value(4))
        .andExpect(jsonPath("$.items[0].service").value("gateway-service"))
        .andExpect(jsonPath("$.items[1].service").value("order-service"))
        .andExpect(jsonPath("$.items[2].service").value("inventory-service"))
        .andExpect(jsonPath("$.items[3].service").value("payment-service"))
        .andExpect(jsonPath("$.traceId").value("1057687758430268391"))
        .andExpect(jsonPath("$.traceIds.length()").value(1))
        .andExpect(jsonPath("$.items[0].traceId").value("1057687758430268391"))
        .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("998877665544332211"))))
        .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("887766554433221100"))))
        .andExpect(
            jsonPath("$.items[3].message").value(org.hamcrest.Matchers.containsString("支付成功")));
  }

  @Test
  void logsEndpointRejectsBroadNeedles() throws Exception {
    Files.writeString(
        tempDir.resolve("order-service.log"),
        "2026-06-20 03:13:19.165 INFO demo.order.OrderController 创建订单%n");

    MockMvc logMvc = MockMvcBuilders.standaloneSetup(newDemoController()).build();

    logMvc
        .perform(get("/api/demo/logs").param("biz_request_id", "INFO").param("limit", "8"))
        .andExpect(status().isBadRequest());
  }

  @Test
  void rumConfigUsesRuntimeTraceEnvironment() throws Exception {
    MockMvc logMvc =
        MockMvcBuilders.standaloneSetup(newDemoController("staging", "v1.2.3", "business-web"))
            .build();

    logMvc
        .perform(get("/api/demo/rum-config"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.env").value("staging"))
        .andExpect(jsonPath("$.version").value("v1.2.3"))
        .andExpect(jsonPath("$.service").value("business-web"))
        .andExpect(jsonPath("$.project").value("mall-demo"))
        .andExpect(jsonPath("$.datakitProvider").value("guance"))
        .andExpect(jsonPath("$.applicationId").value("order_web_docker_demo"))
        .andExpect(jsonPath("$.enabled").value(true))
        .andExpect(jsonPath("$.clientToken").doesNotExist())
        .andExpect(jsonPath("$.site").doesNotExist())
        .andExpect(jsonPath("$.datakitOrigin").value("/rum-proxy"))
        .andExpect(jsonPath("$.baggageKeys[0]").value("project"));
  }

  @Test
  void rumConfigIncludesTrueWatchProvider() throws Exception {
    MockMvc trueWatchMvc =
        MockMvcBuilders.standaloneSetup(
                newDemoController(
                    new RestTemplate(),
                    "test",
                    "1.0.0",
                    "mall-h5",
                    "truewatch",
                    "",
                    "workspace-demo"))
            .build();

    trueWatchMvc
        .perform(get("/api/demo/rum-config"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.datakitProvider").value("truewatch"));
  }

  @Test
  void mobileConfigUsesPlatformApplicationIdsAndContainsNoClientToken() throws Exception {
    MockMvc mobileMvc =
        MockMvcBuilders.standaloneSetup(
                newDemoController("staging", "v1.2.3", "business-web"))
            .build();

    mobileMvc
        .perform(get("/api/demo/mobile-config"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.enabled").value(true))
        .andExpect(jsonPath("$.applicationIds.android").value("android_rum_demo"))
        .andExpect(jsonPath("$.applicationIds.ios").value("ios_rum_demo"))
        .andExpect(jsonPath("$.project").value("mall-demo"))
        .andExpect(jsonPath("$.service").value("mall-mobile"))
        .andExpect(jsonPath("$.env").value("staging"))
        .andExpect(jsonPath("$.version").value("v1.2.3"))
        .andExpect(jsonPath("$.datakitPath").value("/rum-proxy"))
        .andExpect(jsonPath("$.sampleRates.session").value(1.0))
        .andExpect(jsonPath("$.sessionReplayEnabled").value(true))
        .andExpect(jsonPath("$.traceType").value("ddtrace"))
        .andExpect(jsonPath("$.clientToken").doesNotExist())
        .andExpect(jsonPath("$.site").doesNotExist());
  }

  @Test
  void mobileConfigCanEnableOnlyTheConfiguredAndroidPlatform() throws Exception {
    MockMvc androidOnlyMvc =
        MockMvcBuilders.standaloneSetup(
                newDemoControllerWithMobileApplicationIds(
                    "observability_demo_android", ""))
            .build();

    androidOnlyMvc
        .perform(get("/api/demo/mobile-config"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.enabled").value(true))
        .andExpect(
            jsonPath("$.applicationIds.android").value("observability_demo_android"))
        .andExpect(jsonPath("$.applicationIds.ios").value(""));
  }

  @Test
  void storefrontUsesLocalizedSameOriginBookCoversForRumAndReplay() throws Exception {
    byte[] sourceBytes;
    try (var source = getClass().getResourceAsStream("/static/assets/selfheal-i18n.js")) {
      assertThat(source).isNotNull();
      sourceBytes = source.readAllBytes();
    }

    String source = new String(sourceBytes, StandardCharsets.UTF_8);
    assertThat(source)
        .contains("id: 'observability-engineering'")
        .contains("id: 'distributed-observability'")
        .contains("id: 'implementing-slo'")
        .contains("id: 'site-reliability-engineering'")
        .contains("id: 'sre-workbook'")
        .contains("id: 'secure-reliable-systems'")
        .contains("image: 'assets/observability-engineering-zh.png'")
        .contains("imageEn: 'assets/observability-engineering-en.png'")
        .contains("lang === 'en' && product.imageEn ? product.imageEn : product.image")
        .contains("const storeMessages = Object.freeze")
        .contains("shelfTitle: '可观测性书单'")
        .contains("const readingStages = Object.freeze")
        .contains("window.history.replaceState(window.history.state || {}, '', url)")
        .contains("function bookById(id)")
        .contains("function storeT(key, params, language)");
  }

  @Test
  void storefrontUsesCatalogCartAndObservabilityCompatibilityContract() throws Exception {
    String shopSource;
    try (var source = getClass().getResourceAsStream("/static/shop.html")) {
      assertThat(source).isNotNull();
      shopSource = new String(source.readAllBytes(), StandardCharsets.UTF_8);
    }

    String storefrontStyles;
    try (var source = getClass().getResourceAsStream("/static/assets/storefront.css")) {
      assertThat(source).isNotNull();
      storefrontStyles = new String(source.readAllBytes(), StandardCharsets.UTF_8);
    }

    String businessSource;
    try (var source = getClass().getResourceAsStream("/static/business.html")) {
      assertThat(source).isNotNull();
      businessSource = new String(source.readAllBytes(), StandardCharsets.UTF_8);
    }
    for (int slide = 1; slide <= 5; slide++) {
      String slidePath = String.format("/static/assets/guide-carousel/image2-slide-%02d.png", slide);
      try (var source = getClass().getResourceAsStream(slidePath)) {
        assertThat(source).as("usage guide slide %s", slidePath).isNotNull();
      }
    }

    assertThat(shopSource)
        .contains("const STORE_PAGES = new Set(['home', 'path', 'detail', 'cart'])")
        .contains("const LEGACY_STORE_PAGE_ALIASES = Object.freeze({ categories: 'home', technology: 'detail', purchase: 'cart' })")
        .contains("const ORDER_BACKEND_SKU = 'sku-1001'")
        .contains("data-store-panel=\"home\"")
        .contains("data-store-panel=\"path\"")
        .contains("data-store-panel=\"detail\"")
        .contains("data-store-panel=\"cart\"")
        .contains("id=\"bagEmpty\"")
        .contains("id=\"bagFilled\"")
        .contains("id=\"cartBadge\"")
        .contains("id=\"mobileCartBadge\"")
        .contains("id=\"storeSearch\"")
        .contains("class=\"header-cart-button\"")
        .contains("class=\"signal-chip metrics\"")
        .contains("class=\"prototype-topic-strip\"")
        .contains("id=\"sortControl\"")
        .contains("class=\"detail-product\"")
        .contains("class=\"bag-filled cart-page-layout\"")
        .contains("class=\"cart-table-head\"")
        .contains("data-add-book")
        .contains("data-remove-book")
        .contains("data-cart-quantity")
        .contains("data-cart-select")
        .contains("id=\"submitBtn\"")
        .contains("id=\"trafficBtn\"")
        .contains("连续下单 5 次")
        .contains("id=\"phoneToast\"")
        .contains("assets/selfheal-i18n.js?v=20260817-bookstore-v43")
        .contains("assets/storefront.css?v=20260817-bookstore-v43")
        .contains("assets/checkout-sourcemap-fault.min.js?v=20260817-bookstore-v43")
        .contains("const PREVIEW_DISPLAY_URL = 'https://demo.dataflux.cn'")
        .contains("data-i18n-aria-label=\"shopAppLabel\"")
        .contains("data-i18n-aria-label=\"shopHomePageLabel\"")
        .contains("data-i18n-aria-label=\"shopCartPageLabel\"")
        .contains("data-i18n-aria-label=\"shopMobileNavLabel\"")
        .contains("class=\"hero-title-lines\"")
        .contains("s('heroTitleLines').split('|').filter(Boolean)")
        .contains("class=\"stage-book-copy\"")
        .doesNotContain("<small>${escapeHtml(text.badge)}</small>")
        .contains("sku: ORDER_BACKEND_SKU")
        .contains("quantity: cart.totalCopies")
        .contains("amountCent: cart.amountCent")
        .contains("book_ids: cart.bookIds")
        .contains("cart_total_copies: cart.totalCopies")
        .contains("for (let index = 0; index < 5; index += 1)")
        .contains("const BROWSER_SESSION_PERSISTENCE = 'local-storage'")
        .contains("const VISITOR_STORAGE_KEY = 'mall-demo-visitor-id-v1'")
        .contains("const VISITOR_TTL_MS = 60 * 24 * 60 * 60 * 1000")
        .contains("trackViewsManually: true")
        .contains("name: `storefront/${state.storePage}`")
        .contains("window.DATAFLUX_RUM.startView")
        .contains("sdk.setUser?.(identity)")
        .contains("sdk.clearUser?.()")
        .contains("auth_login_prompt")
        .contains("auth_login_success")
        .contains("auth_login_failure")
        .contains("auth_logout")
        .contains("'X-Demo-Visitor-Id': state.visitorId")
        .contains("event.context.visitor_id = state.visitorId")
        .contains("event.context.auth_state = state.authUser ? 'authenticated' : 'anonymous'")
        .contains("if (response.status === 401)")
        .contains("state.pendingCheckout = 'single'")
        .contains("const STORE_SESSION_STATE_KEY = 'mall-store-session-state-v1'")
        .contains("window.sessionStorage.setItem(STORE_SESSION_STATE_KEY")
        .contains("guance: 'https://static.guance.com'")
        .contains("truewatch: 'https://static.truewatch.com'")
        .contains("await ensureBrowserSdks(body.datakitProvider)")
        .contains("window.DATAFLUX_RUM?.getInternalContext?.()?.session?.id")
        .contains("window.DATAFLUX_RUM?.getInternalContext?.()?.view?.id")
        .contains("if (event?.view?.id) state.rumViewId = event.view.id")
        .contains("fault_trigger_id: triggerId")
        .contains("applicationId: rumCorrelation.applicationId")
        .contains("viewId: rumCorrelation.viewId")
        .contains("sessionId: rumCorrelation.sessionId")
        .contains("window.DATAFLUX_RUM.startSessionReplayRecording();")
        .contains("console.info('[RUM] initialized'")
        .contains("trackInteractions: true")
        .contains("trackResources: true")
        .contains("trackLongTasks: true")
        .contains("frontend_click_error")
        .contains("frontend_slow_resource")
        .contains("frontend_sourcemap_error")
        .contains("postToParent('order-result'")
        .contains("postToParent('frontend-fault-triggered'")
        .contains("source: 'mall-shop-demo'")
        .contains("data-demo-theme=\"colorful\"")
        .contains("data-demo-theme=\"white\"")
        .contains("window.history.back()")
        .contains("'touchstart', handleSwipeBackStart")
        .contains("'touchend', handleSwipeBackEnd")
        .contains("goBackStorePage('mobile_swipe_back')")
        .doesNotContain("data-store-back")
        .doesNotContain("class=\"page-back\"")
        .doesNotContain("data-store-route=\"categories\"")
        .doesNotContain("data-store-route=\"technology\"")
        .doesNotContain("phone-statusbar")
        .doesNotContain("waitForRumSession")
        .doesNotContain("RUM session was not created")
        .doesNotContain("<script src=\"https://static.truewatch.com/browser-sdk/v3/dataflux-rum.js");
    assertThat(shopSource.split("sessionPersistence: BROWSER_SESSION_PERSISTENCE", -1))
        .hasSize(3);
    assertThat(shopSource.indexOf("window.DATAFLUX_RUM.startSessionReplayRecording();"))
        .isLessThan(shopSource.indexOf("const rumSessionId = getRumSessionId();"));

    assertThat(storefrontStyles)
        .contains("background: #fff2f0")
        .contains("box-shadow: none !important")
        .contains(":root[data-demo-theme=\"white\"]")
        .contains("height: 100dvh;")
        .contains("grid-template-rows: auto minmax(0, 1fr);")
        .contains("overflow-y: auto;")
        .contains("overscroll-behavior-y: contain;")
        .contains(".storefront[data-store-page=\"path\"] > [data-store-panel=\"path\"]")
        .contains(".storefront[data-store-page=\"cart\"] > [data-store-panel=\"cart\"]")
        .contains("grid-template-columns: repeat(3, minmax(0, 1fr));")
        .contains(".mobile-nav-icon")
        .contains("Observability bookstore v33: approved prototype parity")
        .contains("grid-template-rows: 64px minmax(0, 1fr);")
        .contains("grid-template-columns: repeat(2, minmax(0, 1fr));")
        .contains("flex: 0 0 116px;")
        .contains("scroll-snap-type: x proximity;")
        .contains("flex: 0 0 112px;")
        .contains(".storefront-hero .hero-title-lines > span { display: block; white-space: nowrap; }")
        .contains(":root[data-preview-mode=\"web\"] .storefront.shop-app { grid-template-rows: 88px minmax(0, 1fr); }")
        .contains("height: 52px;")
        .contains("border-radius: 0 0 23px 23px;")
        .contains(":root[data-preview-mode=\"mobile\"] .storefront.shop-app { width: min(100%, 390px); margin: 0 auto; }")
        .contains(":root[data-preview-mode=\"mobile\"] .storefront-cart .cart-table-head { display: none; }")
        .contains(":root[data-preview-mode=\"mobile\"] .storefront-detail .detail-product")
        .contains(":root[data-preview-mode=\"mobile\"] .storefront-path .path-stage")
        .contains(":root[data-preview-mode=\"web\"] .storefront .mobile-bottom-nav")
        .contains("z-index: 30;")
        .doesNotContain(".storefront .page-back");

    assertThat(businessSource)
        .contains("const SHOP_BUILD_ID = '20260817-bookstore-v43'")
        .contains("assets/selfheal-i18n.js?v=20260817-bookstore-v43")
        .contains("data-i18n=\"browserAddress\">https://demo.dataflux.cn</span>")
        .contains("<polyline points=\"23 4 23 10 17 10\"></polyline>")
        .contains("<path d=\"M20.49 15a9 9 0 1 1-2.12-9.36L23 10\"></path>")
        .doesNotContain("demo.local/bookstore")
        .doesNotContain(">↻</span>")
        .doesNotContain("id=\"datakitProviderBadge\"")
        .doesNotContain("function updateDatakitProviderBadge()")
        .doesNotContain("DataKit → Guance")
        .contains("id=\"usageGuideBtn\"")
        .contains("id=\"usageGuideModal\" hidden")
        .contains("const USAGE_GUIDE_SLIDES = Object.freeze([")
        .contains("assets/guide-carousel/image2-slide-01.png")
        .contains("assets/guide-carousel/image2-slide-05.png")
        .contains("function openUsageGuide()")
        .contains("function closeUsageGuide()")
        .contains("event.key === 'ArrowLeft'")
        .contains("event.key === 'ArrowRight'")
        .contains("event.key === 'Escape'")
        .contains("id=\"openShopLink\"")
        .contains("id=\"observabilityRumViewLink\"")
        .contains("data-i18n=\"parentRumViewLinkOpen\" hidden")
        .contains("id=\"observabilityTraceLink\"")
        .contains("data-i18n=\"parentTraceLinkOpen\" hidden")
        .contains("new URL('/rum/viewer', state.demoConfig.observabilityConsoleUrl)")
        .contains("time: '1h'")
        .contains("viewType: 'view'")
        .contains("app_id: correlation.applicationId")
        .contains("`view_id:${correlation.viewId}`")
        .contains("updateObservabilityRumViewLink(payload)")
        .contains("els.observabilityRumViewLink.hidden = !hasRumView")
        .contains("els.observabilityTraceLink.hidden = !hasTrace")
        .contains(".observability-link-actions > [hidden]")
        .contains("function resetObservabilityLinks()")
        .contains("updateObservabilityTraceLink([])")
        .doesNotContain("RUM_VIEW_TIME_PADDING_MS")
        .contains("target=\"_blank\"")
        .contains("rel=\"noopener noreferrer\"")
        .contains("if (els.openShopLink) els.openShopLink.href = nextUrl")
        .contains("state.previewMode = mode;")
        .contains("updateFrameUrls({ reloadPreview: true, preserveStoreState: true });")
        .contains("const previewChanged = els.shopFrame.dataset.previewMode !== state.previewMode")
        .contains("els.shopFrame.dataset.previewMode = state.previewMode")
        .contains("if (activeBackendFault) sendShopMessage('set-fault-hint', { scenario: activeBackendFault });")
        .contains("data.type === 'shop-language-changed'")
        .contains("scenario.platforms.includes('web')")
        .contains(".preview-stage[data-view=\"mobile\"] .phone-statusbar")
        .contains(".preview-stage[data-view=\"mobile\"] .phone-frame-wrap")
        .contains("border-radius: 0 0 24px 24px;")
        .contains("background: #ffffff;");
  }

  @Test
  void publicConfigContainsNoSecretsAndOmitsUnconfiguredWorkspace() throws Exception {
    MockMvc demoMvc = MockMvcBuilders.standaloneSetup(newDemoController()).build();

    demoMvc
        .perform(get("/api/demo/config"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.controlTokenRequired").doesNotExist())
        .andExpect(jsonPath("$.rumEnabled").value(true))
        .andExpect(jsonPath("$.project").value("mall-demo"))
        .andExpect(jsonPath("$.version").value("1.0.0"))
        .andExpect(jsonPath("$.datakitProvider").value("guance"))
        .andExpect(jsonPath("$.observabilityConsoleUrl").value("https://console.guance.com"))
        .andExpect(jsonPath("$.workspaceId").doesNotExist())
        .andExpect(jsonPath("$.controlToken").doesNotExist());
  }

  @Test
  void publicConfigUsesProviderDefaultConsoleWhenWorkspaceIsConfigured() throws Exception {
    MockMvc demoMvc =
        MockMvcBuilders.standaloneSetup(
                newDemoController(
                    new RestTemplate(),
                    "test",
                    "1.0.0",
                    "mall-h5",
                    "truewatch",
                    "",
                    "workspace-demo"))
            .build();

    demoMvc
        .perform(get("/api/demo/config"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.version").value("1.0.0"))
        .andExpect(jsonPath("$.datakitProvider").value("truewatch"))
        .andExpect(
            jsonPath("$.observabilityConsoleUrl").value("https://ap1-console.truewatch.com"))
        .andExpect(jsonPath("$.workspaceId").value("workspace-demo"));
  }

  @Test
  void faultCatalogListsMultiLayerScenarios() throws Exception {
    RecordingRestTemplate demoRestTemplate = new RecordingRestTemplate();
    MockMvc demoMvc = MockMvcBuilders.standaloneSetup(newDemoController(demoRestTemplate)).build();

    demoMvc
        .perform(get("/api/demo/faults"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items.length()").value(14))
        .andExpect(jsonPath("$.items[0].id").value("frontend_click_error"))
        .andExpect(jsonPath("$.items[0].service").value("mall-h5"))
        .andExpect(jsonPath("$.items[0].execution").value("client"))
        .andExpect(jsonPath("$.items[0].platforms[0]").value("web"))
        .andExpect(jsonPath("$.items[2].id").value("frontend_sourcemap_error"))
        .andExpect(jsonPath("$.items[3].id").value("mobile_white_screen"))
        .andExpect(jsonPath("$.items[3].platforms[0]").value("android"))
        .andExpect(jsonPath("$.items[3].clientSide").value(true))
        .andExpect(jsonPath("$.items[9].id").value("order_slow"))
        .andExpect(jsonPath("$.items[10].id").value("inventory_redis_timeout"))
        .andExpect(jsonPath("$.items[10].execution").value("server"))
        .andExpect(jsonPath("$.items[10].platforms[2]").value("ios"))
        .andExpect(jsonPath("$.items[10].expectedObservation").isNotEmpty());
  }

  @Test
  void enableFaultScenarioForwardsToTargetService() throws Exception {
    RecordingRestTemplate demoRestTemplate = new RecordingRestTemplate();
    MockMvc demoMvc =
        MockMvcBuilders.standaloneSetup(newDemoController(demoRestTemplate))
            .addInterceptors(new KeyRequestSpanTagInterceptor())
            .build();

    demoMvc
        .perform(
            post("/api/demo/faults/inventory_redis_timeout/enable")
                .header("X-Demo-Language", "en"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.scenario.id").value("inventory_redis_timeout"))
        .andExpect(jsonPath("$.result.mode").value("redis_timeout"));

    assertThat(demoRestTemplate.postObjectUrls)
        .contains("http://inventory-service.test/admin/fault/redis_timeout?ttlSeconds=300");
    assertThat(demoRestTemplate.requests)
        .allSatisfy(
            request ->
                assertThat(request.getHeaders().getFirst("X-Demo-Language")).isEqualTo("en"));
  }

  @Test
  void faultControlsAndWarmupDoNotRequireCredentials() throws Exception {
    MockMvc demoMvc =
        MockMvcBuilders.standaloneSetup(newDemoController(new RecordingRestTemplate())).build();

    demoMvc
        .perform(post("/api/demo/faults/payment_error/enable"))
        .andExpect(status().isOk());
    demoMvc
        .perform(post("/api/demo/faults/off"))
        .andExpect(status().isOk());
    demoMvc
        .perform(post("/api/demo/warmup"))
        .andExpect(status().isOk());
  }

  @Test
  void rumReplayProxyForwardsOnlyWhenRumIsEnabled() throws Exception {
    RestTemplate proxyTemplate = new RestTemplate();
    MockRestServiceServer server = MockRestServiceServer.bindTo(proxyTemplate).build();
    server
        .expect(requestTo("http://datakit.test:9529/v1/write/rum/replay?batch=1"))
        .andExpect(method(HttpMethod.POST))
        .andRespond(withSuccess("accepted", MediaType.TEXT_PLAIN));
    server
        .expect(requestTo("http://datakit.test:9529/v1/write/rum/replay_assets"))
        .andExpect(method(HttpMethod.POST))
        .andRespond(withSuccess("asset accepted", MediaType.TEXT_PLAIN));
    server
        .expect(requestTo("http://datakit.test:9529/v1/check/rum/replay_assets"))
        .andExpect(method(HttpMethod.GET))
        .andRespond(withSuccess("checked", MediaType.APPLICATION_JSON));
    server
        .expect(requestTo("http://datakit.test:9529/v1/datakit/pull?filters=true"))
        .andExpect(method(HttpMethod.GET))
        .andRespond(
            withSuccess(
                "{\"filters\":{\"rum\":[],\"logging\":[]},\"pull_interval\":\"30m\"}",
                MediaType.APPLICATION_JSON));
    MockMvc proxyMvc =
        MockMvcBuilders.standaloneSetup(
                new RumProxyController(proxyTemplate, "http://datakit.test:9529/", true, false))
            .build();

    proxyMvc
        .perform(
            post("/rum-proxy/v1/write/rum/replay")
                .queryParam("batch", "1")
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .content("replay-payload"))
        .andExpect(status().isOk());
    proxyMvc
        .perform(
            post("/rum-proxy/v1/write/rum/replay_assets")
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .content("replay-asset"))
        .andExpect(status().isOk());
    proxyMvc
        .perform(get("/rum-proxy/v1/check/rum/replay_assets"))
        .andExpect(status().isOk());
    proxyMvc
        .perform(get("/rum-proxy/v1/datakit/pull").queryParam("filters", "true"))
        .andExpect(status().isOk())
        .andExpect(content().json("{\"pull_interval\":\"30m\"}"));
    proxyMvc
        .perform(post("/rum-proxy/v1/write/rum/not-authorized"))
        .andExpect(status().isNotFound());
    server.verify();

    RestTemplate mobileOnlyTemplate = new RestTemplate();
    MockRestServiceServer mobileOnlyServer =
        MockRestServiceServer.bindTo(mobileOnlyTemplate).build();
    mobileOnlyServer
        .expect(requestTo("http://datakit.test:9529/v1/write/rum"))
        .andExpect(method(HttpMethod.POST))
        .andRespond(withSuccess("mobile accepted", MediaType.TEXT_PLAIN));
    MockMvc mobileOnlyProxyMvc =
        MockMvcBuilders.standaloneSetup(
                new RumProxyController(
                    mobileOnlyTemplate, "http://datakit.test:9529", false, true))
            .build();
    mobileOnlyProxyMvc
        .perform(
            post("/rum-proxy/v1/write/rum")
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .content("mobile-rum"))
        .andExpect(status().isOk());
    mobileOnlyServer.verify();

    MockMvc disabledProxyMvc =
        MockMvcBuilders.standaloneSetup(
                new RumProxyController(
                    new RestTemplate(), "http://datakit.test:9529", false, false))
            .build();
    disabledProxyMvc.perform(post("/rum-proxy/v1/write/rum")).andExpect(status().isNotFound());
    disabledProxyMvc.perform(post("/rum-proxy/actuator/health")).andExpect(status().isNotFound());
  }

  @Test
  void canEnableAndDisableOrderFault() throws Exception {
    FaultState faultState = new FaultState();
    MockMvc faultMvc =
        MockMvcBuilders.standaloneSetup(new FaultAdminController(faultState)).build();

    faultMvc
        .perform(post("/admin/fault/order-slow"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.mode").value("order_slow"))
        .andExpect(jsonPath("$.layer").value("service"));

    faultMvc
        .perform(get("/admin/fault"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.mode").value("order_slow"));

    faultMvc
        .perform(post("/admin/fault/off"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.mode").value("none"));
  }

  @Test
  void orderFaultExpiresAfterTtl() {
    AtomicReference<java.time.Instant> now =
        new AtomicReference<>(java.time.Instant.parse("2026-07-14T00:00:00Z"));
    FaultState state = new FaultState(now::get);
    state.enable("order_slow", 30);
    assertThat(state.current().mode()).isEqualTo("order_slow");

    now.set(now.get().plusSeconds(31));
    assertThat(state.current().mode()).isEqualTo("none");
  }

  private DemoController newDemoController() {
    return newDemoController(new RestTemplate(), "test", "1.0.0", "mall-h5");
  }

  private DemoController newDemoController(RestTemplate restTemplate) {
    return newDemoController(restTemplate, "test", "1.0.0", "mall-h5");
  }

  private DemoController newDemoController(String rumEnv, String rumVersion, String rumService) {
    return newDemoController(new RestTemplate(), rumEnv, rumVersion, rumService);
  }

  private DemoController newDemoController(
      RestTemplate restTemplate, String rumEnv, String rumVersion, String rumService) {
    return newDemoController(
        restTemplate,
        rumEnv,
        rumVersion,
        rumService,
        "guance",
        "",
        "");
  }

  private DemoController newDemoController(
      RestTemplate restTemplate,
      String rumEnv,
      String rumVersion,
      String rumService,
      String datakitProvider,
      String consoleUrl,
      String workspaceId) {
    return newDemoController(
        restTemplate,
        rumEnv,
        rumVersion,
        rumService,
        datakitProvider,
        consoleUrl,
        workspaceId,
        "android_rum_demo",
        "ios_rum_demo");
  }

  private DemoController newDemoControllerWithMobileApplicationIds(
      String androidApplicationId, String iosApplicationId) {
    return newDemoController(
        new RestTemplate(),
        "test",
        "1.0.0",
        "mall-h5",
        "guance",
        "",
        "",
        androidApplicationId,
        iosApplicationId);
  }

  private DemoController newDemoController(
      RestTemplate restTemplate,
      String rumEnv,
      String rumVersion,
      String rumService,
      String datakitProvider,
      String consoleUrl,
      String workspaceId,
      String androidApplicationId,
      String iosApplicationId) {
    return new DemoController(
        restTemplate,
        "http://order-service.test",
        "http://inventory-service.test",
        "http://payment-service.test",
        "mall-demo",
        true,
        "order_web_docker_demo",
        "/rum-proxy",
        rumEnv,
        rumVersion,
        rumService,
        true,
        androidApplicationId,
        iosApplicationId,
        "mall-mobile",
        true,
        datakitProvider,
        consoleUrl,
        workspaceId,
        tempDir.toString(),
        false,
        240,
        600);
  }

  private static final class RecordingRestTemplate extends RestTemplate {
    private final List<String> calledUrls = new ArrayList<>();
    private final List<String> postObjectUrls = new ArrayList<>();
    private final List<HttpEntity<?>> requests = new ArrayList<>();

    @Override
    @SuppressWarnings("unchecked")
    public <T> ResponseEntity<T> postForEntity(
        String url, @Nullable Object request, Class<T> responseType, Object... uriVariables)
        throws RestClientException {
      calledUrls.add(url);
      if (request instanceof HttpEntity<?> entity) {
        requests.add(entity);
      }
      if (url.startsWith("http://inventory-service.test")) {
        return (ResponseEntity<T>) ResponseEntity.ok(Map.of("status", "RESERVED"));
      }
      if (url.startsWith("http://payment-service.test")) {
        return (ResponseEntity<T>) ResponseEntity.ok(Map.of("status", "PAID"));
      }
      throw new RestClientException("unexpected downstream url: " + url);
    }

    @Override
    @SuppressWarnings("unchecked")
    public <T> T getForObject(String url, Class<T> responseType, Object... uriVariables)
        throws RestClientException {
      if (url.endsWith("/actuator/health")) {
        return (T) Map.of("status", "UP");
      }
      if (url.endsWith("/admin/fault")) {
        return (T) Map.of("mode", "none", "layer", "normal", "service", serviceName(url));
      }
      throw new RestClientException("unexpected get url: " + url);
    }

    @Override
    @SuppressWarnings("unchecked")
    public <T> ResponseEntity<T> exchange(
        String url,
        HttpMethod method,
        @Nullable HttpEntity<?> requestEntity,
        Class<T> responseType,
        Object... uriVariables)
        throws RestClientException {
      if (requestEntity != null) {
        requests.add(requestEntity);
      }
      if (method == HttpMethod.GET && url.endsWith("/actuator/health")) {
        return (ResponseEntity<T>) ResponseEntity.ok(Map.of("status", "UP"));
      }
      if (method == HttpMethod.GET && url.endsWith("/admin/fault")) {
        return (ResponseEntity<T>)
            ResponseEntity.ok(
                Map.of("mode", "none", "layer", "normal", "service", serviceName(url)));
      }
      throw new RestClientException("unexpected exchange url: " + url);
    }

    @Override
    @SuppressWarnings("unchecked")
    public <T> T postForObject(
        String url, @Nullable Object request, Class<T> responseType, Object... uriVariables)
        throws RestClientException {
      postObjectUrls.add(url);
      if (request instanceof HttpEntity<?> entity) {
        requests.add(entity);
      }
      if (url.contains("/admin/fault/off")) {
        return (T) Map.of("mode", "none");
      }
      if (url.contains("/admin/fault/")) {
        String mode = url.substring(url.lastIndexOf('/') + 1);
        int queryIndex = mode.indexOf('?');
        if (queryIndex >= 0) {
          mode = mode.substring(0, queryIndex);
        }
        return (T) Map.of("mode", mode.replace('-', '_'));
      }
      throw new RestClientException("unexpected post url: " + url);
    }

    private String serviceName(String url) {
      if (url.contains("inventory")) {
        return "inventory-service";
      }
      if (url.contains("payment")) {
        return "payment-service";
      }
      return "order-service";
    }
  }

  private static final class RecordingOrderStore implements OrderStore {
    private final List<String> statuses = new ArrayList<>();

    @Override
    public void create(
        String orderId,
        OrderRequest request,
        RequestMetadata metadata,
        java.time.Instant createdAt) {
      statuses.add("CREATED");
    }

    @Override
    public void updateStatus(String orderId, String status, java.time.Instant updatedAt) {
      statuses.add(status);
    }
  }
}
