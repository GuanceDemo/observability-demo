package demo.gateway;

import java.util.List;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.stream.Collectors;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Single source of truth for every request that the public Gateway may serve or forward.
 *
 * <p>New storefront resources and backend endpoints must be registered here before they are
 * reachable from the public listener. Requests that do not match a rule deliberately fall through
 * to the stable {@code unmatched} decision.
 */
final class PublicRoutePolicy {
  private static final Set<String> READ_METHODS = Set.of("GET", "HEAD");
  private static final Set<String> RUM_METHODS = Set.of("GET", "POST", "PUT", "OPTIONS");
  private static final Pattern FAULT_ENABLE_PATH =
      Pattern.compile("^/api/demo/faults/[A-Za-z0-9_-]+/enable$");
  private static final Pattern USAGE_GUIDE_SLIDE_PATH =
      Pattern.compile("^/assets/guide-carousel/image2-slide-0[1-5]\\.png$");

  private static final Decision UNMATCHED =
      new Decision(Action.REJECT, "unmatched", "unmatched", "internet_probe", null);

  /*
   * DENY-BY-DEFAULT CONTRACT:
   * Every new public page, static resource, backend API, or RUM intake path must have an explicit
   * rule below. Do not replace exact resource/API entries with broad "/assets/**" or "/api/**"
   * rules; requests without a rule must keep the stable UNMATCHED identity.
   */
  private static final List<RouteRule> ROUTES =
      List.of(
          RouteRule.exact(READ_METHODS, "/api/games/rum-config", Action.FORWARD, "game.rum-config", "public_demo"),
          RouteRule.exact(READ_METHODS, "/api/games/faults", Action.FORWARD, "game.faults", "public_demo"),
          RouteRule.exact(READ_METHODS, "/api/games/assets/orbital-shield-texture.webp", Action.FORWARD, "game.missing-texture", "public_demo"),
          RouteRule.exact(
              READ_METHODS,
              "/game-hub.html",
              Action.FORWARD,
              "game.game-hub-html",
              "storefront_page"),
          RouteRule.exact(
              READ_METHODS,
              "/plants-game.html",
              Action.FORWARD,
              "game.plants-game-html",
              "storefront_page"),
          RouteRule.exact(
              READ_METHODS,
              "/assets/game-runtime.js",
              Action.FORWARD,
              "game.game-runtime-js",
              "static_asset"),
          RouteRule.exact(
              READ_METHODS,
              "/assets/game-hub.js",
              Action.FORWARD,
              "game.game-hub-js",
              "static_asset"),
          RouteRule.exact(
              READ_METHODS,
              "/assets/game-auth.css",
              Action.FORWARD,
              "game.game-auth-css",
              "static_asset"),
          RouteRule.exact(
              READ_METHODS,
              "/assets/plants-engine.js",
              Action.FORWARD,
              "game.plants-engine-js",
              "static_asset"),
          RouteRule.exact(
              READ_METHODS,
              "/assets/plants-game.js",
              Action.FORWARD,
              "game.plants-game-js",
              "static_asset"),
          RouteRule.exact(
              READ_METHODS,
              "/assets/plants-game.css",
              Action.FORWARD,
              "game.plants-game-css",
              "static_asset"),
          RouteRule.exact(
              READ_METHODS,
              "/assets/games/air-battle-cover.png",
              Action.FORWARD,
              "game.games-air-battle-cover-png",
              "static_asset"),
          RouteRule.exact(
              READ_METHODS,
              "/assets/games/plants-zombies-cover.png",
              Action.FORWARD,
              "game.games-plants-zombies-cover-png",
              "static_asset"),
          RouteRule.exact(
              READ_METHODS, "/", Action.FORWARD, "storefront.root", "storefront_page"),
          RouteRule.exact(
              READ_METHODS,
              "/index.html",
              Action.FORWARD,
              "storefront.index",
              "storefront_page"),
          RouteRule.exact(
              READ_METHODS,
              "/entry.html",
              Action.FORWARD,
              "storefront.entry",
              "storefront_page"),
          RouteRule.exact(
              READ_METHODS,
              "/business.html",
              Action.FORWARD,
              "storefront.business",
              "storefront_page"),
          RouteRule.exact(
              READ_METHODS,
              "/shop.html",
              Action.FORWARD,
              "storefront.shop",
              "storefront_page"),
          RouteRule.exact(
              READ_METHODS,
              "/webgl-replay-game.html",
              Action.FORWARD,
              "game.webgl-game",
              "storefront_page"),
          RouteRule.exact(
              READ_METHODS,
              "/assets/checkout-sourcemap-fault.min.js",
              Action.FORWARD,
              "asset.checkout-fault",
              "static_asset"),
          RouteRule.exact(
              READ_METHODS,
              "/assets/checkout-sourcemap-fault.min.js.map",
              Action.FORWARD,
              "asset.checkout-fault-map",
              "static_asset"),
          RouteRule.exact(
              READ_METHODS,
              "/assets/observability-engineering-en.png",
              Action.FORWARD,
              "asset.book-cover-en",
              "static_asset"),
          RouteRule.exact(
              READ_METHODS,
              "/assets/observability-engineering-zh.png",
              Action.FORWARD,
              "asset.book-cover-zh",
              "static_asset"),
          RouteRule.exact(
              READ_METHODS,
              "/assets/avatars/demo-reader-a.png",
              Action.FORWARD,
              "asset.demo-avatar-a",
              "static_asset"),
          RouteRule.exact(
              READ_METHODS,
              "/assets/avatars/demo-reader-b.png",
              Action.FORWARD,
              "asset.demo-avatar-b",
              "static_asset"),
          RouteRule.exact(
              READ_METHODS,
              "/assets/avatars/demo-reader-c.png",
              Action.FORWARD,
              "asset.demo-avatar-c",
              "static_asset"),
          RouteRule.exact(
              READ_METHODS,
              "/assets/selfheal-i18n.js",
              Action.FORWARD,
              "asset.i18n",
              "static_asset"),
          RouteRule.exact(
              READ_METHODS,
              "/assets/storefront.css",
              Action.FORWARD,
              "asset.storefront-css",
              "static_asset"),
          RouteRule.exact(
              READ_METHODS,
              "/assets/webgl-replay-game.css",
              Action.FORWARD,
              "game.webgl-game-css",
              "static_asset"),
          RouteRule.exact(
              READ_METHODS,
              "/assets/webgl-replay-game.js",
              Action.FORWARD,
              "game.webgl-game-js",
              "static_asset"),
          RouteRule.exact(
              READ_METHODS,
              "/assets/webgl-game-scene-icon.png",
              Action.FORWARD,
              "game.webgl-game-icon",
              "static_asset"),
          RouteRule.exact(
              READ_METHODS,
              "/assets/android-storefront-scene-icon.png",
              Action.FORWARD,
              "asset.android-storefront-icon",
              "static_asset"),
          RouteRule.regex(
              READ_METHODS,
              USAGE_GUIDE_SLIDE_PATH,
              "/assets/guide-carousel/image2-slide-{slide}.png",
              Action.FORWARD,
              "asset.usage-guide-slide",
              "static_asset"),
          RouteRule.exact(
              READ_METHODS,
              "/assets/src/checkout-sourcemap-fault.js",
              Action.FORWARD,
              "asset.checkout-fault-source",
              "static_asset"),
          RouteRule.exact(
              READ_METHODS, "/robots.txt", Action.ROBOTS, "well-known.robots", "well_known"),
          RouteRule.exact(
              READ_METHODS,
              "/favicon.ico",
              Action.FAVICON,
              "well-known.favicon",
              "well_known"),
          RouteRule.exact(
              Set.of("POST"),
              "/api/orders",
              Action.FORWARD,
              "orders.create",
              "business_api"),
          RouteRule.exact(
              Set.of("GET"),
              "/api/orders/demo",
              Action.FORWARD,
              "orders.demo",
              "business_api"),
          RouteRule.exact(
              Set.of("GET"),
              "/api/demo/auth/session",
              Action.FORWARD,
              "demo.auth.session.get",
              "demo_api"),
          RouteRule.exact(
              Set.of("POST"),
              "/api/demo/auth/session",
              Action.FORWARD,
              "demo.auth.session.login",
              "demo_api"),
          RouteRule.exact(
              Set.of("DELETE"),
              "/api/demo/auth/session",
              Action.FORWARD,
              "demo.auth.session.logout",
              "demo_api"),
          RouteRule.exact(
              Set.of("GET"),
              "/api/demo/config",
              Action.FORWARD,
              "demo.config",
              "demo_api"),
          RouteRule.exact(
              Set.of("GET"),
              "/api/demo/status",
              Action.FORWARD,
              "demo.status",
              "demo_api"),
          RouteRule.exact(
              Set.of("GET"),
              "/api/demo/rum-config",
              Action.FORWARD,
              "demo.rum-config",
              "demo_api"),
          RouteRule.exact(
              Set.of("GET"),
              "/api/demo/mobile-config",
              Action.FORWARD,
              "demo.mobile-config",
              "demo_api"),
          RouteRule.exact(
              Set.of("GET"),
              "/api/demo/faults",
              Action.FORWARD,
              "demo.faults.list",
              "demo_api"),
          RouteRule.regex(
              Set.of("POST"),
              FAULT_ENABLE_PATH,
              "/api/demo/faults/{faultName}/enable",
              Action.FORWARD,
              "demo.faults.enable",
              "demo_api"),
          RouteRule.exact(
              Set.of("POST"),
              "/api/demo/faults/off",
              Action.FORWARD,
              "demo.faults.disable",
              "demo_api"),
          RouteRule.exact(
              Set.of("GET"),
              "/api/demo/mobile/book-content",
              Action.FORWARD,
              "demo.mobile-book-content",
              "demo_api"),
          RouteRule.exact(
              Set.of("GET"),
              "/api/demo/slow-resource",
              Action.FORWARD,
              "demo.slow-resource",
              "demo_api"),
          RouteRule.exact(
              Set.of("GET"),
              "/api/demo/game-assets/orbital-shield-texture.webp",
              Action.FORWARD,
              "game.missing-texture",
              "demo_api"),
          RouteRule.exact(
              Set.of("GET"),
              "/api/demo/logs",
              Action.FORWARD,
              "demo.logs",
              "demo_api"),
          RouteRule.exact(
              Set.of("POST"),
              "/api/demo/warmup",
              Action.FORWARD,
              "demo.warmup",
              "demo_api"),
          RouteRule.exact(
              RUM_METHODS,
              "/rum-proxy/v1/write/rum",
              Action.FORWARD,
              "rum.write",
              "rum_intake"),
          RouteRule.exact(
              RUM_METHODS,
              "/rum-proxy/v1/write/rum/replay",
              Action.FORWARD,
              "rum.replay",
              "rum_intake"),
          RouteRule.exact(
              RUM_METHODS,
              "/rum-proxy/v1/write/rum/replay_assets",
              Action.FORWARD,
              "rum.replay-assets",
              "rum_intake"),
          RouteRule.exact(
              RUM_METHODS,
              "/rum-proxy/v1/check/rum/replay_assets",
              Action.FORWARD,
              "rum.check-replay-assets",
              "rum_intake"),
          RouteRule.exact(
              RUM_METHODS,
              "/rum-proxy/v1/write/logging",
              Action.FORWARD,
              "browser-logs.write",
              "rum_intake"),
          RouteRule.exact(
              Set.of("GET"),
              "/rum-proxy/v1/datakit/pull",
              Action.FORWARD,
              "rum.filters.pull",
              "rum_intake"));

