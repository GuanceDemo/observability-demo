package demo.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

class PublicRoutePolicyTest {
  private final PublicRoutePolicy policy = new PublicRoutePolicy();

  @Test
  void everyGameResourceHasAnExplicitGameRoute() throws Exception {
    var root = java.nio.file.Path.of("../game-service/src/main/resources/static");
    PublicRoutePolicy policy = new PublicRoutePolicy();
    try (var files = java.nio.file.Files.walk(root)) {
      for (var file : files.filter(java.nio.file.Files::isRegularFile).toList()) {
        String path = "/" + root.relativize(file).toString().replace('\\', '/');
        var decision = policy.evaluate("GET", path);
        assertThat(decision.forwardsDownstream()).as(path).isTrue();
        assertThat(decision.routeId()).as(path).startsWith("game.");
      }
    }
    for (String path : java.util.List.of("/api/games/admin", "/api/games/auth/session", "/assets/pvz/private.js")) {
      assertThat(policy.evaluate("GET", path).forwardsDownstream()).as(path).isFalse();
    }
    assertThat(policy.evaluate("POST", "/api/games/faults").forwardsDownstream()).isFalse();
  }

  @Test
  void allowsOnlyManifestListedPvzFiles() throws Exception {
    try (var input = getClass().getResourceAsStream("/pvz-public-assets.txt")) {
      var paths = new String(input.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8).lines().toList();
      assertThat(paths).hasSize(347);
      for (String path : paths) {
        assertThat(policy.evaluate("GET", path).forwardsDownstream()).isTrue();
        assertThat(policy.evaluate("HEAD", path).forwardsDownstream()).isTrue();
        assertThat(policy.evaluate("POST", path).forwardsDownstream()).isFalse();
        assertThat(policy.evaluate("GET", path + ".bak").forwardsDownstream()).isFalse();
      }
      assertThat(policy.evaluate("GET", "/assets/pvz/images/unknown.png").forwardsDownstream()).isFalse();
    }
  }

