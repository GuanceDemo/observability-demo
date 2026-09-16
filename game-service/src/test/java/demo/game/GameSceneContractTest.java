package demo.game;
import static org.assertj.core.api.Assertions.assertThat;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
class GameSceneContractTest {
  @Test
  void webglGameSceneUsesRuntimeRumConfigAndVersionedSceneProtocol() throws Exception {
    String gameHtml;
    try (var source = getClass().getResourceAsStream("/static/webgl-replay-game.html")) {
      assertThat(source).isNotNull();
      gameHtml = new String(source.readAllBytes(), StandardCharsets.UTF_8);
    }
    String gameScript;
    try (var source =
        getClass().getResourceAsStream("/static/assets/webgl-replay-game.js")) {
      assertThat(source).isNotNull();
      gameScript = new String(source.readAllBytes(), StandardCharsets.UTF_8);
    }
    String gameStyles;
    try (var source =
        getClass().getResourceAsStream("/static/assets/webgl-replay-game.css")) {
      assertThat(source).isNotNull();
      gameStyles = new String(source.readAllBytes(), StandardCharsets.UTF_8);
    }
    String businessSource;
    try (var source = java.nio.file.Files.newInputStream(java.nio.file.Path.of("../order-service/src/main/resources/static/business.html"))) {
      assertThat(source).isNotNull();
      businessSource = new String(source.readAllBytes(), StandardCharsets.UTF_8);
    }
    String i18nSource;
    try (var source = java.nio.file.Files.newInputStream(java.nio.file.Path.of("../order-service/src/main/resources/static/assets/selfheal-i18n.js"))) {
      assertThat(source).isNotNull();
      i18nSource = new String(source.readAllBytes(), StandardCharsets.UTF_8);
    }
    byte[] gameIcon;
    try (var source =
        getClass().getResourceAsStream("/static/assets/webgl-game-scene-icon.png")) {
      assertThat(source).isNotNull();
      gameIcon = source.readAllBytes();
    }
    byte[] androidIcon;
    try (var source =
        java.nio.file.Files.newInputStream(java.nio.file.Path.of("../order-service/src/main/resources/static/assets/android-storefront-scene-icon.png"))) {
      assertThat(source).isNotNull();
      androidIcon = source.readAllBytes();
    }

    assertThat(gameHtml)
        .contains("id=\"game-canvas\"")
        .contains("tabindex=\"0\"")
        .contains("data-pointer-control=\"released\"")
        .contains("id=\"game-fps\"")
        .contains("assets/webgl-replay-game.css")
        .contains("assets/webgl-replay-game.js")
        .contains("<option value=\"4\" selected data-game-copy=\"samplingHigh\">")
        .contains("GuanceCloud/datakit-js commit f4369924d75375aa8322e95975b4938f10e16461")
        .doesNotContain("clientToken")
        .doesNotContain("cn3-rum");
    assertThat(gameScript)
        .contains("fetch(SCENE_API_PREFIX + '/api/games/rum-config'")
        .contains("guance: 'https://static.guance.com'")
        .contains("truewatch: 'https://static.truewatch.com'")
        .contains("config.gameApplicationId || config.applicationId || ''")
        .contains("config.gameService || 'mall-game-h5'")
        .contains("var sampling = query.get('sampling') || '4'")
        .contains("sampling = '4'")
        .contains("replayCanvasMimeType: 'image/webp'")
        .contains("targetFps: 20")
        .contains("interval: 50")
        .contains("cooldown: 10")
        .contains("quality: 0.72")
        .contains("maxCanvasSize: 1280")
        .contains("maxEncodedBytes: 160000")
        .contains("replayCanvasMaxEncodedBytes: captureProfile.maxEncodedBytes")
        .contains("trackViewsManually: true")
        .contains("trackLongTasks: true")
        .contains("applicationId: gameApplicationId")
        .contains("name: GAME_VIEW_NAME")
        .contains("setRumContext('business_scene', SCENE_ID)")
        .contains("source: 'observability-demo-scene'")
        .contains("postSceneMessage('fault-started'")
        .contains("function postFaultStarted(scenario, action, triggerId, triggeredAt)")
        .contains("rumReady: bootstrapState.rumReady")
        .contains("'game_asset_load_failed'")
        .contains("'game_render_overload_started'")
        .contains("data.source !== 'observability-demo-parent'")
        .contains("event.source !== window.parent")
        .contains("RENDER_OVERLOAD_DURATION_MS = 10000")
        .contains("RENDER_OVERLOAD_TARGET_FPS = 12")
        .contains("RENDER_OVERLOAD_CPU_BURST_MS = 65")
        .contains("RENDER_OVERLOAD_CPU_INTERVAL_MS = 250")
        .contains("addRumAction('game_render_overload_started'")
        .contains("addRumAction('game_render_overload_recovered'")
        .contains("ASSET_LOAD_FAILURE_DURATION_MS = 10000")
        .contains("ASSET_LOAD_FAILURE_RETRY_MS = 5000")
        .contains("MISSING_SHIELD_TEXTURE_PATH")
        .contains("addRumAction('game_asset_load_failed'")
        .contains("addRumAction('game_asset_load_retry'")
        .contains("addRumAction('game_asset_fallback_recovered'")
        .contains("window.DATAFLUX_RUM.addError(error, context)")
        .contains("attempt === 1")
        .contains("requestMissingShieldTexture(generation, 2)")
        .contains("finishAssetLoadFailure('cleared', false)")
        .contains("dropped_frames: renderOverloadDroppedFrames")
        .contains("particle_peak: renderOverloadPeakParticles")
        .contains("cpu_bursts: renderOverloadCpuBursts")
        .contains("renderOverloadNextFrameAt")
        .contains("finishRenderOverload('cleared', false)")
        .contains("var pointerInsideCanvas = false")
        .contains("else if (pointerInsideCanvas)")
        .contains("event.clientX >= rect.left")
        .contains("event.clientY <= rect.bottom")
        .contains("function setPointerControlState(active)")
        .contains("canvas.dataset.pointerControl = active ? 'inside' : 'released'")
        .contains("function releasePointerControl(event)")
        .contains("player.targetX = player.x")
        .contains("canvas.addEventListener('pointerleave', releasePointerControl)")
        .contains("canvas.addEventListener('pointercancel', releasePointerControl)")
        .contains("canvas.hasPointerCapture(event.pointerId)")
        .contains("function focusGameCanvas()")
        .contains("data.type === 'focus-scene-controls'")
        .contains("canvas.focus({ preventScroll: true })")
        .doesNotContain("game_frame_stall")
        .doesNotContain("STALL_DURATION_MS")
        .doesNotContain("clientToken")
        .doesNotContain("test_dcl")
        .doesNotContain("cn3-rum");
    assertThat(gameScript.indexOf("await initializeRum()"))
        .isLessThan(gameScript.indexOf("startGame()"));
    assertThat(gameScript.indexOf("window.DATAFLUX_RUM.init({"))
        .isLessThan(gameScript.indexOf("canvas.getContext(requestedContext"));
    assertThat(gameStyles)
        .contains("html[data-embedded=\"true\"]")
        .contains("#game-canvas:focus-visible")
        .contains("align-items: stretch;")
        .contains("max-height: 100%;")
        .contains("display: block;")
        .contains("overflow-y: auto;")
        .contains("overscroll-behavior-y: contain;")
        .contains("scrollbar-gutter: stable;")
        .contains("html[data-embedded=\"true\"] .button-grid button")
        .contains("min-height: 34px;")
        .contains("font-size: 11px;")
        .contains("white-space: nowrap;")
        .contains("html[data-embedded=\"true\"] select")
        .contains("height: 36px;")
        .contains("html[data-embedded=\"true\"] .control-note")
        .contains(".game-message.is-overload")
        .contains(".game-message.is-asset-failure")
        .contains("z-index: 3;")
        .contains("top: 72px;")
        .contains("#game-fps.is-overloaded")
        .contains("@media (prefers-reduced-motion: reduce)");
    assertThat(businessSource)
        .contains("id: 'webgl-game'")
        .contains("id: 'android-storefront'")
        .contains("supportedViews: ['web']")
        .contains("url.searchParams.set('embedded', '1')")
        .contains("source: 'observability-demo-parent'")
        .contains("'fault-started': 'frontend-fault-started'")
        .contains("if (data.type === 'frontend-fault-started')")
        .contains("function rememberSceneRumContext(context)")
        .contains("function revealActiveGameRumViewLink()")
        .contains("state.activeClientFaultTriggeredAt = Date.now()")
        .contains("state.sceneRumReady = state.sceneRumReady || payload.rumReady === true")
        .contains("state.sceneRumReady = status === 'ready' || status === 'sampled-out'")
        .contains("rememberSceneRumContext(payload);")
        .contains("updateObservabilityRumViewLink(payload);")
        .contains("function focusActiveSceneControls()")
        .contains("state.selectedSceneId !== 'webgl-game'")
        .contains("els.shopFrame.focus({ preventScroll: true })")
        .contains("sendShopMessage('focus-scene-controls')")
        .contains("event.source !== els.shopFrame.contentWindow")
        .contains("scenario.scenes.includes(sceneId)")
        .contains("long_task: 'faultKindLongTask'")
        .contains("render_overload: 'faultKindRenderOverload'")
        .contains("resource_error: 'faultKindResourceError'")
        .contains("localizedKind: faultKindLabel(scenario.kind)")
        .contains("'android-storefront': 'assets/android-storefront-scene-icon.png?v=20260902-image2-v1'")
        .contains("'webgl-game': 'assets/webgl-game-scene-icon.png?v=20260828-image2-v1'")
        .contains("image.src = imageSources[sceneId]")
        .contains("mark.append(image)")
        .doesNotContain("planet-orbit")
        .contains(".scenario-tab-list .tab-button")
        .contains("place-items: center;")
        .contains("text-align: center;")
        .contains("await resetFaultsForSceneChange();")
        .contains("state.activeGameId = null;")
        .contains("if (!els.shopFrame.getAttribute('src') || frameChanged)");
    assertThat(gameIcon.length).isGreaterThan(10_000);
    assertThat(gameIcon[0]).isEqualTo((byte) 0x89);
    assertThat(gameIcon[1]).isEqualTo((byte) 'P');
    assertThat(gameIcon[2]).isEqualTo((byte) 'N');
    assertThat(gameIcon[3]).isEqualTo((byte) 'G');
    assertThat(androidIcon.length).isGreaterThan(10_000);
    assertThat(androidIcon[0]).isEqualTo((byte) 0x89);
    assertThat(androidIcon[1]).isEqualTo((byte) 'P');
    assertThat(androidIcon[2]).isEqualTo((byte) 'N');
    assertThat(androidIcon[3]).isEqualTo((byte) 'G');
    assertThat(i18nSource)
        .contains("sceneAndroidTitle: '商城 APP Demo'")
        .contains("sceneAndroidTitle: 'Store App Demo'")
        .contains("sceneAndroidDescription: 'Android 真机操作'")
        .contains("sceneAndroidDescription: 'Interactive APK running in a real Android system'")
        .contains("previewMobileOnly: '仅支持移动端'")
        .contains("previewMobileOnly: 'Mobile only'")
        .contains("androidDebugConsoleTitle: '真实 APK 调试台'")
        .contains("androidDebugConsoleTitle: 'Real APK Diagnostics'")
        .contains("androidApkDownloadTrigger: '获取 APK'")
        .contains("androidApkDownloadTrigger: 'Get APK'")
        .contains("androidApkDownloadMeta: 'v{version} · Android {minVersion}+'").contains("androidApkDownloadAction: '下载 APK'")
        .contains("androidRouteTurn: 'TURN 中继'")
        .contains("androidRouteTurn: 'TURN relay'")
        .contains("androidMetricDataChannelRtt: '输入 RTT (SCTP)'")
        .contains("androidMetricDataChannelRtt: 'Input RTT (SCTP)'")
        .contains("androidMetricInputToFrame: '点击→下一视频帧'")
        .contains("androidMetricInputToFrame: 'Click → next video frame'")
        .contains("androidMetricInputToVisualChange: '点击→首个画面变化帧'")
        .contains("androidMetricInputToVisualChange: 'Click → first visual change'")
        .contains("androidMetricInputToAppAck: '点击→APK 操作确认'")
        .contains("androidMetricInputToAppAck: 'Click → APK acknowledgement'")
        .contains("androidJitterBufferAverage: '区间抖动缓冲'")
        .contains("androidJitterBufferAverage: 'Interval jitter buffer'")
        .contains("androidFreezes: '冻结次数 / 总时长'")
        .contains("androidFreezes: 'Freezes / total duration'")
        .contains("androidFaultEntryHint: '可在右侧选择并注入故障，再到 APK 操作触发。Crash / ANR 仍需在 APK 内确认。'")
        .contains("faultKindLongTask: '长任务'")
        .contains("faultKindLongTask: 'Long task'")
        .contains("faultKindRenderOverload: '渲染过载'")
        .contains("faultKindRenderOverload: 'Render overload'")
        .contains("faultKindResourceError: '资源错误'")
        .contains("faultKindResourceError: 'Resource error'")
        .contains("game_asset_load_failure")
        .contains("parentClientFaultHintGameAsset");
  }

}
