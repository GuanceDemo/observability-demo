package demo.order;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.HandlerInterceptor;

record DemoUser(String id, String name, String email, String tier) {}

record DemoLoginRequest(String userId) {}

record DemoAuthSessionResponse(
    boolean authenticated, DemoUser user, List<DemoUser> personas) {}

@Component
class DemoSessionService {
  static final String COOKIE_NAME = "mall_demo_session";
  static final int DEFAULT_MAX_SESSIONS = 1024;

  private static final List<DemoUser> PERSONAS =
      List.of(
          new DemoUser(
              "demo-reader-001", "Demo Reader A", "reader-a@example.invalid", "standard"),
          new DemoUser("demo-reader-002", "Demo Reader B", "reader-b@example.invalid", "pro"),
          new DemoUser("demo-reader-003", "Demo Reader C", "reader-c@example.invalid", "vip"));

  private final Supplier<String> tokenSupplier;
  private final int maxSessions;
  private final LinkedHashMap<String, DemoUser> sessions = new LinkedHashMap<>();

  DemoSessionService() {
    SecureRandom random = new SecureRandom();
    this.tokenSupplier =
        () -> {
          byte[] bytes = new byte[32];
          random.nextBytes(bytes);
          return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        };
    this.maxSessions = DEFAULT_MAX_SESSIONS;
  }

  DemoSessionService(Supplier<String> tokenSupplier, int maxSessions) {
    this.tokenSupplier = tokenSupplier;
    this.maxSessions = Math.max(1, maxSessions);
  }

  List<DemoUser> personas() {
    return PERSONAS;
  }

  synchronized DemoLoginResult login(String userId, String previousToken) {
    DemoUser user =
        PERSONAS.stream().filter(candidate -> candidate.id().equals(userId)).findFirst().orElse(null);
    if (user == null) {
      return null;
    }
    if (previousToken != null) {
      sessions.remove(previousToken);
    }
    String token;
    do {
      token = tokenSupplier.get();
    } while (sessions.containsKey(token));
    while (sessions.size() >= maxSessions) {
      sessions.remove(sessions.keySet().iterator().next());
    }
    sessions.put(token, user);
    return new DemoLoginResult(token, user);
  }

  synchronized DemoUser resolve(String token) {
    return token == null || token.isBlank() ? null : sessions.get(token);
  }

  synchronized void logout(String token) {
    if (token != null) {
      sessions.remove(token);
    }
  }

  synchronized int sessionCount() {
    return sessions.size();
  }
}

record DemoLoginResult(String token, DemoUser user) {}

@RestController
@RequestMapping("/api/demo/auth/session")
class DemoAuthController {
  private final DemoSessionService sessions;

  DemoAuthController(DemoSessionService sessions) {
    this.sessions = sessions;
  }

  @GetMapping
  ResponseEntity<DemoAuthSessionResponse> current(
      @CookieValue(value = DemoSessionService.COOKIE_NAME, required = false) String token,
      HttpServletRequest request) {
    DemoUser user = sessions.resolve(token);
    ResponseEntity.BodyBuilder builder = ResponseEntity.ok();
    if (token != null && user == null) {
      builder.header(HttpHeaders.SET_COOKIE, expiredCookie(request).toString());
    }
    return builder.body(new DemoAuthSessionResponse(user != null, user, sessions.personas()));
  }

  @PostMapping
  ResponseEntity<?> login(
      @RequestBody(required = false) DemoLoginRequest login,
      @CookieValue(value = DemoSessionService.COOKIE_NAME, required = false) String previousToken,
      HttpServletRequest request) {
    DemoLoginResult result =
        login == null ? null : sessions.login(login.userId(), previousToken);
    if (result == null) {
      return ResponseEntity.badRequest()
          .body(Map.of("error", "invalid_demo_user", "message", "Unknown demo user"));
    }
    RequestMetadata.from(
            request.getHeader("X-Key-Request"),
            request.getHeader("X-Business-Request-Id"),
            request.getHeader("X-Demo-Language"),
            request.getHeader("baggage"),
            (String) request.getAttribute(DemoAuthContext.VISITOR_ATTRIBUTE),
            result.user())
        .applyCurrentSpanTags();
    return ResponseEntity.ok()
        .header(HttpHeaders.SET_COOKIE, sessionCookie(result.token(), request).toString())
        .header(DemoAuthContext.INTERNAL_USER_ID_HEADER, result.user().id())
        .header(DemoAuthContext.INTERNAL_USER_TIER_HEADER, result.user().tier())
        .body(new DemoAuthSessionResponse(true, result.user(), sessions.personas()));
  }

