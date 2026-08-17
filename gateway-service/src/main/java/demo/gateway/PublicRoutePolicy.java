package demo.gateway;

import java.util.List;
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
      new Decision(Action.REJECT, "unmatched", "unmatched", "internet_probe");

  /*
   * DENY-BY-DEFAULT CONTRACT:
   * Every new public page, static resource, backend API, or RUM intake path must have an explicit
   * rule below. Do not replace exact resource/API entries with broad "/assets/**" or "/api/**"
   * rules; requests without a rule must keep the stable UNMATCHED identity.
   */
  private static final List<RouteRule> ROUTES =
      List.of(
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
          RouteRule.regex(
              READ_METHODS,
              USAGE_GUIDE_SLIDE_PATH,
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
              "/api/demo/slow-resource",
              Action.FORWARD,
              "demo.slow-resource",
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

  Decision evaluate(String method, String requestPath) {
    if (!isSafePath(requestPath)) {
      return UNMATCHED;
    }
    String normalizedMethod = method == null ? "" : method.toUpperCase(Locale.ROOT);
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

  record Decision(Action action, String routeId, String routeClass, String trafficType) {
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
          new Decision(action, routeId, routeClass, "public_demo"));
    }

    static RouteRule regex(
        Set<String> methods,
        Pattern pattern,
        Action action,
        String routeId,
        String routeClass) {
      return new RouteRule(
          methods,
          MatchType.REGEX,
          "",
          pattern,
          new Decision(action, routeId, routeClass, "public_demo"));
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
