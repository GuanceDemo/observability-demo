/* Derived from GuanceCloud/datakit-js commit f4369924d75375aa8322e95975b4938f10e16461; MIT license. */
;(function () {
  'use strict'

  var SCENE_ID = 'webgl-game'
  var GAME_VIEW_NAME = 'game/orbital-drift'
  var RENDER_OVERLOAD_DURATION_MS = 10000
  var RENDER_OVERLOAD_TARGET_FPS = 12
  var RENDER_OVERLOAD_FRAME_INTERVAL_MS =
    1000 / RENDER_OVERLOAD_TARGET_FPS
  var RENDER_OVERLOAD_CPU_BURST_MS = 65
  var RENDER_OVERLOAD_CPU_INTERVAL_MS = 250
  var RENDER_OVERLOAD_PARTICLE_INTERVAL_MS = 180
  var ASSET_LOAD_FAILURE_DURATION_MS = 10000
  var ASSET_LOAD_FAILURE_RETRY_MS = 5000
  var MISSING_SHIELD_TEXTURE_PATH =
    '/api/demo/game-assets/orbital-shield-texture.webp'
  var SCENE_API_PREFIX = window.location.pathname.startsWith('/selfheal')
    ? '/selfheal'
    : ''
  var BROWSER_SDK_ORIGINS = {
    guance: 'https://static.guance.com',
    truewatch: 'https://static.truewatch.com'
  }
  var query = new URLSearchParams(window.location.search)
  var requestedContext =
    query.get('context') === 'webgl2' ? 'webgl2' : 'webgl'
  var pluginEnabled = query.get('plugin') !== '0'
  var sampledOut = query.get('sampledOut') === '1'
  var sampling = query.get('sampling') || '4'
  if (['1', '2', '4', 'all'].indexOf(sampling) === -1) {
    sampling = '4'
  }
  var numericSampling = sampling === 'all' ? 'all' : Number(sampling)
  var entropyMode = query.get('entropy') === '1'
  var cacheDrawMethod = query.get('cacheDraw') === '1'
  var extraDrawCalls = Math.max(
    0,
    Math.min(240, Math.floor(Number(query.get('draws')) || 0))
  )
  var captureProfiles = {
    1: {
      targetFps: 2,
      interval: 500,
      cooldown: 50,
      quality: 0.35,
      maxCanvasSize: 800,
      maxEncodedBytes: 40000
    },
    2: {
      targetFps: 4,
      interval: 250,
      cooldown: 125,
      quality: 0.6,
      maxCanvasSize: 1280,
      maxEncodedBytes: 120000
    },
    4: {
      targetFps: 20,
      interval: 50,
      cooldown: 10,
      quality: 0.72,
      maxCanvasSize: 1280,
      maxEncodedBytes: 160000
    },
    all: {
      targetFps: 4,
      interval: 250,
      cooldown: 125,
      quality: 0.6,
      maxCanvasSize: 1280,
      maxEncodedBytes: 120000
    }
  }
  var captureProfile = captureProfiles[sampling] || captureProfiles[4]
  var language = query.get('lang') === 'en' ? 'en' : 'zh'
  var copyByLanguage = {
    zh: {
      title: 'ORBITAL DRIFT · WebGL 回放实验',
      intro: '持续 WebGL 绘制、碰撞粒子和动态负载，用来观察 Replay 的绘制驱动快照效果。',
      back: '返回 Demo 工作台', canvasLabel: 'WebGL 太空生存游戏', telemetry: 'Replay 遥测',
      drawCalls: '绘制调用', sceneObjects: '场景对象', replaySnapshots: 'Replay 快照',
      lastMutation: '最近变更', captureLatency: '采集延迟', captureCadence: '采集频率',
      session: '会话', lastSegment: '最近分片', gameControls: '游戏控制',
      particleBurst: '粒子爆发', resetRun: '重置游戏', replaySampling: 'Replay 采样',
      samplingLow: '低成本 · 2 FPS', samplingBalanced: '小流量验证 · 4 FPS',
      samplingHigh: '高帧率演示 · 20 FPS', samplingAll: '全部 2D 命令 · WebGL 4 FPS',
      samplingNote: '修改后会带 query 参数刷新页面。WebGL 始终走像素快照；FPS 是采集目标，不是游戏渲染帧率。',
      latestCapture: '最近采集', waitingDraw: '等待第一次 WebGL 绘制…',
      helpMove: '<kbd>WASD</kbd> / <kbd>方向键</kbd> 移动',
      helpShoot: '<kbd>Space</kbd> 发射', helpPause: '<kbd>P</kbd> 暂停',
      helpPointer: '移动鼠标控制飞船，按住指针连续发射',
      replayOn: 'Replay：开启', replayOff: 'Replay：关闭', pause: '暂停', resume: '继续',
      stressOn: '压力：开启', stressOff: '压力：关闭', paused: '已暂停',
      pausedDetail: '按 P 或点击继续', overloadTitle: '游戏渲染过载',
      overloadDetail: '粒子风暴持续约 10 秒；Replay 将记录连续掉帧、Long Task 与恢复过程。',
      assetFailureTitle: '护盾纹理加载失败',
      assetFailureDetail: '正在显示降级材质；约 5 秒后重试一次，约 10 秒后自动切换到内置备用材质。',
      rumDisabled: 'RUM 未启用', rumFailed: 'RUM 初始化失败', sdkUnavailable: 'SDK 不可用',
      pluginUnavailable: 'WebGL 插件不可用', starting: '启动中', recording: '录制中',
      stopped: '已停止', sampledOut: '未采样', webglUnavailable: 'WebGL 不可用'
    },
    en: {
      title: 'ORBITAL DRIFT · WebGL Replay Lab',
      intro: 'Continuous WebGL drawing, collision particles, and dynamic load demonstrate draw-driven Replay snapshots.',
      back: 'Back to Demo Workbench', canvasLabel: 'WebGL space survival game', telemetry: 'Replay telemetry',
      drawCalls: 'Draw calls', sceneObjects: 'Scene objects', replaySnapshots: 'Replay snapshots',
      lastMutation: 'Last mutation', captureLatency: 'Capture latency', captureCadence: 'Capture cadence',
      session: 'Session', lastSegment: 'Last segment', gameControls: 'Game controls',
      particleBurst: 'Particle burst', resetRun: 'Reset run', replaySampling: 'Replay sampling',
      samplingLow: 'Low cost · 2 FPS', samplingBalanced: 'Pilot validation · 4 FPS',
      samplingHigh: 'High-frame-rate demo · 20 FPS', samplingAll: 'All 2D commands · WebGL 4 FPS',
      samplingNote: 'Changing this option reloads the page with a query parameter. WebGL always uses pixel snapshots; FPS is the capture target, not render FPS.',
      latestCapture: 'Latest capture', waitingDraw: 'Waiting for the first WebGL draw…',
      helpMove: '<kbd>WASD</kbd> / <kbd>Arrow keys</kbd> move',
      helpShoot: '<kbd>Space</kbd> fire', helpPause: '<kbd>P</kbd> pause',
      helpPointer: 'Move the pointer to steer and hold it to keep firing',
      replayOn: 'Replay: on', replayOff: 'Replay: off', pause: 'Pause', resume: 'Resume',
      stressOn: 'Stress: on', stressOff: 'Stress: off', paused: 'PAUSED',
      pausedDetail: 'Press P or click to resume', overloadTitle: 'RENDER OVERLOAD',
      overloadDetail: 'A ten-second particle storm keeps capture windows open while Replay records dropped frames, Long Tasks, and recovery.',
      assetFailureTitle: 'SHIELD TEXTURE MISSING',
      assetFailureDetail: 'Degraded material is active. One retry runs near five seconds, then the built-in fallback recovers near ten seconds.',
      rumDisabled: 'RUM disabled', rumFailed: 'RUM init failed', sdkUnavailable: 'SDK unavailable',
      pluginUnavailable: 'WebGL plugin unavailable', starting: 'starting', recording: 'recording',
      stopped: 'stopped', sampledOut: 'sampled out', webglUnavailable: 'WebGL unavailable'
    }
  }
  var bootstrapState = (window.__ORBITAL_DRIFT_BOOTSTRAP__ = {
    applicationId: '',
    rumReady: false,
    statusKey: 'starting'
  })

  function text(key) {
    return copyByLanguage[language][key] || copyByLanguage.zh[key] || key
  }

  function applyLanguage(nextLanguage) {
    language = nextLanguage === 'en' ? 'en' : 'zh'
    document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN'
    document.title = text('title')
    document.querySelectorAll('[data-game-copy]').forEach(function (element) {
      element.textContent = text(element.dataset.gameCopy)
    })
    document.querySelectorAll('[data-game-html]').forEach(function (element) {
      element.innerHTML = text(element.dataset.gameHtml)
    })
    document.querySelectorAll('[data-game-aria]').forEach(function (element) {
      element.setAttribute('aria-label', text(element.dataset.gameAria))
    })
  }

  function postSceneMessage(type, payload) {
    if (window.parent === window) return
    window.parent.postMessage(
      {
        source: 'observability-demo-scene',
        version: 1,
        sceneId: SCENE_ID,
        type: type,
        payload: payload || {}
      },
      window.location.origin
    )
  }

  function loadBrowserSdk(origin, fileName, globalName) {
    if (window[globalName]) return Promise.resolve()
    var source = origin + '/browser-sdk/v3/' + fileName
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script')
      script.src = source
      script.async = true
      script.addEventListener('load', function () {
        if (window[globalName]) resolve()
        else reject(new Error(globalName + ' is unavailable after loading ' + source))
      }, { once: true })
      script.addEventListener('error', function () {
        reject(new Error('Failed to load ' + source))
      }, { once: true })
      document.head.appendChild(script)
    })
  }

  function setRumContext(name, value) {
    if (window.DATAFLUX_RUM && window.DATAFLUX_RUM.setGlobalContextProperty) {
      window.DATAFLUX_RUM.setGlobalContextProperty(name, value)
    }
  }

  async function initializeRum() {
    var response = await fetch(SCENE_API_PREFIX + '/api/demo/rum-config', { cache: 'no-store' })
    if (!response.ok) throw new Error('RUM config HTTP ' + response.status)
    var config = await response.json()
    bootstrapState.applicationId = config.applicationId || ''
    if (!config.enabled || !config.applicationId) {
      bootstrapState.statusKey = 'rumDisabled'
      postSceneMessage('rum-status', { status: 'disabled' })
      return
    }

    var provider = config.datakitProvider === 'truewatch' ? 'truewatch' : 'guance'
    var origin = BROWSER_SDK_ORIGINS[provider]
    await loadBrowserSdk(origin, 'dataflux-rum.js', 'DATAFLUX_RUM')
    if (pluginEnabled) {
      await loadBrowserSdk(origin, 'dataflux-rum-webgl.js', 'DATAFLUX_RUM_WEBGL')
    }
    if (!window.DATAFLUX_RUM) throw new Error(text('sdkUnavailable'))
    if (pluginEnabled &&
        (!window.DATAFLUX_RUM_WEBGL ||
          typeof window.DATAFLUX_RUM_WEBGL.webglReplayPlugin !== 'function')) {
      throw new Error(text('pluginUnavailable'))
    }

    var service = config.gameService || 'mall-game-h5'
    var autoInterval = captureProfile.interval
    window.DATAFLUX_RUM.init({
      applicationId: config.applicationId,
      datakitOrigin: config.datakitOrigin || undefined,
      service: service,
      env: config.env || 'demo',
      version: config.version || '1.0.0',
      plugins: pluginEnabled
        ? [window.DATAFLUX_RUM_WEBGL.webglReplayPlugin()]
        : [],
      sessionSampleRate: config.sessionSampleRate == null ? 100 : config.sessionSampleRate,
      sessionReplaySampleRate: sampledOut
        ? 0
        : (config.sessionReplaySampleRate == null ? 100 : config.sessionReplaySampleRate),
      sessionReplayOnErrorSampleRate: config.sessionReplayOnErrorSampleRate == null
        ? 100
        : config.sessionReplayOnErrorSampleRate,
      sessionPersistence: 'local-storage',
      trackViewsManually: true,
      defaultPrivacyLevel: 'mask-user-input',
      replayCanvasEnabled: true,
      replayCanvasMode: 'auto',
      replayCanvasSampling: numericSampling,
      replayCanvasMimeType: 'image/webp',
      replayCanvasQuality: captureProfile.quality,
      replayCanvasMaxCanvasSize: captureProfile.maxCanvasSize,
      replayCanvasMaxEncodedBytes: captureProfile.maxEncodedBytes,
      replayCanvasMaxConcurrentEncodes: 1,
      replayCanvasAutoInterval: autoInterval,
      replayCanvasAutoCooldown: captureProfile.cooldown,
      replayCanvasAutoUnchangedBackoff: Math.max(autoInterval * 2, 1000),
      replayCanvasAutoFailureBackoff: Math.max(autoInterval * 4, 3000),
      replayCanvasAutoMaxPerRun: 1,
      compressIntakeRequests: config.compressIntakeRequests !== false,
      trackInteractions: true,
      trackResources: true,
      trackLongTasks: true,
      traceType: config.traceType || 'ddtrace',
      allowedTracingOrigins: [window.location.origin]
    })
    if (!sampledOut && window.DATAFLUX_RUM.startSessionReplayRecording) {
      window.DATAFLUX_RUM.startSessionReplayRecording()
    }
    setRumContext('project', config.project || 'mall-demo')
    setRumContext('business_scene', SCENE_ID)
    setRumContext('preview_mode', 'web')
    setRumContext('page', 'game')
    if (window.DATAFLUX_RUM.startView) {
      window.DATAFLUX_RUM.startView({ name: GAME_VIEW_NAME })
    }
    bootstrapState.rumReady = true
    bootstrapState.statusKey = sampledOut ? 'sampledOut' : 'starting'
    postSceneMessage('rum-status', {
      status: sampledOut ? 'sampled-out' : 'ready',
      service: service,
      env: config.env || 'demo',
      version: config.version || '1.0.0'
    })
  }

  async function bootstrap() {
    document.documentElement.dataset.embedded = query.get('embedded') === '1' ? 'true' : 'false'
    applyLanguage(language)
    try {
      await initializeRum()
    } catch (error) {
      bootstrapState.rumError = error && error.message ? error.message : String(error)
      bootstrapState.statusKey =
        bootstrapState.rumError.indexOf('DATAFLUX_RUM_WEBGL') !== -1 ||
        bootstrapState.rumError.indexOf('dataflux-rum-webgl.js') !== -1 ||
        bootstrapState.rumError === text('pluginUnavailable')
          ? 'pluginUnavailable'
          : bootstrapState.rumError.indexOf('DATAFLUX_RUM') !== -1 ||
              bootstrapState.rumError.indexOf('dataflux-rum.js') !== -1 ||
              bootstrapState.rumError === text('sdkUnavailable')
            ? 'sdkUnavailable'
            : 'rumFailed'
      postSceneMessage('rum-status', { status: 'failed', message: bootstrapState.rumError })
      postSceneMessage('scene-log', { status: 'error', message: bootstrapState.rumError })
    }
    startGame()
  }

  function startGame() {
  var canvas = document.getElementById('game-canvas')
  var scoreElement = document.getElementById('score')
  var shieldElement = document.getElementById('shield')
  var waveElement = document.getElementById('wave')
  var gameFpsElement = document.getElementById('game-fps')
  var messageElement = document.getElementById('game-message')
  var messageTitleElement = document.getElementById('game-message-title')
  var messageDetailElement = document.getElementById('game-message-detail')
  var replayButton = document.getElementById('replay-button')
  var pauseButton = document.getElementById('pause-button')
  var stressButton = document.getElementById('stress-button')
  var burstButton = document.getElementById('burst-button')
  var resetButton = document.getElementById('reset-button')
  var samplingSelect = document.getElementById('sampling-select')
  var captureOutput = document.getElementById('capture-output')
  var metricWebGL = document.getElementById('metric-webgl')
  var metricFps = document.getElementById('metric-fps')
  var metricDraws = document.getElementById('metric-draws')
  var metricObjects = document.getElementById('metric-objects')
  var metricSnapshots = document.getElementById('metric-snapshots')
  var metricBytes = document.getElementById('metric-bytes')
  var metricLatency = document.getElementById('metric-latency')
  var metricScheduler = document.getElementById('metric-scheduler')
  var metricSession = document.getElementById('metric-session')
  var metricSegment = document.getElementById('metric-segment')
  var recordingStatus = document.getElementById('recording-status')
  var replayDot = document.getElementById('replay-dot')
  var destroyed = false
  var renderOverloadActive = false
  var renderOverloadPending = false
  var renderOverloadGeneration = 0
  var renderOverloadScenario
  var renderOverloadTriggerId = ''
  var renderOverloadTriggeredAt = 0
  var renderOverloadStartedAt = 0
  var renderOverloadEndsAt = 0
  var renderOverloadNextCpuAt = 0
  var renderOverloadNextParticleAt = 0
  var renderOverloadNextFrameAt = 0
  var renderOverloadRenderedFrames = 0
  var renderOverloadDroppedFrames = 0
  var renderOverloadCpuBursts = 0
  var renderOverloadPeakParticles = 0
  var assetLoadFailureActive = false
  var assetLoadFailureGeneration = 0
  var assetLoadFailureScenario
  var assetLoadFailureTriggerId = ''
  var assetLoadFailureTriggeredAt = 0
  var assetLoadFailureStartedAt = 0
  var assetLoadFailureAttempts = 0
  var assetLoadFailureLastStatus = 0
  var assetLoadFailureRetryTimer
  var assetLoadFailureRecoveryTimer
  var replayEnabled = Boolean(window.DATAFLUX_RUM && !sampledOut)
  var paused = false
  var stressMode = query.get('stress') === '1'
  var pointerDown = false
  var pointerInsideCanvas = false
  var keys = {}
  var frameHandle
  var telemetryTimer
  var lastFrameAt = performance.now()
  var fpsWindowStartedAt = lastFrameAt
  var framesInWindow = 0
  var drawsInWindow = 0
  var lastShotAt = 0
  var knownSnapshotKeys = Object.create(null)
  var knownSnapshotKeyQueue = []
  var maxKnownSnapshotKeys = 500
  var replaySnapshotStartedAts = []
  var totalReplaySnapshots = 0
  var lastReplaySnapshot
  var lastCanvasMutation
  var score = 0
  var shield = 100
  var wave = 1
  var nextWaveScore = 1200

  var diagnostics = (window.__webglReplayGame = {
    ready: false,
    webglAvailable: false,
    preserveDrawingBuffer: undefined,
    sampling: numericSampling,
    captureProfile: captureProfile,
    stressMode: stressMode,
    entropyMode: entropyMode,
    cacheDrawMethod: cacheDrawMethod,
    extraDrawCalls: extraDrawCalls,
    contextType: requestedContext,
    pluginEnabled: pluginEnabled,
    sampledOut: sampledOut,
    replaySnapshots: 0,
    pointerInsideCanvas: false,
    renderOverloadActive: false,
    lastRenderOverload: undefined,
    assetLoadFailureActive: false,
    lastAssetLoadFailure: undefined,
    lastSnapshot: undefined,
    lastMutation: undefined,
    errors: []
  })

  function recordError(error) {
    var message = error && error.message ? error.message : String(error)
    diagnostics.errors.push(message)
    captureOutput.textContent = 'ERROR\n' + message
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value))
  }

  function randomBetween(min, max) {
    return min + Math.random() * (max - min)
  }

  function formatBytes(bytes) {
    if (typeof bytes !== 'number') {
      return 'none'
    }
    if (bytes < 1024) {
      return bytes + ' B'
    }
    return (bytes / 1024).toFixed(1) + ' KiB'
  }

  recordingStatus.textContent = text(bootstrapState.statusKey)
  replayButton.disabled = !window.DATAFLUX_RUM || sampledOut
  replayButton.textContent = text(replayEnabled ? 'replayOn' : 'replayOff')

  function currentRumCorrelation() {
    var internalContext =
      window.DATAFLUX_RUM &&
      typeof window.DATAFLUX_RUM.getInternalContext === 'function'
        ? window.DATAFLUX_RUM.getInternalContext()
        : undefined
    return {
      applicationId: bootstrapState.applicationId || '',
      sessionId:
        internalContext && internalContext.session
          ? internalContext.session.id || ''
          : '',
      viewId:
        internalContext && internalContext.view
          ? internalContext.view.id || ''
          : ''
    }
  }

  function postFaultStarted(scenario, action, triggerId, triggeredAt) {
    if (!bootstrapState.rumReady) return
    postSceneMessage('fault-started', Object.assign({
      scenario: scenario,
      action: action,
      triggerId: triggerId,
      triggeredAt: triggeredAt
    }, currentRumCorrelation()))
  }

  function addRumAction(name, context) {
    if (
      window.DATAFLUX_RUM &&
      typeof window.DATAFLUX_RUM.addAction === 'function'
    ) {
      window.DATAFLUX_RUM.addAction(name, context)
    }
  }

  function addRumError(error, context) {
    if (
      window.DATAFLUX_RUM &&
      typeof window.DATAFLUX_RUM.addError === 'function'
    ) {
      try {
        window.DATAFLUX_RUM.addError(error, context)
      } catch (rumError) {
        recordError(rumError)
      }
    }
  }

  function renderDynamicCopy() {
    replayButton.textContent = text(replayEnabled ? 'replayOn' : 'replayOff')
    pauseButton.textContent = text(paused ? 'resume' : 'pause')
    stressButton.textContent = text(stressMode ? 'stressOn' : 'stressOff')
    var statusKey =
      !bootstrapState.rumReady || sampledOut
        ? bootstrapState.statusKey
        : replayEnabled
          ? bootstrapState.statusKey
          : 'stopped'
    recordingStatus.textContent = text(statusKey)
    messageElement.classList.remove('is-overload', 'is-asset-failure')
    if (assetLoadFailureActive) {
      messageElement.classList.add('is-asset-failure')
      messageElement.hidden = false
      messageTitleElement.textContent = text('assetFailureTitle')
      messageDetailElement.textContent = text('assetFailureDetail')
    } else if (renderOverloadActive || renderOverloadPending) {
      messageElement.classList.add('is-overload')
      messageElement.hidden = false
      messageTitleElement.textContent = text('overloadTitle')
      messageDetailElement.textContent = text('overloadDetail')
    } else if (paused) {
      messageElement.hidden = false
      messageTitleElement.textContent = text('paused')
      messageDetailElement.textContent = text('pausedDetail')
    } else {
      messageElement.hidden = true
    }
  }

  function clearAssetLoadFailureTimers() {
    if (assetLoadFailureRetryTimer) {
      window.clearTimeout(assetLoadFailureRetryTimer)
      assetLoadFailureRetryTimer = undefined
    }
    if (assetLoadFailureRecoveryTimer) {
      window.clearTimeout(assetLoadFailureRecoveryTimer)
      assetLoadFailureRecoveryTimer = undefined
    }
  }

  function assetLoadFailureContext(reason, elapsedMs) {
    return {
      fault_id: 'game_asset_load_failure',
      fault_layer: 'frontend',
      fault_kind: 'resource_error',
      duration_ms: elapsedMs,
      attempts: assetLoadFailureAttempts,
      http_status: assetLoadFailureLastStatus,
      resource_url: MISSING_SHIELD_TEXTURE_PATH,
      fallback_material: 'procedural-shield-v1',
      recovery_reason: reason,
      trigger_id: assetLoadFailureTriggerId
    }
  }

  function finishAssetLoadFailure(reason, reportToParent) {
    if (!assetLoadFailureActive) return
    clearAssetLoadFailureTimers()
    var elapsedMs = Math.max(
      1,
      Math.round(performance.now() - assetLoadFailureStartedAt)
    )
    var scenario = assetLoadFailureScenario || {
      id: 'game_asset_load_failure'
    }
    var actionContext = assetLoadFailureContext(reason, elapsedMs)
    addRumAction('game_asset_fallback_recovered', actionContext)
    diagnostics.lastAssetLoadFailure = actionContext
    diagnostics.assetLoadFailureActive = false
    assetLoadFailureActive = false
    renderDynamicCopy()

    if (reportToParent) {
      postSceneMessage('fault-triggered', Object.assign({
        scenario: scenario,
        action: 'game_asset_load_failure',
        triggerId: assetLoadFailureTriggerId,
        triggeredAt: assetLoadFailureTriggeredAt,
        elapsedMs: elapsedMs,
        attempts: assetLoadFailureAttempts,
        httpStatus: assetLoadFailureLastStatus,
        resourceUrl: MISSING_SHIELD_TEXTURE_PATH,
        fallbackMaterial: 'procedural-shield-v1',
        recoveryReason: reason
      }, currentRumCorrelation()))
      postSceneMessage('scene-log', {
        title: text('assetFailureTitle'),
        status: 'info',
        message:
          'HTTP ' + assetLoadFailureLastStatus +
          ' · attempts ' + assetLoadFailureAttempts +
          ' · fallback procedural-shield-v1'
      })
    }
  }

  function missingShieldTextureUrl(triggerId, attempt) {
    var url = new URL(
      SCENE_API_PREFIX + MISSING_SHIELD_TEXTURE_PATH,
      window.location.origin
    )
    url.searchParams.set('triggerId', triggerId)
    url.searchParams.set('attempt', String(attempt))
    return url.pathname + url.search
  }

  async function requestMissingShieldTexture(generation, attempt) {
    if (
      destroyed ||
      !assetLoadFailureActive ||
      generation !== assetLoadFailureGeneration
    ) {
      return
    }
    assetLoadFailureAttempts = attempt
    var resourceUrl = missingShieldTextureUrl(
      assetLoadFailureTriggerId,
      attempt
    )
    var response
    var requestError
    try {
      response = await fetch(resourceUrl, { cache: 'no-store' })
      assetLoadFailureLastStatus = response.status
      requestError = new Error(
        'Orbital shield texture failed to load: HTTP ' + response.status
      )
      requestError.name = 'GameAssetLoadError'
    } catch (error) {
      assetLoadFailureLastStatus = 0
      requestError = error
    }
    if (
      destroyed ||
      !assetLoadFailureActive ||
      generation !== assetLoadFailureGeneration
    ) {
      return
    }
    var actionContext = {
      fault_id: 'game_asset_load_failure',
      fault_layer: 'frontend',
      fault_kind: 'resource_error',
      attempt: attempt,
      http_status: assetLoadFailureLastStatus,
      resource_url: MISSING_SHIELD_TEXTURE_PATH,
      trigger_id: assetLoadFailureTriggerId
    }
    if (attempt === 1) {
      addRumAction('game_asset_load_failed', actionContext)
      addRumError(requestError, actionContext)
      postFaultStarted(
        assetLoadFailureScenario || { id: 'game_asset_load_failure' },
        'game_asset_load_failed',
        assetLoadFailureTriggerId,
        assetLoadFailureTriggeredAt
      )
    } else {
      addRumAction('game_asset_load_retry', actionContext)
    }
    diagnostics.assetLoadFailureAttempts = assetLoadFailureAttempts
    diagnostics.assetLoadFailureLastStatus = assetLoadFailureLastStatus
  }

  function triggerAssetLoadFailure(scenario) {
    if (assetLoadFailureActive) {
      finishAssetLoadFailure('restarted', false)
    }
    renderOverloadGeneration += 1
    renderOverloadPending = false
    if (renderOverloadActive) {
      finishRenderOverload('replaced', false)
    }
    assetLoadFailureGeneration += 1
    var generation = assetLoadFailureGeneration
    assetLoadFailureActive = true
    assetLoadFailureScenario = scenario || {
      id: 'game_asset_load_failure'
    }
    assetLoadFailureTriggerId =
      window.crypto && typeof window.crypto.randomUUID === 'function'
        ? window.crypto.randomUUID()
        : 'asset-' + Date.now() + '-' + Math.random().toString(16).slice(2)
    assetLoadFailureTriggeredAt = Date.now()
    assetLoadFailureStartedAt = performance.now()
    assetLoadFailureAttempts = 0
    assetLoadFailureLastStatus = 0
    diagnostics.assetLoadFailureActive = true
    diagnostics.assetLoadFailureAttempts = 0
    diagnostics.assetLoadFailureLastStatus = 0
    spawnBurst(player.x, player.y, 72, [1, 0.28, 0.66])
    renderDynamicCopy()
    postSceneMessage('scene-log', {
      title: text('assetFailureTitle'),
      status: 'warn',
      message: text('assetFailureDetail')
    })
    requestMissingShieldTexture(generation, 1)
    assetLoadFailureRetryTimer = window.setTimeout(function () {
      requestMissingShieldTexture(generation, 2)
    }, ASSET_LOAD_FAILURE_RETRY_MS)
    assetLoadFailureRecoveryTimer = window.setTimeout(function () {
      if (
        assetLoadFailureActive &&
        generation === assetLoadFailureGeneration
      ) {
        finishAssetLoadFailure('fallback_loaded', true)
      }
    }, ASSET_LOAD_FAILURE_DURATION_MS)
  }

  function renderOverloadActionContext(reason, elapsedMs, actualFps) {
    return {
      fault_id: 'game_render_overload',
      fault_layer: 'frontend',
      duration_ms: elapsedMs,
      target_fps: RENDER_OVERLOAD_TARGET_FPS,
      actual_fps: actualFps,
      dropped_frames: renderOverloadDroppedFrames,
      particle_peak: renderOverloadPeakParticles,
      cpu_bursts: renderOverloadCpuBursts,
      recovery_reason: reason,
      trigger_id: renderOverloadTriggerId
    }
  }

  function finishRenderOverload(reason, reportToParent) {
    if (!renderOverloadActive) return
    var completedAt = performance.now()
    var elapsedMs = Math.max(
      1,
      Math.round(completedAt - renderOverloadStartedAt)
    )
    var actualFps = Number(
      ((renderOverloadRenderedFrames * 1000) / elapsedMs).toFixed(1)
    )
    var scenario = renderOverloadScenario || { id: 'game_render_overload' }
    var actionContext = renderOverloadActionContext(
      reason,
      elapsedMs,
      actualFps
    )
    addRumAction('game_render_overload_recovered', actionContext)
    diagnostics.lastRenderOverload = actionContext
    diagnostics.renderOverloadActive = false
    renderOverloadActive = false
    renderOverloadPending = false
    gameFpsElement.classList.remove('is-overloaded')
    setSceneLoad()
    renderDynamicCopy()

    if (reportToParent) {
      postSceneMessage('fault-triggered', Object.assign({
        scenario: scenario,
        action: 'game_render_overload',
        triggerId: renderOverloadTriggerId,
        triggeredAt: renderOverloadTriggeredAt,
        elapsedMs: elapsedMs,
        actualFps: actualFps,
        droppedFrames: renderOverloadDroppedFrames,
        particlePeak: renderOverloadPeakParticles,
        cpuBursts: renderOverloadCpuBursts,
        recoveryReason: reason
      }, currentRumCorrelation()))
      postSceneMessage('scene-log', {
        title: text('overloadTitle'),
        status: 'info',
        message:
          'FPS ' + actualFps +
          ' · dropped ' + renderOverloadDroppedFrames +
          ' · Long Tasks ' + renderOverloadCpuBursts
      })
    }
  }

  function burnRenderOverloadCpu() {
    var startedAt = performance.now()
    var accumulator = 0
    while (performance.now() - startedAt < RENDER_OVERLOAD_CPU_BURST_MS) {
      accumulator = (accumulator + Math.sqrt(accumulator + 17.3)) % 9973
    }
    diagnostics.overloadAccumulator = accumulator
  }

  function updateRenderOverload(now) {
    if (!renderOverloadActive) return now
    if (now >= renderOverloadEndsAt) {
      finishRenderOverload('completed', true)
      return performance.now()
    }
    if (now >= renderOverloadNextParticleAt) {
      spawnBurst(
        randomBetween(-0.72, 0.72),
        randomBetween(-0.35, 0.72),
        58,
        [1, 0.42, 0.3]
      )
      spawnBurst(
        randomBetween(-0.72, 0.72),
        randomBetween(-0.35, 0.72),
        46,
        [0.45, 0.82, 1]
      )
      renderOverloadPeakParticles = Math.max(
        renderOverloadPeakParticles,
        particles.length
      )
      renderOverloadNextParticleAt =
        now + RENDER_OVERLOAD_PARTICLE_INTERVAL_MS
    }
    if (now >= renderOverloadNextCpuAt) {
      burnRenderOverloadCpu()
      renderOverloadCpuBursts += 1
      renderOverloadNextCpuAt =
        now + RENDER_OVERLOAD_CPU_INTERVAL_MS
    }
    return performance.now()
  }

  function startRenderOverload(scenario, generation, triggerId) {
    if (destroyed || generation !== renderOverloadGeneration) return
    var startedAt = performance.now()
    renderOverloadPending = false
    renderOverloadActive = true
    renderOverloadScenario = scenario || { id: 'game_render_overload' }
    renderOverloadTriggerId = triggerId
    renderOverloadTriggeredAt = Date.now()
    renderOverloadStartedAt = startedAt
    renderOverloadEndsAt = startedAt + RENDER_OVERLOAD_DURATION_MS
    renderOverloadNextCpuAt = startedAt
    renderOverloadNextParticleAt = startedAt
    renderOverloadNextFrameAt = startedAt
    renderOverloadRenderedFrames = 0
    renderOverloadDroppedFrames = 0
    renderOverloadCpuBursts = 0
    renderOverloadPeakParticles = particles.length
    diagnostics.renderOverloadActive = true
    gameFpsElement.classList.add('is-overloaded')
    addRumAction('game_render_overload_started', {
      fault_id: 'game_render_overload',
      fault_layer: 'frontend',
      duration_ms: RENDER_OVERLOAD_DURATION_MS,
      target_fps: RENDER_OVERLOAD_TARGET_FPS,
      cpu_burst_ms: RENDER_OVERLOAD_CPU_BURST_MS,
      cpu_interval_ms: RENDER_OVERLOAD_CPU_INTERVAL_MS,
      trigger_id: renderOverloadTriggerId
    })
    postFaultStarted(
      renderOverloadScenario,
      'game_render_overload_started',
      renderOverloadTriggerId,
      renderOverloadTriggeredAt
    )
    setSceneLoad()
    renderDynamicCopy()
  }

  function triggerRenderOverload(scenario) {
    assetLoadFailureGeneration += 1
    if (assetLoadFailureActive) {
      finishAssetLoadFailure('replaced', false)
    }
    if (renderOverloadActive) {
      finishRenderOverload('restarted', false)
    }
    renderOverloadGeneration += 1
    var generation = renderOverloadGeneration
    renderOverloadPending = true
    var triggerId =
      window.crypto && typeof window.crypto.randomUUID === 'function'
        ? window.crypto.randomUUID()
        : 'overload-' + Date.now() + '-' + Math.random().toString(16).slice(2)
    renderDynamicCopy()
    postSceneMessage('scene-log', {
      title: text('overloadTitle'),
      status: 'warn',
      message: text('overloadDetail')
    })

    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        startRenderOverload(scenario, generation, triggerId)
      })
    })
  }

  function focusGameCanvas() {
    if (destroyed || document.visibilityState === 'hidden') return
    canvas.focus({ preventScroll: true })
  }

  function handleParentMessage(event) {
    if (event.origin !== window.location.origin || event.source !== window.parent) {
      return
    }
    var data = event.data || {}
    if (
      data.source !== 'observability-demo-parent' ||
      data.version !== 1 ||
      data.sceneId !== SCENE_ID
    ) {
      return
    }
    var payload = data.payload || {}
    if (data.type === 'set-language') {
      applyLanguage(payload.language)
      renderDynamicCopy()
    } else if (data.type === 'set-preview-context') {
      setRumContext('business_scene', payload.sceneId || SCENE_ID)
      setRumContext('preview_mode', payload.view || 'web')
    } else if (data.type === 'focus-scene-controls') {
      focusGameCanvas()
    } else if (data.type === 'set-client-fault' && payload.scenario) {
      if (payload.scenario.id === 'game_render_overload') {
        triggerRenderOverload(payload.scenario)
      } else if (payload.scenario.id === 'game_asset_load_failure') {
        triggerAssetLoadFailure(payload.scenario)
      }
    } else if (data.type === 'clear-client-fault') {
      assetLoadFailureGeneration += 1
      if (assetLoadFailureActive) {
        finishAssetLoadFailure('cleared', false)
      }
      renderOverloadGeneration += 1
      renderOverloadPending = false
      if (renderOverloadActive) {
        finishRenderOverload('cleared', false)
      } else {
        renderDynamicCopy()
      }
    }
  }

  window.addEventListener('message', handleParentMessage)

  var gl = canvas.getContext(requestedContext, {
    alpha: false,
    antialias: true,
    depth: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance'
  })

  diagnostics.webglAvailable = !!gl
  if (!gl) {
    metricWebGL.textContent = text('webglUnavailable')
    recordingStatus.textContent = text('webglUnavailable')
    recordError(
      new Error(
        'This browser does not expose a ' + requestedContext + ' context.'
      )
    )
    diagnostics.ready = true
    postSceneMessage('scene-ready', {
      language: language,
      view: 'web',
      webglAvailable: false,
      rumReady: bootstrapState.rumReady,
      rum: currentRumCorrelation()
    })
    return
  }

  diagnostics.preserveDrawingBuffer =
    gl.getContextAttributes().preserveDrawingBuffer
  // Cocos-style engines commonly cache WebGL methods during engine boot,
  // before the asynchronous Replay recorder is ready.  The optional plugin
  // installs its bootstrap hook synchronously from RUM init(), so deliberately
  // cache the method now instead of waiting for isRecording().
  var cachedDrawArrays = cacheDrawMethod
    ? gl.drawArrays.bind(gl)
    : undefined
  diagnostics.drawMethodCached = Boolean(cachedDrawArrays)

  function updateWebGLMetric() {
    metricWebGL.textContent =
      (requestedContext === 'webgl2' ? 'WebGL 2' : 'WebGL 1') +
      ' · preserve=' +
      diagnostics.preserveDrawingBuffer +
      (cacheDrawMethod
        ? diagnostics.drawMethodCached
          ? ' · cached drawArrays during boot'
          : ' · draw cache unavailable'
        : '') +
      (extraDrawCalls ? ' · +' + extraDrawCalls + ' draws/frame' : '')
  }

  function invokeDrawArrays() {
    return cachedDrawArrays
      ? cachedDrawArrays.apply(undefined, arguments)
      : gl.drawArrays.apply(gl, arguments)
  }

  updateWebGLMetric()

  var isWebGL2 = requestedContext === 'webgl2'
  var shaderVersion = isWebGL2 ? '#version 300 es' : ''
  var vertexInput = isWebGL2 ? 'in' : 'attribute'
  var vertexOutput = isWebGL2 ? 'out' : 'varying'
  var fragmentInput = isWebGL2 ? 'in' : 'varying'
  var fragmentOutput = isWebGL2 ? 'out vec4 replayColor;' : ''
  var fragmentColor = isWebGL2 ? 'replayColor' : 'gl_FragColor'

  var backgroundVertexShader = [
    shaderVersion,
    vertexInput + ' vec2 a_position;',
    vertexOutput + ' vec2 v_uv;',
    'void main() {',
    '  v_uv = a_position * 0.5 + 0.5;',
    '  gl_Position = vec4(a_position, 0.0, 1.0);',
    '}'
  ].join('\n')
  var backgroundFragmentShader = [
    shaderVersion,
    'precision mediump float;',
    fragmentInput + ' vec2 v_uv;',
    fragmentOutput,
    'uniform float u_time;',
    'uniform vec2 u_resolution;',
    'uniform float u_entropy;',
    'float hash(vec2 point) {',
    '  return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453);',
    '}',
    'void main() {',
    '  vec2 uv = v_uv;',
    '  vec2 centered = uv - 0.5;',
    '  centered.x *= u_resolution.x / max(u_resolution.y, 1.0);',
    '  float nebula = sin(centered.x * 4.5 + u_time * 0.09);',
    '  nebula += sin(centered.y * 7.0 - u_time * 0.07);',
    '  nebula += sin((centered.x + centered.y) * 9.0);',
    '  nebula = smoothstep(0.7, 2.7, nebula + 1.5);',
    '  vec3 base = mix(vec3(0.012, 0.018, 0.07), vec3(0.12, 0.04, 0.24), nebula);',
    '  float grain = hash(floor(gl_FragCoord.xy * 0.33) + floor(u_time * 0.5));',
    '  base += (grain - 0.5) * 0.018;',
    '  if (u_entropy > 0.5) {',
    '    vec2 noiseCell = floor(gl_FragCoord.xy / 6.0) + floor(u_time * 8.0);',
    '    vec3 noiseColor = vec3(',
    '      hash(noiseCell),',
    '      hash(noiseCell + vec2(19.0, 7.0)),',
    '      hash(noiseCell + vec2(3.0, 29.0))',
    '    );',
    '    base = mix(base, noiseColor, 0.88);',
    '  }',
    '  float glow = 0.12 / max(length(centered - vec2(0.32, 0.12)), 0.08);',
    '  base += vec3(0.03, 0.12, 0.18) * glow;',
    '  ' + fragmentColor + ' = vec4(base, 1.0);',
    '}'
  ].join('\n')
  var spriteVertexShader = [
    shaderVersion,
    vertexInput + ' vec2 a_position;',
    vertexInput + ' float a_size;',
    vertexInput + ' vec4 a_color;',
    'uniform float u_pixel_ratio;',
    vertexOutput + ' vec4 v_color;',
    'void main() {',
    '  gl_Position = vec4(a_position, 0.0, 1.0);',
    '  gl_PointSize = max(1.0, a_size * u_pixel_ratio);',
    '  v_color = a_color;',
    '}'
  ].join('\n')
  var spriteFragmentShader = [
    shaderVersion,
    'precision mediump float;',
    fragmentInput + ' vec4 v_color;',
    fragmentOutput,
    'uniform float u_shape;',
    'void main() {',
    '  vec2 point = gl_PointCoord * 2.0 - 1.0;',
    '  float distanceToCenter = length(point);',
    '  float alpha = 1.0;',
    '  if (u_shape < 0.5) {',
    '    alpha = smoothstep(1.0, 0.0, distanceToCenter);',
    '    alpha *= alpha;',
    '  } else if (u_shape < 1.5) {',
    '    float angle = atan(point.y, point.x);',
    '    float edge = 0.78 + 0.10 * sin(angle * 7.0 + v_color.a * 11.0);',
    '    alpha = 1.0 - smoothstep(edge - 0.06, edge, distanceToCenter);',
    '  } else if (u_shape < 2.5) {',
    '    alpha = smoothstep(1.0, 0.0, distanceToCenter);',
    '    alpha = pow(alpha, 2.0);',
    '  } else if (u_shape < 3.5) {',
    '    alpha = smoothstep(1.0, 0.1, distanceToCenter) * v_color.a;',
    '  } else {',
    '    float body = step(abs(point.x), (point.y + 1.0) * 0.42);',
    '    body *= step(point.y, 0.82);',
    '    float engine = smoothstep(0.42, 0.0, length(point - vec2(0.0, 0.72)));',
    '    alpha = max(body, engine * 0.75);',
    '  }',
    '  if (alpha < 0.01) discard;',
    '  ' + fragmentColor + ' = vec4(v_color.rgb, alpha);',
    '}'
  ].join('\n')

  function compileShader(type, source) {
    var shader = gl.createShader(type)
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      var info = gl.getShaderInfoLog(shader)
      gl.deleteShader(shader)
      throw new Error('Shader compilation failed: ' + info)
    }
    return shader
  }

  function createProgram(vertexSource, fragmentSource) {
    var program = gl.createProgram()
    var vertexShader = compileShader(gl.VERTEX_SHADER, vertexSource)
    var fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentSource)
    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)
    gl.deleteShader(vertexShader)
    gl.deleteShader(fragmentShader)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      var info = gl.getProgramInfoLog(program)
      gl.deleteProgram(program)
      throw new Error('Program link failed: ' + info)
    }
    return program
  }

  var backgroundProgram
  var spriteProgram
  try {
    backgroundProgram = createProgram(
      backgroundVertexShader,
      backgroundFragmentShader
    )
    spriteProgram = createProgram(spriteVertexShader, spriteFragmentShader)
  } catch (error) {
    recordError(error)
    return
  }

  var backgroundBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, backgroundBuffer)
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW
  )
  var spriteBuffer = gl.createBuffer()
  var backgroundPositionLocation = gl.getAttribLocation(
    backgroundProgram,
    'a_position'
  )
  var backgroundTimeLocation = gl.getUniformLocation(backgroundProgram, 'u_time')
  var backgroundResolutionLocation = gl.getUniformLocation(
    backgroundProgram,
    'u_resolution'
  )
  var backgroundEntropyLocation = gl.getUniformLocation(
    backgroundProgram,
    'u_entropy'
  )
  var spritePositionLocation = gl.getAttribLocation(spriteProgram, 'a_position')
  var spriteSizeLocation = gl.getAttribLocation(spriteProgram, 'a_size')
  var spriteColorLocation = gl.getAttribLocation(spriteProgram, 'a_color')
  var spritePixelRatioLocation = gl.getUniformLocation(
    spriteProgram,
    'u_pixel_ratio'
  )
  var spriteShapeLocation = gl.getUniformLocation(spriteProgram, 'u_shape')

  var player = {
    x: 0,
    y: -0.68,
    vx: 0,
    vy: 0,
    targetX: 0,
    targetY: -0.68,
    size: 34
  }
  var stars = []
  var asteroids = []
  var bullets = []
  var particles = []
  var spriteVertexData = new Float32Array(0)
  var playerBatch = [player]

  function getReusableVertexData(length) {
    if (spriteVertexData.length < length) {
      var capacity = Math.max(spriteVertexData.length || 256, 256)
      while (capacity < length) {
        capacity *= 2
      }
      spriteVertexData = new Float32Array(capacity)
    }
    return spriteVertexData.subarray(0, length)
  }

  function createStar() {
    return {
      x: randomBetween(-1, 1),
      y: randomBetween(-1, 1),
      size: randomBetween(1, 3.8),
      speed: randomBetween(0.018, 0.08),
      alpha: randomBetween(0.25, 0.95)
    }
  }

  function resetAsteroid(asteroid, startAbove) {
    var highLoad = stressMode || renderOverloadActive
    var radius = randomBetween(0.025, highLoad ? 0.065 : 0.085)
    asteroid.x = randomBetween(-0.94, 0.94)
    asteroid.y = startAbove
      ? randomBetween(1.05, 2.4)
      : randomBetween(-1, 1)
    asteroid.vx = randomBetween(-0.06, 0.06)
    asteroid.vy = -randomBetween(0.07, 0.18) - wave * 0.004
    asteroid.radius = radius
    asteroid.size = radius * 430
    asteroid.seed = Math.random()
    return asteroid
  }

  function createAsteroid(startAbove) {
    return resetAsteroid({}, startAbove)
  }

  function setSceneLoad() {
    var starTarget = renderOverloadActive ? 960 : stressMode ? 720 : 280
    var asteroidTarget = renderOverloadActive ? 210 : stressMode ? 150 : 42
    var particleLimit = renderOverloadActive ? 1800 : stressMode ? 1100 : 360
    while (stars.length < starTarget) {
      stars.push(createStar())
    }
    stars.length = starTarget
    while (asteroids.length < asteroidTarget) {
      asteroids.push(createAsteroid(true))
    }
    asteroids.length = asteroidTarget
    if (particles.length > particleLimit) {
      particles.splice(0, particles.length - particleLimit)
    }
    diagnostics.stressMode = stressMode
    stressButton.textContent = text(stressMode ? 'stressOn' : 'stressOff')
  }

  function spawnBurst(x, y, count, color) {
    var burstCount = renderOverloadActive
      ? count * 3
      : stressMode
        ? count * 2
        : count
    for (var index = 0; index < burstCount; index += 1) {
      var angle = Math.random() * Math.PI * 2
      var speed = randomBetween(0.08, 0.42)
      particles.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: randomBetween(3, 12),
        life: randomBetween(0.35, 1.1),
        color: color || [0.4, 0.9, 1]
      })
    }
    var particleLimit = renderOverloadActive ? 1800 : stressMode ? 1100 : 360
    if (particles.length > particleLimit) {
      particles.splice(0, particles.length - particleLimit)
    }
  }

  function shoot(now) {
    if (now - lastShotAt < (stressMode ? 65 : 110)) {
      return
    }
    lastShotAt = now
    bullets.push({
      x: player.x,
      y: player.y + 0.06,
      vx: randomBetween(-0.012, 0.012),
      vy: 1.1,
      life: 1.8,
      size: stressMode ? 10 : 8
    })
    spawnBurst(player.x, player.y + 0.03, 3, [0.35, 0.9, 1])
  }

  function updatePlayer(delta, now) {
    var horizontal =
      (keys.ArrowRight || keys.KeyD ? 1 : 0) -
      (keys.ArrowLeft || keys.KeyA ? 1 : 0)
    var vertical =
      (keys.ArrowUp || keys.KeyW ? 1 : 0) -
      (keys.ArrowDown || keys.KeyS ? 1 : 0)
    if (horizontal || vertical) {
      player.vx += horizontal * delta * 2.3
      player.vy += vertical * delta * 2.3
    } else if (pointerInsideCanvas) {
      player.vx += (player.targetX - player.x) * delta * 4.5
      player.vy += (player.targetY - player.y) * delta * 4.5
    }
    player.vx *= Math.pow(0.03, delta)
    player.vy *= Math.pow(0.03, delta)
    player.x = clamp(player.x + player.vx * delta, -0.93, 0.93)
    player.y = clamp(player.y + player.vy * delta, -0.9, 0.86)
    if (keys.Space || pointerDown) {
      shoot(now)
    }
  }

  function updateScene(delta, now) {
    updatePlayer(delta, now)

    stars.forEach(function (star) {
      star.y -= star.speed * delta
      if (star.y < -1.04) {
        star.y = 1.04
        star.x = randomBetween(-1, 1)
      }
    })

    bullets = bullets.filter(function (bullet) {
      bullet.x += bullet.vx * delta
      bullet.y += bullet.vy * delta
      bullet.life -= delta
      return bullet.life > 0 && bullet.y < 1.1
    })

    particles = particles.filter(function (particle) {
      particle.x += particle.vx * delta
      particle.y += particle.vy * delta
      particle.vx *= Math.pow(0.18, delta)
      particle.vy *= Math.pow(0.18, delta)
      particle.life -= delta
      return particle.life > 0
    })

    asteroids.forEach(function (asteroid) {
      asteroid.x += asteroid.vx * delta
      asteroid.y += asteroid.vy * delta
      if (asteroid.x < -1.08 || asteroid.x > 1.08) {
        asteroid.vx *= -1
      }
      if (asteroid.y < -1.12) {
        shield = Math.max(0, shield - 2)
        resetAsteroid(asteroid, true)
      }
    })

    for (
      var bulletIndex = bullets.length - 1;
      bulletIndex >= 0;
      bulletIndex -= 1
    ) {
      var bullet = bullets[bulletIndex]
      var hit = false
      for (
        var asteroidIndex = 0;
        asteroidIndex < asteroids.length;
        asteroidIndex += 1
      ) {
        var asteroid = asteroids[asteroidIndex]
        var dx = bullet.x - asteroid.x
        var dy = bullet.y - asteroid.y
        if (dx * dx + dy * dy < asteroid.radius * asteroid.radius) {
          score += Math.round(80 + asteroid.radius * 900)
          spawnBurst(asteroid.x, asteroid.y, 16, [1, 0.45, 0.35])
          resetAsteroid(asteroid, true)
          hit = true
          break
        }
      }
      if (hit) {
        bullets.splice(bulletIndex, 1)
      }
    }

    if (score >= nextWaveScore) {
      wave += 1
      nextWaveScore += 1200 + wave * 260
      spawnBurst(player.x, player.y, 42, [0.6, 0.45, 1])
    }
  }

  function resizeCanvas() {
    var rect = canvas.getBoundingClientRect()
    var pixelRatio = Math.min(window.devicePixelRatio || 1, 1.6)
    var width = Math.max(1, Math.round(rect.width * pixelRatio))
    var height = Math.max(1, Math.round(rect.height * pixelRatio))
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    gl.viewport(0, 0, canvas.width, canvas.height)
    return pixelRatio
  }

  function drawBackground(time) {
    gl.disable(gl.BLEND)
    gl.useProgram(backgroundProgram)
    gl.bindBuffer(gl.ARRAY_BUFFER, backgroundBuffer)
    gl.enableVertexAttribArray(backgroundPositionLocation)
    gl.vertexAttribPointer(
      backgroundPositionLocation,
      2,
      gl.FLOAT,
      false,
      0,
      0
    )
    gl.uniform1f(backgroundTimeLocation, time)
    gl.uniform2f(backgroundResolutionLocation, canvas.width, canvas.height)
    gl.uniform1f(backgroundEntropyLocation, entropyMode ? 1 : 0)
    invokeDrawArrays(gl.TRIANGLES, 0, 3)
    drawsInWindow += 1
  }

  function drawBatch(objects, shape, pixelRatio, writeVertex) {
    if (!objects.length) {
      return
    }
    var vertexData = getReusableVertexData(objects.length * 7)
    objects.forEach(function (object, index) {
      var offset = index * 7
      writeVertex(object, vertexData, offset)
    })

    gl.useProgram(spriteProgram)
    gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(spritePositionLocation)
    gl.enableVertexAttribArray(spriteSizeLocation)
    gl.enableVertexAttribArray(spriteColorLocation)
    gl.vertexAttribPointer(
      spritePositionLocation,
      2,
      gl.FLOAT,
      false,
      28,
      0
    )
    gl.vertexAttribPointer(spriteSizeLocation, 1, gl.FLOAT, false, 28, 8)
    gl.vertexAttribPointer(spriteColorLocation, 4, gl.FLOAT, false, 28, 12)
    gl.uniform1f(spritePixelRatioLocation, pixelRatio)
    gl.uniform1f(spriteShapeLocation, shape)
    invokeDrawArrays(gl.POINTS, 0, objects.length)
    drawsInWindow += 1
  }

  function writeStarVertex(star, data, offset) {
    data[offset] = star.x
    data[offset + 1] = star.y
    data[offset + 2] = star.size
    data[offset + 3] = 0.55
    data[offset + 4] = 0.78
    data[offset + 5] = 1
    data[offset + 6] = star.alpha
  }

  function writeAsteroidVertex(asteroid, data, offset) {
    data[offset] = asteroid.x
    data[offset + 1] = asteroid.y
    data[offset + 2] = asteroid.size
    data[offset + 3] = 0.55 + asteroid.seed * 0.16
    data[offset + 4] = 0.48
    data[offset + 5] = 0.72
    data[offset + 6] = asteroid.seed
  }

  function writeBulletVertex(bullet, data, offset) {
    data[offset] = bullet.x
    data[offset + 1] = bullet.y
    data[offset + 2] = bullet.size
    data[offset + 3] = 0.35
    data[offset + 4] = 0.96
    data[offset + 5] = 1
    data[offset + 6] = 1
  }

  function writeParticleVertex(particle, data, offset) {
    data[offset] = particle.x
    data[offset + 1] = particle.y
    data[offset + 2] = particle.size
    data[offset + 3] = particle.color[0]
    data[offset + 4] = particle.color[1]
    data[offset + 5] = particle.color[2]
    data[offset + 6] = clamp(particle.life, 0, 1)
  }

  function writePlayerVertex(ship, data, offset) {
    data[offset] = ship.x
    data[offset + 1] = ship.y
    data[offset + 2] = assetLoadFailureActive ? ship.size + 5 : ship.size
    data[offset + 3] = assetLoadFailureActive ? 1 : 0.55
    data[offset + 4] = assetLoadFailureActive ? 0.22 : 0.86
    data[offset + 5] = assetLoadFailureActive ? 0.64 : 1
    data[offset + 6] = 1
  }

  function drawScene(time) {
    var pixelRatio = resizeCanvas()
    drawBackground(time)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    drawBatch(stars, 0, pixelRatio, writeStarVertex)
    drawBatch(asteroids, 1, pixelRatio, writeAsteroidVertex)
    drawBatch(bullets, 2, pixelRatio, writeBulletVertex)
    drawBatch(particles, 3, pixelRatio, writeParticleVertex)
    drawBatch(playerBatch, 4, pixelRatio, writePlayerVertex)
    for (var drawIndex = 0; drawIndex < extraDrawCalls; drawIndex += 1) {
      drawBatch(playerBatch, 4, pixelRatio, writePlayerVertex)
    }
  }

  function updateHud() {
    scoreElement.textContent = String(score).padStart(6, '0')
    shieldElement.textContent = shield + '%'
    shieldElement.style.color = shield < 30 ? '#ff668f' : ''
    waveElement.textContent = String(wave).padStart(2, '0')
  }

  function frame(now) {
    if (destroyed) {
      return
    }
    var frameNow = updateRenderOverload(now)
    var shouldRender = true
    if (renderOverloadActive) {
      shouldRender = frameNow >= renderOverloadNextFrameAt
      if (shouldRender) {
        renderOverloadNextFrameAt =
          frameNow + RENDER_OVERLOAD_FRAME_INTERVAL_MS
      } else if (!paused) {
        renderOverloadDroppedFrames += 1
      }
    }
    if (!paused && shouldRender) {
      var delta = Math.min(
        (frameNow - lastFrameAt) / 1000,
        renderOverloadActive ? 0.12 : 0.05
      )
      lastFrameAt = frameNow
      updateScene(delta, frameNow)
      drawScene(frameNow / 1000)
      framesInWindow += 1
      if (renderOverloadActive) {
        renderOverloadRenderedFrames += 1
        renderOverloadPeakParticles = Math.max(
          renderOverloadPeakParticles,
          particles.length
        )
      }
    } else if (paused) {
      lastFrameAt = frameNow
    }
    if (frameNow - fpsWindowStartedAt >= 1000) {
      var elapsed = (frameNow - fpsWindowStartedAt) / 1000
      var currentFps = Math.round(framesInWindow / elapsed)
      metricFps.textContent = currentFps
      gameFpsElement.textContent = currentFps
      metricDraws.textContent = Math.round(drawsInWindow / elapsed) + '/s'
      framesInWindow = 0
      drawsInWindow = 0
      fpsWindowStartedAt = frameNow
      updateHud()
    }
    frameHandle = window.requestAnimationFrame(frame)
  }

  function togglePause(forcePaused) {
    paused =
      typeof forcePaused === 'boolean' ? forcePaused : !paused
    diagnostics.paused = paused
    renderDynamicCopy()
  }

  function resetGame() {
    score = 0
    shield = 100
    wave = 1
    nextWaveScore = 1200
    bullets = []
    particles = []
    player.x = 0
    player.y = -0.68
    player.targetX = 0
    player.targetY = -0.68
    asteroids.forEach(function (asteroid) {
      resetAsteroid(asteroid, true)
    })
    updateHud()
  }

  function updatePointer(event) {
    var rect = canvas.getBoundingClientRect()
    var isInside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    if (!isInside) {
      releasePointerControl(event)
      return false
    }
    setPointerControlState(true)
    player.targetX = clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1, 1)
    player.targetY = clamp(1 - ((event.clientY - rect.top) / rect.height) * 2, -1, 1)
    return true
  }

  function setPointerControlState(active) {
    if (pointerInsideCanvas === active) {
      return
    }
    pointerInsideCanvas = active
    diagnostics.pointerInsideCanvas = active
    canvas.dataset.pointerControl = active ? 'inside' : 'released'
  }

  function releasePointerControl(event) {
    setPointerControlState(false)
    pointerDown = false
    player.targetX = player.x
    player.targetY = player.y
    if (
      event &&
      typeof event.pointerId === 'number' &&
      canvas.hasPointerCapture(event.pointerId)
    ) {
      canvas.releasePointerCapture(event.pointerId)
    }
  }

  function updateReplayTelemetry() {
    if (!window.DATAFLUX_RUM || !replayEnabled) {
      return
    }
    try {
      var isRecording =
        typeof window.DATAFLUX_RUM.isRecording === 'function'
          ? window.DATAFLUX_RUM.isRecording()
          : replayEnabled
      recordingStatus.textContent = text(isRecording ? 'recording' : 'starting')
      replayDot.classList.toggle('is-live', isRecording)
      var history = typeof window.DATAFLUX_RUM.getAutoCanvasSnapshotDebugHistoryForDebug === 'function'
        ? window.DATAFLUX_RUM.getAutoCanvasSnapshotDebugHistoryForDebug() || []
        : []
      history.forEach(function (entry) {
        if (entry.scheduler !== 'webgl_snapshot') {
          return
        }
        var key = String(entry.startedAt) + ':' + String(entry.completedAt)
        if (!knownSnapshotKeys[key]) {
          knownSnapshotKeys[key] = true
          knownSnapshotKeyQueue.push(key)
          if (knownSnapshotKeyQueue.length > maxKnownSnapshotKeys) {
            delete knownSnapshotKeys[knownSnapshotKeyQueue.shift()]
          }
          totalReplaySnapshots += 1
          replaySnapshotStartedAts.push(entry.startedAt)
          replaySnapshotStartedAts = replaySnapshotStartedAts.filter(
            function (startedAt) {
              return entry.startedAt - startedAt <= 5000
            }
          )
        }
        lastReplaySnapshot = entry
      })
      lastCanvasMutation = typeof window.DATAFLUX_RUM.getLastCanvasMutationForDebug === 'function'
        ? window.DATAFLUX_RUM.getLastCanvasMutationForDebug()
        : undefined
      var internalContext = typeof window.DATAFLUX_RUM.getInternalContext === 'function'
        ? window.DATAFLUX_RUM.getInternalContext()
        : undefined
      var lastSegment = typeof window.DATAFLUX_RUM.getLastReplaySegmentFlushForDebug === 'function'
        ? window.DATAFLUX_RUM.getLastReplaySegmentFlushForDebug()
        : undefined
      var sessionId =
        internalContext &&
        internalContext.session &&
        internalContext.session.id
      var viewId =
        internalContext &&
        internalContext.view &&
        internalContext.view.id

      diagnostics.replaySnapshots = totalReplaySnapshots
      diagnostics.lastSnapshot = lastReplaySnapshot
      diagnostics.lastMutation = lastCanvasMutation
      diagnostics.captureFps =
        replaySnapshotStartedAts.length > 1
          ? ((replaySnapshotStartedAts.length - 1) * 1000) /
            (replaySnapshotStartedAts[replaySnapshotStartedAts.length - 1] -
              replaySnapshotStartedAts[0])
          : undefined
      diagnostics.sessionId = sessionId
      diagnostics.viewId = viewId
      diagnostics.lastSegment = lastSegment
      diagnostics.objectCount =
        stars.length + asteroids.length + bullets.length + particles.length + 1

      metricSnapshots.textContent = totalReplaySnapshots
      metricObjects.textContent = diagnostics.objectCount
      metricScheduler.textContent = lastReplaySnapshot
        ? (diagnostics.captureFps
            ? diagnostics.captureFps.toFixed(1)
            : 'measuring') +
          ' FPS · target ' +
          captureProfile.targetFps
        : captureProfile.targetFps + ' FPS target'
      metricBytes.textContent = lastCanvasMutation
        ? formatBytes(lastCanvasMutation.encodedBytesCount)
        : 'none'
      metricLatency.textContent = lastReplaySnapshot
        ? Math.max(
            0,
            lastReplaySnapshot.completedAt - lastReplaySnapshot.startedAt
          ) + ' ms'
        : 'none'
      metricSession.textContent = sessionId
        ? sessionId.slice(0, 8) + '…'
        : 'waiting'
      metricSession.title = sessionId || ''
      metricSegment.textContent = lastSegment
        ? '#' + lastSegment.sequence + ' · ' + formatBytes(lastSegment.rawBytesCount)
        : 'waiting'
      metricSegment.title = lastSegment
        ? lastSegment.flushReason
        : ''
      captureOutput.textContent = JSON.stringify(
        {
          sampling: numericSampling,
          captureProfile: captureProfile,
          actualCaptureFps: diagnostics.captureFps,
          preserveDrawingBuffer: diagnostics.preserveDrawingBuffer,
          sessionId: sessionId,
          viewId: viewId,
          snapshot: lastReplaySnapshot,
          mutation: lastCanvasMutation,
          segment: lastSegment,
          objects: diagnostics.objectCount,
          stressMode: stressMode,
          renderOverloadActive: renderOverloadActive,
          lastRenderOverload: diagnostics.lastRenderOverload,
          assetLoadFailureActive: assetLoadFailureActive,
          assetLoadFailureAttempts: assetLoadFailureAttempts,
          assetLoadFailureLastStatus: assetLoadFailureLastStatus,
          lastAssetLoadFailure: diagnostics.lastAssetLoadFailure,
          entropyMode: entropyMode,
          cacheDrawMethod: cacheDrawMethod,
          drawMethodCached: diagnostics.drawMethodCached,
          extraDrawCalls: extraDrawCalls,
          contextType: requestedContext,
          pluginEnabled: pluginEnabled,
          sampledOut: sampledOut
        },
        null,
        2
      )
    } catch (error) {
      recordError(error)
    }
  }

  replayButton.addEventListener('click', function () {
    if (!window.DATAFLUX_RUM) {
      return
    }
    replayEnabled = !replayEnabled
    if (
      replayEnabled &&
      typeof window.DATAFLUX_RUM.startSessionReplayRecording === 'function'
    ) {
      window.DATAFLUX_RUM.startSessionReplayRecording()
      recordingStatus.textContent = text('starting')
    } else if (
      !replayEnabled &&
      typeof window.DATAFLUX_RUM.stopSessionReplayRecording === 'function'
    ) {
      window.DATAFLUX_RUM.stopSessionReplayRecording()
      recordingStatus.textContent = text('stopped')
      replayDot.classList.remove('is-live')
    }
    replayButton.textContent = text(replayEnabled ? 'replayOn' : 'replayOff')
    diagnostics.replayEnabled = replayEnabled
  })
  pauseButton.addEventListener('click', function () {
    togglePause()
  })
  stressButton.addEventListener('click', function () {
    stressMode = !stressMode
    setSceneLoad()
    spawnBurst(player.x, player.y, 50, [0.65, 0.45, 1])
  })
  burstButton.addEventListener('click', function () {
    spawnBurst(
      randomBetween(-0.55, 0.55),
      randomBetween(-0.2, 0.55),
      90,
      [0.35, 0.95, 1]
    )
  })
  resetButton.addEventListener('click', resetGame)
  samplingSelect.value = sampling
  samplingSelect.addEventListener('change', function () {
    var nextQuery = new URLSearchParams(window.location.search)
    nextQuery.set('sampling', samplingSelect.value)
    if (stressMode) {
      nextQuery.set('stress', '1')
    } else {
      nextQuery.delete('stress')
    }
    window.location.search = nextQuery.toString()
  })
  window.addEventListener('keydown', function (event) {
    keys[event.code] = true
    if (event.code === 'Space') {
      event.preventDefault()
    }
    if (event.code === 'KeyP' && !event.repeat) {
      togglePause()
    }
  })
  window.addEventListener('keyup', function (event) {
    keys[event.code] = false
  })
  canvas.addEventListener('pointermove', updatePointer)
  canvas.addEventListener('pointerdown', function (event) {
    pointerDown = updatePointer(event)
    if (pointerDown) {
      canvas.setPointerCapture(event.pointerId)
    }
  })
  canvas.addEventListener('pointerup', function (event) {
    pointerDown = false
    updatePointer(event)
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId)
    }
  })
  canvas.addEventListener('pointerleave', releasePointerControl)
  canvas.addEventListener('pointercancel', releasePointerControl)
  canvas.addEventListener('click', function () {
    if (paused) {
      togglePause(false)
    }
  })
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      keys = {}
      releasePointerControl()
    }
  })

  setSceneLoad()
  updateHud()
  drawScene(performance.now() / 1000)
  frameHandle = window.requestAnimationFrame(frame)
  telemetryTimer = window.setInterval(updateReplayTelemetry, 500)
  diagnostics.ready = true
  diagnostics.pause = function () {
    togglePause(true)
  }
  diagnostics.resume = function () {
    togglePause(false)
  }
  diagnostics.setStress = function (enabled) {
    stressMode = !!enabled
    setSceneLoad()
  }
  diagnostics.burst = function () {
    spawnBurst(0, 0.15, 100, [0.4, 0.9, 1])
  }
  diagnostics.destroy = function () {
    destroyed = true
    assetLoadFailureGeneration += 1
    clearAssetLoadFailureTimers()
    assetLoadFailureActive = false
    renderOverloadGeneration += 1
    renderOverloadPending = false
    renderOverloadActive = false
    window.cancelAnimationFrame(frameHandle)
    window.clearInterval(telemetryTimer)
    window.removeEventListener('message', handleParentMessage)
  }
  renderDynamicCopy()
  postSceneMessage('scene-ready', Object.assign({
    language: language,
    view: 'web',
    webglAvailable: true,
    rumReady: bootstrapState.rumReady
  }, currentRumCorrelation()))
  }

  bootstrap()
})()