  @Test
  void explicitlyAllowsStorefrontAssetsAndBackendEndpoints() {
    List<RouteExpectation> routes =
        List.of(
            new RouteExpectation("GET", "/", "storefront.root", "storefront_page"),
            new RouteExpectation(
                "HEAD", "/index.html", "storefront.index", "storefront_page"),
            new RouteExpectation(
                "GET", "/entry.html", "storefront.entry", "storefront_page"),
            new RouteExpectation(
                "GET", "/business.html", "storefront.business", "storefront_page"),
            new RouteExpectation("GET", "/shop.html", "storefront.shop", "storefront_page"),
            new RouteExpectation(
                "GET",
                "/webgl-replay-game.html",
                "game.webgl-game",
                "storefront_page"),
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
                "GET",
                "/assets/avatars/demo-reader-a.png",
                "asset.demo-avatar-a",
                "static_asset"),
            new RouteExpectation(
                "HEAD",
                "/assets/avatars/demo-reader-b.png",
                "asset.demo-avatar-b",
                "static_asset"),
            new RouteExpectation(
                "GET",
                "/assets/avatars/demo-reader-c.png",
                "asset.demo-avatar-c",
                "static_asset"),
            new RouteExpectation(
                "GET", "/assets/selfheal-i18n.js", "asset.i18n", "static_asset"),
            new RouteExpectation(
                "GET",
                "/api/demo/game-assets/orbital-shield-texture.webp",
                "game.missing-texture",
                "demo_api"),
            new RouteExpectation(
                "GET", "/assets/storefront.css", "asset.storefront-css", "static_asset"),
            new RouteExpectation(
                "GET",
                "/assets/webgl-replay-game.css",
                "game.webgl-game-css",
                "static_asset"),
            new RouteExpectation(
                "HEAD",
                "/assets/webgl-replay-game.js",
                "game.webgl-game-js",
                "static_asset"),
            new RouteExpectation(
                "GET",
                "/assets/webgl-game-scene-icon.png",
                "game.webgl-game-icon",
                "static_asset"),
            new RouteExpectation(
                "GET",
                "/assets/android-storefront-scene-icon.png",
                "asset.android-storefront-icon",
                "static_asset"),
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
            new RouteExpectation("GET", "/api/demo/mobile/book-content", "demo.mobile-book-content", "demo_api"),
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
      if (decision.routeId().equals("asset.usage-guide-slide")) {
        assertThat(decision.pathPattern())
            .isEqualTo("/assets/guide-carousel/image2-slide-{slide}.png");
      } else if (decision.routeId().equals("demo.faults.enable")) {
        assertThat(decision.pathPattern())
            .isEqualTo("/api/demo/faults/{faultName}/enable");
      } else {
        assertThat(decision.pathPattern()).isEqualTo(expected.path());
      }
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
            new RouteRequest("GET", "/assets/webgl-replay-game.js.map"),
            new RouteRequest("GET", "/assets/webgl-replay-game-worker.js"),
            new RouteRequest("GET", "/assets/webgl-game-scene-icon@2x.png"),
            new RouteRequest("GET", "/assets/android-storefront-scene-icon@2x.png"),
            new RouteRequest("POST", "/api/demo/game-assets/orbital-shield-texture.webp"),
            new RouteRequest("GET", "/api/demo/game-assets/orbital-shield-texture@2x.webp"),
            new RouteRequest("GET", "/api/demo/game-assets/orbital-shield-texture.webp.map"),
            new RouteRequest("GET", "/assets/avatars/demo-reader-d.png"),
            new RouteRequest("GET", "/assets/guide-carousel/image2-slide-06.png"),
            new RouteRequest("GET", "/api/demo/new-endpoint"),
            new RouteRequest("POST", "/api/demo/mobile/book-content"),
            new RouteRequest("GET", "/api/demo/mobile/book-content/extra"),
            new RouteRequest("POST", "/rum-proxy/v1/datakit/pull"),
            new RouteRequest("GET", "/assets/%2e%2e/application.properties"));

    for (RouteRequest request : rejected) {
      PublicRoutePolicy.Decision decision = policy.evaluate(request.method(), request.path());
      assertThat(decision.action()).isEqualTo(PublicRoutePolicy.Action.REJECT);
      assertThat(decision.routeId()).isEqualTo("unmatched");
      assertThat(decision.routeClass()).isEqualTo("unmatched");
      assertThat(decision.trafficType()).isEqualTo("internet_probe");
      assertThat(decision.pathPattern()).isNull();
    }
  }


  @Test
  void gameHubUsesExactReadOnlyRoutes() {
    for (String path : List.of("/game-hub.html", "/plants-game.html",
        "/assets/game-runtime.js", "/assets/game-hub.js", "/assets/game-auth.css",
        "/assets/plants-engine.js", "/assets/plants-game.js", "/assets/plants-game.css",
        "/assets/games/air-battle-cover.png", "/assets/games/plants-zombies-cover.png")) {
      assertThat(policy.evaluate("GET", path).action()).isEqualTo(PublicRoutePolicy.Action.FORWARD);
      assertThat(policy.evaluate("HEAD", path).action()).isEqualTo(PublicRoutePolicy.Action.FORWARD);
      assertThat(policy.evaluate("POST", path).action()).isEqualTo(PublicRoutePolicy.Action.REJECT);
      assertThat(policy.evaluate("GET", path + ".bak").action()).isEqualTo(PublicRoutePolicy.Action.REJECT);
    }
    assertThat(policy.evaluate("GET", "/assets/games/private.js").action()).isEqualTo(PublicRoutePolicy.Action.REJECT);
  }

  private record RouteExpectation(
      String method, String path, String routeId, String routeClass) {}

  private record RouteRequest(String method, String path) {}
}
