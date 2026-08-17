package demo.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

class PublicRoutePolicyTest {
  private final PublicRoutePolicy policy = new PublicRoutePolicy();

  @Test
  void explicitlyAllowsStorefrontAssetsAndBackendEndpoints() {
    List<RouteExpectation> routes =
        List.of(
            new RouteExpectation("GET", "/", "storefront.root", "storefront_page"),
            new RouteExpectation(
                "HEAD", "/index.html", "storefront.index", "storefront_page"),
            new RouteExpectation(
                "GET", "/business.html", "storefront.business", "storefront_page"),
            new RouteExpectation("GET", "/shop.html", "storefront.shop", "storefront_page"),
            new RouteExpectation(
                "GET",
                "/assets/checkout-sourcemap-fault.min.js",
                "asset.checkout-fault",
                "static_asset"),
            new RouteExpectation(
                "GET",
                "/assets/checkout-sourcemap-fault.min.js.map",
                "asset.checkout-fault-map",
                "static_asset"),
            new RouteExpectation(
                "GET",
                "/assets/observability-engineering-en.png",
                "asset.book-cover-en",
                "static_asset"),
            new RouteExpectation(
                "GET",
                "/assets/observability-engineering-zh.png",
                "asset.book-cover-zh",
                "static_asset"),
            new RouteExpectation(
                "GET", "/assets/selfheal-i18n.js", "asset.i18n", "static_asset"),
            new RouteExpectation(
                "GET", "/assets/storefront.css", "asset.storefront-css", "static_asset"),
            new RouteExpectation(
                "GET",
                "/assets/guide-carousel/image2-slide-01.png",
                "asset.usage-guide-slide",
                "static_asset"),
            new RouteExpectation(
                "HEAD",
                "/assets/guide-carousel/image2-slide-05.png",
                "asset.usage-guide-slide",
                "static_asset"),
            new RouteExpectation(
                "HEAD",
                "/assets/src/checkout-sourcemap-fault.js",
                "asset.checkout-fault-source",
                "static_asset"),
            new RouteExpectation("POST", "/api/orders", "orders.create", "business_api"),
            new RouteExpectation(
                "GET", "/api/orders/demo", "orders.demo", "business_api"),
            new RouteExpectation(
                "GET", "/api/demo/auth/session", "demo.auth.session.get", "demo_api"),
            new RouteExpectation(
                "POST", "/api/demo/auth/session", "demo.auth.session.login", "demo_api"),
            new RouteExpectation(
                "DELETE", "/api/demo/auth/session", "demo.auth.session.logout", "demo_api"),
            new RouteExpectation("GET", "/api/demo/config", "demo.config", "demo_api"),
            new RouteExpectation("GET", "/api/demo/status", "demo.status", "demo_api"),
            new RouteExpectation(
                "GET", "/api/demo/rum-config", "demo.rum-config", "demo_api"),
            new RouteExpectation(
                "GET", "/api/demo/mobile-config", "demo.mobile-config", "demo_api"),
            new RouteExpectation(
                "GET", "/api/demo/faults", "demo.faults.list", "demo_api"),
            new RouteExpectation(
                "POST",
                "/api/demo/faults/payment_error/enable",
                "demo.faults.enable",
                "demo_api"),
            new RouteExpectation(
                "POST", "/api/demo/faults/off", "demo.faults.disable", "demo_api"),
            new RouteExpectation(
                "GET", "/api/demo/slow-resource", "demo.slow-resource", "demo_api"),
            new RouteExpectation("GET", "/api/demo/logs", "demo.logs", "demo_api"),
            new RouteExpectation("POST", "/api/demo/warmup", "demo.warmup", "demo_api"),
            new RouteExpectation(
                "POST", "/rum-proxy/v1/write/rum", "rum.write", "rum_intake"),
            new RouteExpectation(
                "PUT", "/rum-proxy/v1/write/rum/replay", "rum.replay", "rum_intake"),
            new RouteExpectation(
                "POST",
                "/rum-proxy/v1/write/rum/replay_assets",
                "rum.replay-assets",
                "rum_intake"),
            new RouteExpectation(
                "GET",
                "/rum-proxy/v1/check/rum/replay_assets",
                "rum.check-replay-assets",
                "rum_intake"),
            new RouteExpectation(
                "OPTIONS",
                "/rum-proxy/v1/write/logging",
                "browser-logs.write",
                "rum_intake"),
            new RouteExpectation(
                "GET",
                "/rum-proxy/v1/datakit/pull",
                "rum.filters.pull",
                "rum_intake"));

    for (RouteExpectation expected : routes) {
      PublicRoutePolicy.Decision decision = policy.evaluate(expected.method(), expected.path());
      assertThat(decision.action()).isEqualTo(PublicRoutePolicy.Action.FORWARD);
      assertThat(decision.routeId()).isEqualTo(expected.routeId());
      assertThat(decision.routeClass()).isEqualTo(expected.routeClass());
      assertThat(decision.trafficType()).isEqualTo("public_demo");
    }
  }

  @Test
  void handlesRobotsAndFaviconAtTheGateway() {
    assertThat(policy.evaluate("GET", "/robots.txt").action())
        .isEqualTo(PublicRoutePolicy.Action.ROBOTS);
    assertThat(policy.evaluate("HEAD", "/favicon.ico").action())
        .isEqualTo(PublicRoutePolicy.Action.FAVICON);
  }

  @Test
  void allUnknownMethodsAndPathsUseTheStableFallbackIdentity() {
    List<RouteRequest> rejected =
        List.of(
            new RouteRequest("GET", "/mall-demo.html"),
            new RouteRequest("GET", "/wp-admin/index.php"),
            new RouteRequest("POST", "/admin/fault/off"),
            new RouteRequest("POST", "/business.html"),
            new RouteRequest("GET", "/assets/new-file.js"),
            new RouteRequest("GET", "/assets/guide-carousel/image2-slide-06.png"),
            new RouteRequest("GET", "/api/demo/new-endpoint"),
            new RouteRequest("POST", "/rum-proxy/v1/datakit/pull"),
            new RouteRequest("GET", "/assets/%2e%2e/application.properties"));

    for (RouteRequest request : rejected) {
      PublicRoutePolicy.Decision decision = policy.evaluate(request.method(), request.path());
      assertThat(decision.action()).isEqualTo(PublicRoutePolicy.Action.REJECT);
      assertThat(decision.routeId()).isEqualTo("unmatched");
      assertThat(decision.routeClass()).isEqualTo("unmatched");
      assertThat(decision.trafficType()).isEqualTo("internet_probe");
    }
  }

  private record RouteExpectation(
      String method, String path, String routeId, String routeClass) {}

  private record RouteRequest(String method, String path) {}
}