  private static final Set<String> PVZ_ASSETS = loadPvzAssets();

  private static Set<String> loadPvzAssets() {
    var stream = PublicRoutePolicy.class.getResourceAsStream("/pvz-public-assets.txt");
    if (stream == null) throw new IllegalStateException("Missing pinned PvZ public asset manifest");
    try (var reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
      return reader.lines().filter(line -> !line.isBlank()).collect(Collectors.toUnmodifiableSet());
    } catch (IOException error) {
      throw new IllegalStateException("Cannot read pinned PvZ public asset manifest", error);
    }
  }

  Decision evaluate(String method, String requestPath) {
    if (!isSafePath(requestPath)) {
      return UNMATCHED;
    }
    String normalizedMethod = method == null ? "" : method.toUpperCase(Locale.ROOT);
    if (READ_METHODS.contains(normalizedMethod) && PVZ_ASSETS.contains(requestPath)) {
      String pathPattern =
          requestPath.startsWith("/assets/pvz/") ? "/assets/pvz/{assetPath}" : requestPath;
      return new Decision(
          Action.FORWARD,
          "game.pvz-pinned-asset",
          "static_asset",
          "public_demo",
          pathPattern);
    }
    for (RouteRule route : ROUTES) {
      if (route.matches(normalizedMethod, requestPath)) {
        return route.decision();
      }
    }
    return UNMATCHED;
  }