  @DeleteMapping
  ResponseEntity<Void> logout(
      @CookieValue(value = DemoSessionService.COOKIE_NAME, required = false) String token,
      HttpServletRequest request) {
    sessions.logout(token);
    return ResponseEntity.noContent()
        .header(HttpHeaders.SET_COOKIE, expiredCookie(request).toString())
        .build();
  }

  private ResponseCookie sessionCookie(String token, HttpServletRequest request) {
    return cookie(token, request).build();
  }

  private ResponseCookie expiredCookie(HttpServletRequest request) {
    return cookie("", request).maxAge(Duration.ZERO).build();
  }

  private ResponseCookie.ResponseCookieBuilder cookie(String value, HttpServletRequest request) {
    return ResponseCookie.from(DemoSessionService.COOKIE_NAME, value)
        .httpOnly(true)
        .sameSite("Strict")
        .path("/")
        .secure(isHttps(request));
  }

  private boolean isHttps(HttpServletRequest request) {
    String forwardedProto = request.getHeader("X-Forwarded-Proto");
    return forwardedProto != null
        ? "https".equalsIgnoreCase(forwardedProto.split(",", 2)[0].trim())
        : request.isSecure();
  }
}

final class DemoAuthContext {
  static final String USER_ATTRIBUTE = "demo.order.auth.user";
  static final String VISITOR_ATTRIBUTE = "demo.order.auth.visitor";
  static final String INTERNAL_USER_ID_HEADER = "X-Demo-Authenticated-User-Id";
  static final String INTERNAL_USER_TIER_HEADER = "X-Demo-Authenticated-User-Tier";

  private DemoAuthContext() {}
}

class DemoIdentityInterceptor implements HandlerInterceptor {
  private static final Logger log = LoggerFactory.getLogger(DemoIdentityInterceptor.class);
  private final DemoSessionService sessions;

  DemoIdentityInterceptor(DemoSessionService sessions) {
    this.sessions = sessions;
  }

  @Override
  public boolean preHandle(
      HttpServletRequest request, HttpServletResponse response, Object handler) throws IOException {
    String visitorId = RequestMetadata.safeVisitorId(request.getHeader("X-Demo-Visitor-Id"));
    DemoUser user = sessions.resolve(cookieValue(request, DemoSessionService.COOKIE_NAME));
    request.setAttribute(DemoAuthContext.VISITOR_ATTRIBUTE, visitorId);
    request.setAttribute(DemoAuthContext.USER_ATTRIBUTE, user);
    applyMdc(visitorId, user);
    RequestMetadata.from(
            request.getHeader("X-Key-Request"),
            request.getHeader("X-Business-Request-Id"),
            request.getHeader("X-Demo-Language"),
            request.getHeader("baggage"),
            visitorId,
            user)
        .applyCurrentSpanTags();
    if (user != null) {
      response.setHeader(DemoAuthContext.INTERNAL_USER_ID_HEADER, user.id());
      response.setHeader(DemoAuthContext.INTERNAL_USER_TIER_HEADER, user.tier());
    }
    if ("POST".equalsIgnoreCase(request.getMethod())
        && "/api/orders".equals(request.getRequestURI())
        && user == null) {
      log.info("Order submission rejected: authentication is required visitor_id={}", visitorId);
      response.setStatus(HttpStatus.UNAUTHORIZED.value());
      response.setContentType(MediaType.APPLICATION_JSON_VALUE);
      response.setCharacterEncoding("UTF-8");
      response.getWriter().write("{\"error\":\"authentication_required\"}");
      ProcessIdentity.clearMdc();
      return false;
    }
    return true;
  }

  @Override
  public void afterCompletion(
      HttpServletRequest request, HttpServletResponse response, Object handler, Exception ex) {
    ProcessIdentity.clearMdc();
  }

  private void applyMdc(String visitorId, DemoUser user) {
    if (visitorId != null) {
      MDC.put("visitor_id", visitorId);
    }
    if (user == null) {
      MDC.put("auth_state", "anonymous");
      return;
    }
    MDC.put("user_id", user.id());
    MDC.put("user_tier", user.tier());
    MDC.put("auth_state", "authenticated");
  }

  private String cookieValue(HttpServletRequest request, String name) {
    Cookie[] cookies = request.getCookies();
    if (cookies == null) {
      return null;
    }
    for (Cookie cookie : cookies) {
      if (name.equals(cookie.getName())) {
        return cookie.getValue();
      }
    }
    return null;
  }
}
