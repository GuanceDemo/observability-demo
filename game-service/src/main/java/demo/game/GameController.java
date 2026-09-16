package demo.game;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.LinkedHashMap;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
class GameController {
  private final Environment environment;
  GameController(Environment environment) { this.environment = environment; }
  private static final List<GameFaultScenario> FAULTS = List.of(
          new GameFaultScenario(
              "game_render_overload",
              "游戏渲染过载",
              "frontend",
              "render_overload",
              "mall-game-h5",
              "webgl-main-thread",
              "client",
              "粒子风暴与密集场景负载持续约十秒，并通过间歇性主线程压力制造稳定可见的持续掉帧。",
              "同一 RUM View 中出现开始/恢复 Action、多段 Long Task、FPS 与掉帧统计，以及持续卡顿的 WebGL Replay。",
              0,
              true,
              List.of("web"),
              List.of("webgl-game")),
          new GameFaultScenario(
              "game_asset_load_failure",
              "资源加载失败",
              "frontend",
              "resource_error",
              "mall-game-h5",
              "/api/demo/game-assets/orbital-shield-texture.webp",
              "client",
              "飞船护盾纹理请求返回 404，游戏持续显示降级材质并在约十秒后切换到内置备用材质。",
              "同一 RUM View 中出现 404 Resource、handled Error、失败/重试/恢复 Action，以及 Replay 中持续可见的降级材质。",
              0,
              true,
              List.of("web"),
              List.of("webgl-game")));

  @GetMapping("/api/games/faults")
  Map<String, Object> faults() {
    return Map.of("items", FAULTS.stream().map(GameFaultScenario::toMap).toList(), "timestamp", Instant.now().toString());
  }

  @GetMapping("/api/games/rum-config")
  Map<String, Object> rumConfig() {
    Map<String, Object> config = new LinkedHashMap<>();
    config.put("enabled", environment.getProperty("rum.enabled", Boolean.class, false));
    String applicationId = environment.getProperty("rum.game-application-id", "");
    String service = environment.getProperty("rum.game-service", "mall-game-h5");
    config.put("applicationId", applicationId);
    config.put("gameApplicationId", applicationId);
    config.put("service", service);
    config.put("gameService", service);
    config.put("datakitOrigin", "/rum-proxy");
    config.put("env", environment.getProperty("demo.environment", "demo"));
    config.put("version", environment.getProperty("demo.version", "1.0.0"));
    config.put("project", environment.getProperty("demo.project", "mall-demo"));
    config.put("datakitProvider", environment.getProperty("demo.datakit-provider", "guance"));
    config.put("traceType", "ddtrace");
    config.put("compressIntakeRequests", true);
    config.put("sessionSampleRate", 100);
    config.put("sessionReplaySampleRate", 100);
    config.put("sessionReplayOnErrorSampleRate", 100);
    return config;
  }

  @GetMapping({"/api/demo/game-assets/orbital-shield-texture.webp", "/api/games/assets/orbital-shield-texture.webp"})
  ResponseEntity<Void> missingGameShieldTexture() {
    return ResponseEntity.status(HttpStatus.NOT_FOUND)
        .header(HttpHeaders.CACHE_CONTROL, "no-store")
        .header("X-Demo-Fault", "game_asset_load_failure")
        .build();
  }

}

record GameFaultScenario(
    String id,
    String title,
    String layer,
    String kind,
    String service,
    String target,
    String mode,
    String description,
    String expectedObservation,
    long ttlSeconds,
    boolean clientSide,
    List<String> platforms,
    List<String> scenes) {
  Map<String, Object> toMap() {
    Map<String, Object> response = new LinkedHashMap<>();
    response.put("id", id);
    response.put("title", title);
    response.put("layer", layer);
    response.put("kind", kind);
    response.put("service", service);
    response.put("target", target);
    response.put("mode", mode);
    response.put("description", description);
    response.put("expectedObservation", expectedObservation);
    response.put("ttlSeconds", ttlSeconds);
    response.put("clientSide", clientSide);
    response.put("execution", clientSide ? "client" : "server");
    response.put("platforms", platforms);
    response.put("scenes", scenes);
    return response;
  }
}