  private boolean isSafePath(String path) {
    if (path == null
        || path.isBlank()
        || !path.startsWith("/")
        || path.length() > 2048
        || path.indexOf('\\') >= 0
        || path.indexOf('\0') >= 0
        || path.contains("..")) {
      return false;
    }
    String lowerPath = path.toLowerCase(Locale.ROOT);
    return !lowerPath.contains("%2e")
        && !lowerPath.contains("%2f")
        && !lowerPath.contains("%5c");
  }

  enum Action {
    FORWARD,
    ROBOTS,
    FAVICON,
    REJECT
  }

  record Decision(
      Action action,
      String routeId,
      String routeClass,
      String trafficType,
      String pathPattern) {
    boolean forwardsDownstream() {
      return action == Action.FORWARD;
    }
  }

  private enum MatchType {
    EXACT,
    REGEX
  }

  private record RouteRule(
      Set<String> methods,
      MatchType matchType,
      String path,
      Pattern pattern,
      Decision decision) {
    static RouteRule exact(
        Set<String> methods,
        String path,
        Action action,
        String routeId,
        String routeClass) {
      return new RouteRule(
          methods,
          MatchType.EXACT,
          path,
          null,
          new Decision(action, routeId, routeClass, "public_demo", path));
    }

    static RouteRule regex(
        Set<String> methods,
        Pattern pattern,
        String pathPattern,
        Action action,
        String routeId,
        String routeClass) {
      return new RouteRule(
          methods,
          MatchType.REGEX,
          "",
          pattern,
          new Decision(action, routeId, routeClass, "public_demo", pathPattern));
    }

    boolean matches(String method, String requestPath) {
      if (!methods.contains(method)) {
        return false;
      }
      return switch (matchType) {
        case EXACT -> path.equals(requestPath);
        case REGEX -> pattern.matcher(requestPath).matches();
      };
    }
  }
}
