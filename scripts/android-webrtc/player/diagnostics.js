// Browser diagnostics for the pinned Android Emulator player.
// Keep recovery work independent of diagnostic sample admission.
export function startPlayerDiagnostics({
  window = globalThis.window,
  document = window.document,
  performance = window.performance,
  fetch = window.fetch.bind(window),
  wallNow = () => Date.now(),
} = {}) {
  const {HTMLVideoElement, HTMLImageElement, AbortController} = window;
  const URL = window.URL;
  const clearTimeout = window.clearTimeout.bind(window);
  const PLAYER_MESSAGE_SOURCE = 'mall-demo-android-player';
  const PLAYER_MESSAGE_VERSION = 1;
  const FIRST_FRAME_TIMEOUT_MS = 600;
  const FIRST_FRAME_RETRY_MS = 3000;
  const INPUT_FRAME_REFRESH_MS = 250;
  const INPUT_FRAME_REFRESH_RETRY_MS = 1000;
  const INPUT_FRAME_REFRESH_ATTEMPTS = 3;
  const INPUT_FRAME_TIMEOUT_MS = 5000;
  const SNAPSHOT_FALLBACK_INTERVAL_MS = 1000;
  const SNAPSHOT_FALLBACK_BURST_INTERVAL_MS = 220;
  const embedded = new URLSearchParams(window.location.search).get('embedded') === '1';
  let previousVideoSample = null;
  let cachedDeviceDiagnostics = null;
  let deviceDiagnosticsSampledAt = 0;
  let deviceDiagnosticsRequest = null;
  let statsRequest = null;
  let inputFrameSequence = 0;
  let latestInputToNextFrameMs = null;
  let inputToNextFrameSampledAt = 0;
  let inputNextFrameStatus = 'idle';
  let inputDispatchDelayMs = null;
  let inputFrameRefreshTimer = null;
  let inputFrameTimeout = null;
  let pendingPointerPress = null;
  let pendingPointerTimeout = null;
  let visualFrameSequence = 0;
  let visualFrameTimeout = null;
  let latestInputToVisualChangeMs = null;
  let inputToVisualChangeSampledAt = 0;
  let inputVisualChangeScorePercent = null;
  let inputVisualChangeStatus = 'idle';
  let interactionAckSequence = 0;
  let interactionAckController = null;
  let interactionAckTimeout = null;
  let activePointerSample = null;
  let latestInputReleaseToAppAckMs = null;
  let inputPressDurationMs = null;
  let latestInputToAppAckMs = null;
  let inputToAppAckSampledAt = 0;
  let inputAppAckAction = '';
  let inputAppAckStatus = 'idle';
  let monitoredPeerConnection = null;
  let monitoredVideo = null;
  let frameMonitorGeneration = 0;
  let firstPresentedFrameAt = 0;
  let presentedCallbackCount = 0;
  let videoPixelsUsable = false;
  let lastPresentedFrameAt = 0;
  let mediaReadiness = 'connecting';
  let frameRefreshCount = 0;
  let frameRefreshStatus = 'idle';
  let frameRefreshRequest = null;
  let firstFrameWatchdog = null;
  let peerRecoveryCount = 0;
  let firstFrameRecoveryComplete = false;
  let firstFrameRecoveryInFlight = false;
  let frameFallbackImage = null;
  let frameFallbackObjectUrl = '';
  let frameFallbackRequest = null;
  let frameFallbackController = null;
  let frameFallbackGeneration = 0;
  let frameFallbackTimer = null;
  let frameFallbackTimerAt = 0;
  let frameFallbackActive = false;
  let frameFallbackBurstRemaining = 0;
  let pendingVisualFrameInspector = null;
  let latestVideoFrameTiming = {ageMs: null, receiveToDisplayMs: null, processingMs: null};
  const latencySamples = [];
  const LATENCY_WINDOW_SIZE = 100;
  const visualSampleCanvas = document.createElement('canvas');
  visualSampleCanvas.width = 72;
  visualSampleCanvas.height = 160;

  const publish = (type, payload = {}) => {
    if (!embedded || window.parent === window) return;
    window.parent.postMessage({
      source: PLAYER_MESSAGE_SOURCE,
      version: PLAYER_MESSAGE_VERSION,
      type,
      payload,
    }, '*');
  };

  const finiteNumber = (value) => Number.isFinite(value) ? value : null;
  const gatewayEndpoint = () => {
    const gateway = new URLSearchParams(window.location.search).get('url')
      || new URLSearchParams(window.location.search).get('uri')
      || window.location.origin;
    return gateway.replace(/\/$/, '');
  };

  const requestFrameRefresh = async (reason) => {
    if (window.__mallDemoJsepDriver?.wsUrl?.endsWith('/ws-jsep-latest')) return false;
    if (frameRefreshRequest) return frameRefreshRequest;
    frameRefreshCount += 1;
    frameRefreshStatus = 'requesting';
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 4000);
    frameRefreshRequest = fetch(`${gatewayEndpoint()}/api/v1/emulator/refresh-frame`, {
      method: 'POST',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((response) => {
        frameRefreshStatus = response.ok ? 'requested' : 'failed';
        return response.ok;
      })
      .catch(() => {
        frameRefreshStatus = 'failed';
        return false;
      })
      .finally(() => {
        clearTimeout(timeout);
        frameRefreshRequest = null;
      });
    return frameRefreshRequest;
  };

  const loadGatewayJson = async (url) => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
      return response.ok ? await response.json() : null;
    } catch (_) {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  };

  const loadDeviceDiagnostics = async () => {
    if (deviceDiagnosticsRequest) return deviceDiagnosticsRequest;
    if (wallNow() - deviceDiagnosticsSampledAt < 10000) return cachedDeviceDiagnostics;
    deviceDiagnosticsSampledAt = wallNow();
    const endpoint = gatewayEndpoint();
    deviceDiagnosticsRequest = Promise.all([
      loadGatewayJson(`${endpoint}/api/v1/emulator/status`),
      loadGatewayJson(`${endpoint}/api/v1/emulator/gfxinfo`),
    ]).then(([status, gfxinfo]) => {
      cachedDeviceDiagnostics = {
      booted: status?.booted === true,
      uptimeMs: finiteNumber(status?.uptime),
      version: typeof status?.version === 'string' ? status.version : '',
      gfxinfo: gfxinfo && typeof gfxinfo === 'object' ? {
        sampledAt: finiteNumber(gfxinfo.sampledAt),
        totalFrames: finiteNumber(gfxinfo.totalFrames),
        jankyFrames: finiteNumber(gfxinfo.jankyFrames),
        jankyPercent: finiteNumber(gfxinfo.jankyPercent),
        p50Ms: finiteNumber(gfxinfo.p50Ms),
        p90Ms: finiteNumber(gfxinfo.p90Ms),
        p95Ms: finiteNumber(gfxinfo.p95Ms),
      } : null,
      };
      return cachedDeviceDiagnostics;
    }).finally(() => {deviceDiagnosticsRequest = null;});
    return deviceDiagnosticsRequest;
  };

  const currentMediaMode = () => frameFallbackActive ? 'snapshot' : firstPresentedFrameAt ? 'video' : 'waiting';
  const recordLatency = (sample, metric, status, value = null) => {
    if (!sample) return;
    if (sample.mediaMode !== currentMediaMode()) sample.mediaMode = 'mixed';
    sample.metrics[metric] = {status, value: finiteNumber(value)};
  };
  const summarizeMetric = (samples, metric) => {
    const results = samples.map(sample => sample.metrics[metric]).filter(result => result && result.status !== 'waiting');
    const values = results.filter(result => result.status === 'received' && result.value !== null)
      .map(result => result.value).sort((left, right) => left - right);
    const timeoutCount = results.filter(result => result.status === 'timeout').length;
    const measuredCount = values.length + timeoutCount;
    return {
      count: values.length,
      p50Ms: values.length ? values[Math.ceil(values.length * 0.5) - 1] : null,
      p95Ms: values.length ? values[Math.ceil(values.length * 0.95) - 1] : null,
      timeoutCount,
      timeoutPercent: measuredCount ? timeoutCount / measuredCount * 100 : null,
      excludedCount: results.length - measuredCount,
    };
  };
  const summarizeLatency = () => ({
    limit: LATENCY_WINDOW_SIZE,
    count: latencySamples.length,
    modes: Object.fromEntries(['video', 'snapshot', 'waiting', 'mixed'].map(mode => {
      const samples = latencySamples.filter(sample => sample.mediaMode === mode);
      return [mode, {count: samples.length, nextFrame: summarizeMetric(samples, 'nextFrame'),
        visual: summarizeMetric(samples, 'visual'), appAck: summarizeMetric(samples, 'appAck')}];
    })),
  });

  const normalizeInteractionAck = (payload) => {
    const sequence = finiteNumber(payload?.sequence);
    const action = typeof payload?.action === 'string' ? payload.action.slice(0, 80) : '';
    if (!sequence || !action || payload?.version !== 1) return null;
    return { sequence, action, epoch: payload.epoch };
  };

  const loadInteractionAck = async (checkpoint, waitMs, signal) => {
    const url = new URL(`${gatewayEndpoint()}/api/v1/emulator/interaction-ack`);
    url.searchParams.set('after', String(checkpoint.sequence));
    url.searchParams.set('epoch', checkpoint.epoch);
    url.searchParams.set('waitMs', String(waitMs));
    const response = await fetch(url, { cache: 'no-store', signal });
    if (response.status === 204) return null;
    if (!response.ok) throw new Error(`Interaction acknowledgement failed: ${response.status}`);
    const ack = normalizeInteractionAck(await response.json());
    if (!ack || ack.epoch !== checkpoint.epoch || ack.sequence <= checkpoint.sequence) {
      throw new Error('Interaction acknowledgement cursor mismatch');
    }
    return ack;
  };

  const loadInteractionCheckpoint = async (signal) => {
    try {
      const response = await fetch(`${gatewayEndpoint()}/api/v1/emulator/interaction-ack?cursor=1`, {
        cache: 'no-store', signal,
      });
      if (!response.ok) return null;
      const checkpoint = await response.json();
      return checkpoint.version === 2 && Number.isSafeInteger(checkpoint.sequence)
        && checkpoint.sequence >= 0 && /^[a-f0-9]{32}$/.test(checkpoint.epoch)
        ? checkpoint : null;
    } catch (_) {
      return null;
    }
  };

  const snapshotVideo = (source) => {
    if (!source) return null;
    if (source instanceof HTMLVideoElement
        && (source.readyState < 2 || !source.videoWidth || !source.videoHeight)) return null;
    if (source instanceof HTMLImageElement
        && (!source.complete || !source.naturalWidth || !source.naturalHeight)) return null;
    try {
      const context = visualSampleCanvas.getContext('2d', { willReadFrequently: true });
      if (!context) return null;
      context.drawImage(source, 0, 0, visualSampleCanvas.width, visualSampleCanvas.height);
      return new Uint8ClampedArray(
        context.getImageData(0, 0, visualSampleCanvas.width, visualSampleCanvas.height).data,
      );
    } catch (_) {
      return null;
    }
  };

  const currentVisualSource = (video) => (
    frameFallbackActive && frameFallbackImage?.complete && frameFallbackImage.naturalWidth
      ? frameFallbackImage
      : video
  );

  const stopFrameFallback = () => {
    frameFallbackGeneration += 1;
    frameFallbackController?.abort();
    frameFallbackController = null;
    frameFallbackRequest = null;
    if (frameFallbackTimer) clearTimeout(frameFallbackTimer);
    frameFallbackTimer = null;
    frameFallbackTimerAt = 0;
    frameFallbackActive = false;
    frameFallbackBurstRemaining = 0;
    if (frameFallbackImage) frameFallbackImage.remove();
    frameFallbackImage = null;
    if (frameFallbackObjectUrl) URL.revokeObjectURL(frameFallbackObjectUrl);
    frameFallbackObjectUrl = '';
  };

  const createFrameFallbackImage = () => {
      const image = document.createElement('img');
      image.dataset.mallDemoFrameFallback = 'true';
      image.alt = '';
      image.setAttribute('aria-hidden', 'true');
      Object.assign(image.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '2147483646',
        width: '100vw',
        height: '100vh',
        objectFit: 'contain',
        background: '#000',
        pointerEvents: 'none',
      });
    return image;
  };

  const scheduleFrameFallback = (delay = SNAPSHOT_FALLBACK_INTERVAL_MS) => {
    if (firstPresentedFrameAt || !embedded) return;
    const deadline = performance.now() + delay;
    // Repeated move events must not keep postponing the next refresh forever.
    if (frameFallbackTimer && frameFallbackTimerAt <= deadline) return;
    if (frameFallbackTimer) clearTimeout(frameFallbackTimer);
    frameFallbackTimerAt = deadline;
    frameFallbackTimer = window.setTimeout(() => {
      frameFallbackTimer = null;
      frameFallbackTimerAt = 0;
      requestFrameFallback();
    }, delay);
  };

  const requestFrameFallback = async () => {
    if (firstPresentedFrameAt || !embedded) return false;
    if (frameFallbackRequest) return frameFallbackRequest;
    const generation = frameFallbackGeneration;
    const controller = new AbortController();
    frameFallbackController = controller;
    const isCurrent = () => generation === frameFallbackGeneration
      && !firstPresentedFrameAt && !controller.signal.aborted;
    const timeout = window.setTimeout(() => controller.abort(), 4000);
    const fresh = frameFallbackBurstRemaining > 0;
    if (fresh) frameFallbackBurstRemaining -= 1;
    const request = fetch(`${gatewayEndpoint()}/api/v1/emulator/frame.png${fresh ? '?fresh=1' : ''}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error('frame unavailable');
        return response.blob();
      })
      .then((blob) => new Promise((resolve, reject) => {
        if (!isCurrent()) {
          resolve(false);
          return;
        }
        const image = createFrameFallbackImage();
        const objectUrl = URL.createObjectURL(blob);
        const discard = () => {
          image.onload = image.onerror = null;
          URL.revokeObjectURL(objectUrl);
          image.remove();
          resolve(false);
        };
        controller.signal.addEventListener('abort', discard, {once: true});
        image.onload = () => {
          controller.signal.removeEventListener('abort', discard);
          if (!isCurrent()) {
            discard();
            return;
          }
          frameFallbackImage?.remove();
          if (frameFallbackObjectUrl) URL.revokeObjectURL(frameFallbackObjectUrl);
          frameFallbackImage = image;
          frameFallbackObjectUrl = objectUrl;
          document.body.appendChild(image);
          frameFallbackActive = true;
          mediaReadiness = 'snapshot-fallback';
          if (pendingVisualFrameInspector) pendingVisualFrameInspector(performance.now());
          resolve(true);
        };
        image.onerror = () => {
          controller.signal.removeEventListener('abort', discard);
          URL.revokeObjectURL(objectUrl);
          reject(new Error('invalid frame'));
        };
        image.src = objectUrl;
      }))
      .catch(() => false)
      .finally(() => {
        clearTimeout(timeout);
        if (generation !== frameFallbackGeneration) return;
        frameFallbackRequest = null;
        frameFallbackController = null;
        if (frameFallbackBurstRemaining > 0) {
          scheduleFrameFallback(SNAPSHOT_FALLBACK_BURST_INTERVAL_MS);
        } else {
          scheduleFrameFallback();
        }
      });
    frameFallbackRequest = request;
    return request;
  };

  const refreshAfterDispatchedInput = (event) => {
    if (!['mouse', 'touch', 'keyboard'].includes(event?.detail?.label)
        || !embedded || firstPresentedFrameAt) return;
    frameFallbackBurstRemaining = 3;
    scheduleFrameFallback(80);
  };

  const isUsableVideoFrame = (pixels) => {
    if (!pixels?.length) return false;
    let visiblePixels = 0;
    const pixelCount = pixels.length / 4;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const luma = pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114;
      if (luma >= 8) visiblePixels += 1;
    }
    return visiblePixels / pixelCount >= 0.01;
  };

  const clearFirstFrameWatchdog = () => {
    if (firstFrameWatchdog) clearTimeout(firstFrameWatchdog);
    firstFrameWatchdog = null;
  };

  const updateMediaReadiness = (driver, peerConnection) => {
    const hasOpenInput = Object.values(driver?.event_forwarders || {})
      .some((channel) => channel?.readyState === 'open');
    if (!peerConnection || peerConnection.connectionState !== 'connected') {
      mediaReadiness = 'connecting';
    } else if (!firstPresentedFrameAt) {
      if (frameFallbackActive) {
        mediaReadiness = 'snapshot-fallback';
      } else if (!['recovering-frame', 'reconnecting'].includes(mediaReadiness)) {
        mediaReadiness = 'waiting-first-frame';
      }
    } else if (!hasOpenInput) {
      mediaReadiness = 'waiting-input';
    } else {
      mediaReadiness = 'ready';
    }
  };

  const scheduleFirstFrameWatchdog = (driver, peerConnection, generation) => {
    if (firstFrameWatchdog || firstFrameRecoveryInFlight || firstPresentedFrameAt || firstFrameRecoveryComplete
        || peerConnection?.connectionState !== 'connected') return;
    firstFrameWatchdog = window.setTimeout(async () => {
      firstFrameWatchdog = null;
      if (generation !== frameMonitorGeneration || firstPresentedFrameAt) return;
      firstFrameRecoveryInFlight = true;
      mediaReadiness = 'recovering-frame';
      requestFrameFallback();
      await requestFrameRefresh('first-frame');
      firstFrameWatchdog = window.setTimeout(() => {
        firstFrameWatchdog = null;
        firstFrameRecoveryInFlight = false;
        if (generation !== frameMonitorGeneration || firstPresentedFrameAt) return;
        if (peerRecoveryCount < 1 && typeof driver?.recoverConnection === 'function') {
          peerRecoveryCount += 1;
          mediaReadiness = 'reconnecting';
          driver.recoverConnection();
          return;
        }
        firstFrameRecoveryComplete = true;
        mediaReadiness = 'waiting-first-frame';
      }, FIRST_FRAME_RETRY_MS);
    }, FIRST_FRAME_TIMEOUT_MS);
  };

  const startVideoFrameMonitor = (video, driver, peerConnection) => {
    if (peerConnection === monitoredPeerConnection && video === monitoredVideo) {
      updateMediaReadiness(driver, peerConnection);
      scheduleFirstFrameWatchdog(driver, peerConnection, frameMonitorGeneration);
      return;
    }
    invalidateInputMeasurements();
    previousVideoSample = null;
    latestVideoFrameTiming = {ageMs: null, receiveToDisplayMs: null, processingMs: null};
    monitoredPeerConnection = peerConnection;
    monitoredVideo = video;
    stopFrameFallback();
    firstPresentedFrameAt = 0;
    presentedCallbackCount = 0;
    videoPixelsUsable = false;
    lastPresentedFrameAt = 0;
    mediaReadiness = 'connecting';
    clearFirstFrameWatchdog();
    const generation = ++frameMonitorGeneration;
    scheduleFrameFallback(FIRST_FRAME_TIMEOUT_MS);
    if (!video || typeof video.requestVideoFrameCallback !== 'function') {
      mediaReadiness = 'unavailable';
      return;
    }
    const observeFrame = (presentedAt, metadata = {}) => {
      if (generation !== frameMonitorGeneration) return;
      lastPresentedFrameAt = wallNow();
      const displayTime = finiteNumber(metadata.expectedDisplayTime) ?? presentedAt;
      const timingDelta = value => Number.isFinite(value) && displayTime >= value ? displayTime - value : null;
      latestVideoFrameTiming = {
        ageMs: timingDelta(metadata.captureTime),
        receiveToDisplayMs: timingDelta(metadata.receiveTime),
        processingMs: Number.isFinite(metadata.processingDuration) ? metadata.processingDuration * 1000 : null,
      };
      presentedCallbackCount += 1;
      if (!firstPresentedFrameAt) videoPixelsUsable = isUsableVideoFrame(snapshotVideo(video));
      if (!firstPresentedFrameAt && videoPixelsUsable) {
        firstPresentedFrameAt = lastPresentedFrameAt;
        frameRefreshStatus = 'idle';
        clearFirstFrameWatchdog();
        stopFrameFallback();
      }
      updateMediaReadiness(driver, peerConnection);
      video.requestVideoFrameCallback(observeFrame);
    };
    video.requestVideoFrameCallback(observeFrame);
    updateMediaReadiness(driver, peerConnection);
    scheduleFirstFrameWatchdog(driver, peerConnection, generation);
  };

  const visualDifference = (before, after, normalizedX, normalizedY) => {
    if (!before || !after || before.length !== after.length) return null;
    const width = visualSampleCanvas.width;
    const height = visualSampleCanvas.height;
    const focusX = Math.round(normalizedX * (width - 1));
    const focusY = Math.round(normalizedY * (height - 1));
    const focusRadiusX = 10;
    const focusRadiusY = 10;
    let totalDelta = 0;
    let changedPixels = 0;
    let focusDelta = 0;
    let focusChangedPixels = 0;
    let focusPixels = 0;
    const pixels = width * height;
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      const offset = pixel * 4;
      const beforeLuma = before[offset] * 0.299 + before[offset + 1] * 0.587 + before[offset + 2] * 0.114;
      const afterLuma = after[offset] * 0.299 + after[offset + 1] * 0.587 + after[offset + 2] * 0.114;
      const delta = Math.abs(afterLuma - beforeLuma);
      totalDelta += delta;
      if (delta >= 18) changedPixels += 1;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      if (Math.abs(x - focusX) <= focusRadiusX && Math.abs(y - focusY) <= focusRadiusY) {
        focusPixels += 1;
        focusDelta += delta;
        if (delta >= 18) focusChangedPixels += 1;
      }
    }
    return {
      meanDelta: totalDelta / pixels,
      changedFraction: changedPixels / pixels,
      focusMeanDelta: focusPixels ? focusDelta / focusPixels : 0,
      focusChangedFraction: focusPixels ? focusChangedPixels / focusPixels : 0,
    };
  };

  const armVisualChange = (video, baseline, normalizedX, normalizedY, sequence, startedAt, pointer) => {
    if (!baseline || typeof video.requestVideoFrameCallback !== 'function') {
      inputVisualChangeStatus = 'unavailable';
      recordLatency(pointer, 'visual', 'unavailable');
      return;
    }
    inputVisualChangeStatus = 'waiting';
    latestInputToVisualChangeMs = null;
    inputVisualChangeScorePercent = null;
    if (visualFrameTimeout) clearTimeout(visualFrameTimeout);
    visualFrameTimeout = window.setTimeout(() => {
      if (sequence !== visualFrameSequence) return;
      inputVisualChangeStatus = 'timeout';
      recordLatency(pointer, 'visual', 'timeout');
      inputToVisualChangeSampledAt = wallNow();
      pendingVisualFrameInspector = null;
    }, 5000);
    const inspectFrame = (presentedAt) => {
      if (sequence !== visualFrameSequence || inputVisualChangeStatus !== 'waiting') return;
      const difference = visualDifference(
        baseline,
        snapshotVideo(currentVisualSource(video)),
        normalizedX,
        normalizedY,
      );
      const globalChange = difference
        && difference.changedFraction >= 0.006
        && difference.meanDelta >= 0.4;
      const focusedChange = difference
        && difference.focusChangedFraction >= 0.025
        && difference.focusMeanDelta >= 1;
      if (globalChange || focusedChange) {
        clearTimeout(visualFrameTimeout);
        visualFrameTimeout = null;
        latestInputToVisualChangeMs = Math.max(0, presentedAt - startedAt);
        inputToVisualChangeSampledAt = wallNow();
        inputVisualChangeScorePercent = Math.max(
          difference.changedFraction,
          difference.focusChangedFraction,
        ) * 100;
        inputVisualChangeStatus = 'received';
        recordLatency(pointer, 'visual', 'received', latestInputToVisualChangeMs);
        pendingVisualFrameInspector = null;
        return;
      }
      video.requestVideoFrameCallback(inspectFrame);
    };
    pendingVisualFrameInspector = inspectFrame;
    video.requestVideoFrameCallback(inspectFrame);
  };

  const armAppAcknowledgement = (sequence, pointer) => {
    const {startedAt, ackController, ackCheckpoint} = pointer;
    inputAppAckStatus = 'waiting';
    latestInputToAppAckMs = null;
    latestInputReleaseToAppAckMs = null;
    inputAppAckAction = '';
    if (interactionAckTimeout) clearTimeout(interactionAckTimeout);
    interactionAckTimeout = window.setTimeout(() => {
      if (sequence !== interactionAckSequence || inputAppAckStatus !== 'waiting') return;
      inputAppAckStatus = 'timeout';
      recordLatency(pointer, 'appAck', 'timeout');
      inputToAppAckSampledAt = wallNow();
      ackController.abort();
    }, Math.max(0, INPUT_FRAME_TIMEOUT_MS - (performance.now() - startedAt)));
    ackCheckpoint.then((checkpoint) => {
      if (!checkpoint) throw new Error('Interaction checkpoint unavailable');
      if (sequence !== interactionAckSequence || inputAppAckStatus !== 'waiting') return null;
      return loadInteractionAck(checkpoint, 5000, ackController.signal);
    })
      .then((ack) => {
        if (sequence !== interactionAckSequence || inputAppAckStatus !== 'waiting') return;
        clearTimeout(interactionAckTimeout);
        interactionAckTimeout = null;
        if (!ack) {
          inputAppAckStatus = 'timeout';
          recordLatency(pointer, 'appAck', 'timeout');
          inputToAppAckSampledAt = wallNow();
          return;
        }
        // A checkpoint may arrive after a fast handler already ran. In that
        // case this sample times out instead of reusing a pre-checkpoint ACK.
        if (pointer.releasedAt == null) {
          inputAppAckStatus = 'ambiguous';
          recordLatency(pointer, 'appAck', 'ambiguous');
          inputToAppAckSampledAt = wallNow();
          return;
        }
        latestInputToAppAckMs = Math.max(0, performance.now() - startedAt);
        latestInputReleaseToAppAckMs = Math.max(0, performance.now() - pointer.releasedAt);
        inputToAppAckSampledAt = wallNow();
        inputAppAckAction = ack.action;
        inputAppAckStatus = 'received';
        recordLatency(pointer, 'appAck', 'received', latestInputToAppAckMs);
      })
      .catch((error) => {
        if (error?.name === 'AbortError' || sequence !== interactionAckSequence
            || inputAppAckStatus !== 'waiting') return;
        clearTimeout(interactionAckTimeout);
        interactionAckTimeout = null;
        inputAppAckStatus = 'unavailable';
        recordLatency(pointer, 'appAck', 'unavailable');
        inputToAppAckSampledAt = wallNow();
      });
  };

  const invalidateAcknowledgement = () => {
    if (inputAppAckStatus !== 'waiting') return;
    inputAppAckStatus = 'ambiguous';
    inputToAppAckSampledAt = wallNow();
    recordLatency(activePointerSample, 'appAck', 'ambiguous');
    interactionAckController?.abort();
    clearTimeout(interactionAckTimeout);
  };

  const invalidateInputMeasurements = () => {
    invalidateAcknowledgement();
    pendingPointerPress?.ackController.abort();
    pendingPointerPress = null;
    clearTimeout(pendingPointerTimeout);
    for (const [metric, status] of [['nextFrame', inputNextFrameStatus], ['visual', inputVisualChangeStatus]]) {
      if (status === 'waiting') recordLatency(activePointerSample, metric, 'unavailable');
    }
    if (inputNextFrameStatus === 'waiting') inputNextFrameStatus = 'unavailable';
    if (inputVisualChangeStatus === 'waiting') inputVisualChangeStatus = 'unavailable';
    clearTimeout(inputFrameTimeout);
    clearTimeout(inputFrameRefreshTimer);
    clearTimeout(visualFrameTimeout);
    pendingVisualFrameInspector = null;
    inputFrameSequence += 1;
    visualFrameSequence += 1;
    interactionAckSequence += 1;
    activePointerSample = null;
  };

  const capturePointerPress = (event) => {
    if (!embedded) return;
    const video = document.querySelector('video');
    if (!video || typeof video.requestVideoFrameCallback !== 'function') return;
    const rect = video.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right
        || event.clientY < rect.top || event.clientY > rect.bottom) return;
    invalidateAcknowledgement();
    if ([inputNextFrameStatus, inputVisualChangeStatus, inputAppAckStatus].includes('waiting')) return;
    if (pendingPointerTimeout) clearTimeout(pendingPointerTimeout);
    interactionAckController?.abort();
    interactionAckController = new AbortController();
    pendingPointerPress = {
      startedAt: performance.now(),
      pointerId: event.pointerId,
      releasedAt: null,
      ackController: interactionAckController,
      ackCheckpoint: loadInteractionCheckpoint(interactionAckController.signal),
      baseline: snapshotVideo(currentVisualSource(video)),
      normalizedX: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      normalizedY: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
    pendingPointerTimeout = window.setTimeout(() => {
      pendingPointerPress?.ackController.abort();
      pendingPointerPress = null;
      pendingPointerTimeout = null;
    }, 2000);
  };

  const capturePointerRelease = (event) => {
    const pointer = pendingPointerPress || activePointerSample;
    if (!pointer || pointer.pointerId !== event.pointerId || pointer.releasedAt != null) return;
    pointer.releasedAt = performance.now();
    inputPressDurationMs = pointer.releasedAt - pointer.startedAt;
  };

  const armInputMeasurements = (event) => {
    const detail = event?.detail || {};
    if (!pendingPointerPress || !['mouse', 'touch'].includes(detail.label)) return;
    const video = document.querySelector('video');
    if (!video || typeof video.requestVideoFrameCallback !== 'function') return;
    const pointer = pendingPointerPress;
    activePointerSample = pointer;
    pointer.mediaMode = currentMediaMode();
    pointer.metrics = Object.fromEntries(['nextFrame', 'visual', 'appAck'].map(metric => [metric, {status: 'waiting', value: null}]));
    latencySamples.push(pointer);
    if (latencySamples.length > LATENCY_WINDOW_SIZE) latencySamples.shift();
    inputPressDurationMs = pointer.releasedAt == null ? null : pointer.releasedAt - pointer.startedAt;
    pendingPointerPress = null;
    if (pendingPointerTimeout) clearTimeout(pendingPointerTimeout);
    pendingPointerTimeout = null;
    const startedAt = pointer.startedAt;
    const dispatchedAt = finiteNumber(detail.dispatchedAt) ?? performance.now();
    inputDispatchDelayMs = Math.max(0, dispatchedAt - startedAt);
    const sequence = ++inputFrameSequence;
    visualFrameSequence += 1;
    interactionAckSequence += 1;
    inputNextFrameStatus = 'waiting';
    latestInputToNextFrameMs = null;
    if (inputFrameRefreshTimer) clearTimeout(inputFrameRefreshTimer);
    if (inputFrameTimeout) clearTimeout(inputFrameTimeout);
    let refreshAttempts = 0;
    const refreshPendingPicture = () => {
      inputFrameRefreshTimer = null;
      if (sequence !== inputFrameSequence
          || ![inputNextFrameStatus, inputVisualChangeStatus].includes('waiting')) return;
      // Continuous screenshot capture already samples the newest display.
      // An APK redraw cannot repair network loss; the bridge closes a starved
      // track and the driver falls back to native capture with its redraw guard.
      if (window.__mallDemoJsepDriver?.wsUrl?.endsWith('/ws-jsep-latest')) return;
      requestFrameRefresh('input-stall');
      refreshAttempts += 1;
      if (refreshAttempts < INPUT_FRAME_REFRESH_ATTEMPTS) {
        inputFrameRefreshTimer = window.setTimeout(refreshPendingPicture, INPUT_FRAME_REFRESH_RETRY_MS);
      }
    };
    inputFrameRefreshTimer = window.setTimeout(refreshPendingPicture, INPUT_FRAME_REFRESH_MS);
    inputFrameTimeout = window.setTimeout(() => {
      if (sequence !== inputFrameSequence || inputNextFrameStatus !== 'waiting') return;
      inputNextFrameStatus = 'timeout';
      recordLatency(pointer, 'nextFrame', 'timeout');
      inputToNextFrameSampledAt = wallNow();
    }, INPUT_FRAME_TIMEOUT_MS);
    video.requestVideoFrameCallback((presentedAt) => {
      if (sequence !== inputFrameSequence || inputNextFrameStatus !== 'waiting') return;
      clearTimeout(inputFrameTimeout);
      inputFrameTimeout = null;
      latestInputToNextFrameMs = Math.max(0, presentedAt - startedAt);
      inputToNextFrameSampledAt = wallNow();
      inputNextFrameStatus = 'received';
      recordLatency(pointer, 'nextFrame', 'received', latestInputToNextFrameMs);
    });
    armVisualChange(
      video,
      pointer.baseline,
      pointer.normalizedX,
      pointer.normalizedY,
      visualFrameSequence,
      startedAt,
      pointer,
    );
    armAppAcknowledgement(interactionAckSequence, pointer);
  };

  const handleDroppedInput = (event) => {
    if (!pendingPointerPress || !['mouse', 'touch'].includes(event?.detail?.label)) return;
    pendingPointerPress.ackController.abort();
    pendingPointerPress = null;
    if (pendingPointerTimeout) clearTimeout(pendingPointerTimeout);
    pendingPointerTimeout = null;
    inputNextFrameStatus = 'input-not-ready';
    inputVisualChangeStatus = 'unavailable';
    inputAppAckStatus = 'unavailable';
  };

  const selectedCandidatePair = (stats) => {
    let selectedPairId = '';
    stats.forEach((report) => {
      if (report.type === 'transport' && report.selectedCandidatePairId) {
        selectedPairId = report.selectedCandidatePairId;
      }
    });
    if (selectedPairId) return stats.get(selectedPairId) || null;
    let fallback = null;
    stats.forEach((report) => {
      if (!fallback && report.type === 'candidate-pair'
          && report.state === 'succeeded' && report.nominated) {
        fallback = report;
      }
    });
    return fallback;
  };

  const sampleWebRtc = async () => {
    const driver = window.__mallDemoJsepDriver;
    const peerConnection = driver?.peerConnection;
    void loadDeviceDiagnostics();
    const device = cachedDeviceDiagnostics;
    startVideoFrameMonitor(document.querySelector('video'), driver, peerConnection || null);
    if (!peerConnection) {
      previousVideoSample = null;
      publish('webrtc-stats', {
        connectionState: driver?.connected ? 'connecting' : 'disconnected',
        iceConnectionState: 'new',
        signalingState: 'stable',
        inputChannels: [],
        sampledAt: wallNow(),
        device,
      });
      return;
    }

    if (statsRequest?.peerConnection === peerConnection) return;
    const request = {peerConnection};
    statsRequest = request;
    try {
      const stats = await peerConnection.getStats();
      if (peerConnection !== window.__mallDemoJsepDriver?.peerConnection) return;
      let inboundVideo = null;
      let sctpTransport = null;
      stats.forEach((report) => {
        if (!inboundVideo && report.type === 'inbound-rtp'
            && (report.kind === 'video' || report.mediaType === 'video')) {
          inboundVideo = report;
        }
        if (!sctpTransport && report.type === 'sctp-transport') {
          sctpTransport = report;
        }
      });

      const pair = selectedCandidatePair(stats);
      const localCandidate = pair?.localCandidateId ? stats.get(pair.localCandidateId) : null;
      const remoteCandidate = pair?.remoteCandidateId ? stats.get(pair.remoteCandidateId) : null;
      const codec = inboundVideo?.codecId ? stats.get(inboundVideo.codecId) : null;
      const now = wallNow();
      const received = finiteNumber(inboundVideo?.packetsReceived) || 0;
      const lost = finiteNumber(inboundVideo?.packetsLost) || 0;
      const bytes = finiteNumber(inboundVideo?.bytesReceived) || 0;
      const frames = finiteNumber(inboundVideo?.framesDecoded) || 0;
      const reportKey = `${inboundVideo?.id}:${inboundVideo?.ssrc}`;
      if (previousVideoSample && (previousVideoSample.peerConnection !== peerConnection
          || previousVideoSample.reportKey !== reportKey || frames < previousVideoSample.frames
          || bytes < previousVideoSample.bytes || received < previousVideoSample.received)) previousVideoSample = null;
      const elapsedSeconds = previousVideoSample
        ? Math.max((now - previousVideoSample.sampledAt) / 1000, 0.001)
        : 0;
      const receivedDelta = previousVideoSample ? Math.max(received - previousVideoSample.received, 0) : received;
      const lostDelta = previousVideoSample ? Math.max(lost - previousVideoSample.lost, 0) : Math.max(lost, 0);
      const packetDelta = receivedDelta + lostDelta;
      const decodedFps = finiteNumber(inboundVideo?.framesPerSecond)
        ?? (elapsedSeconds ? Math.max(frames - previousVideoSample.frames, 0) / elapsedSeconds : null);
      const bitrateKbps = elapsedSeconds
        ? Math.max(bytes - previousVideoSample.bytes, 0) * 8 / elapsedSeconds / 1000
        : null;
      const sctpRttSeconds = finiteNumber(sctpTransport?.smoothedRoundTripTime)
        ?? finiteNumber(sctpTransport?.roundTripTime);
      const jitterBufferDelaySeconds = finiteNumber(inboundVideo?.jitterBufferDelay);
      const jitterBufferEmittedCount = finiteNumber(inboundVideo?.jitterBufferEmittedCount);
      const intervalAverage = (total, count, previousTotal, previousCount) => {
        if (!previousVideoSample || ![total, count, previousTotal, previousCount].every(Number.isFinite)
            || total < previousTotal || count <= previousCount) return null;
        return (total - previousTotal) / (count - previousCount) * 1000;
      };
      const jitterBufferAverageMs = intervalAverage(jitterBufferDelaySeconds, jitterBufferEmittedCount,
        previousVideoSample?.jitterBufferDelaySeconds, previousVideoSample?.jitterBufferEmittedCount);
      const totalDecodeTimeSeconds = finiteNumber(inboundVideo?.totalDecodeTime);
      const averageDecodeTimeMs = intervalAverage(totalDecodeTimeSeconds, frames,
        previousVideoSample?.totalDecodeTimeSeconds, previousVideoSample?.frames);
      previousVideoSample = { sampledAt: now, peerConnection, reportKey, received, lost, bytes, frames,
        jitterBufferDelaySeconds, jitterBufferEmittedCount, totalDecodeTimeSeconds };

      const inputChannels = driver?.event_forwarders
        ? Object.entries(driver.event_forwarders).map(([label, channel]) => ({
            label,
            state: channel.readyState,
          }))
        : [];
      startVideoFrameMonitor(
        document.querySelector('video'),
        driver,
        peerConnection,
      );

      publish('webrtc-stats', {
        connectionState: peerConnection.connectionState,
        iceConnectionState: peerConnection.iceConnectionState,
        signalingState: peerConnection.signalingState,
        rttMs: finiteNumber(pair?.currentRoundTripTime) === null
          ? null
          : pair.currentRoundTripTime * 1000,
        dataChannelRttMs: sctpRttSeconds === null ? null : sctpRttSeconds * 1000,
        packetLossPercent: packetDelta ? lostDelta / packetDelta * 100 : 0,
        decodedFps,
        bitrateKbps,
        jitterMs: finiteNumber(inboundVideo?.jitter) === null ? null : inboundVideo.jitter * 1000,
        jitterBufferAverageMs,
        videoSource: driver?.wsUrl?.endsWith('/ws-jsep-latest') ? 'latest-frame' : 'emulator-native',
        averageDecodeTimeMs,
        statsIntervalMs: elapsedSeconds ? elapsedSeconds * 1000 : null,
        videoFrameTiming: {...latestVideoFrameTiming,
          sinceLastFrameMs: lastPresentedFrameAt ? now - lastPresentedFrameAt : null},
        latencyWindow: summarizeLatency(),
        inputReleaseToAppAckMs: latestInputReleaseToAppAckMs,
        inputPressDurationMs,
        freezeCount: finiteNumber(inboundVideo?.freezeCount),
        freezeDurationMs: finiteNumber(inboundVideo?.totalFreezesDuration) === null
          ? null
          : inboundVideo.totalFreezesDuration * 1000,
        inputToNextFrameMs: latestInputToNextFrameMs,
        inputToNextFrameSampledAt,
        inputNextFrameStatus,
        inputDispatchDelayMs,
        inputToVisualChangeMs: latestInputToVisualChangeMs,
        inputToVisualChangeSampledAt,
        inputVisualChangeScorePercent,
        inputVisualChangeStatus,
        inputToAppAckMs: latestInputToAppAckMs,
        inputToAppAckSampledAt,
        inputAppAckAction,
        inputAppAckStatus,
        packetsReceived: received,
        packetsLost: lost,
        framesDecoded: frames,
        presentedCallbackCount,
        videoPixelsUsable,
        videoPlaybackTime: finiteNumber(monitoredVideo?.currentTime),
        pageVisibility: document.visibilityState || 'unknown',
        framesDropped: finiteNumber(inboundVideo?.framesDropped),
        frameWidth: finiteNumber(inboundVideo?.frameWidth),
        frameHeight: finiteNumber(inboundVideo?.frameHeight),
        codec: typeof codec?.mimeType === 'string' ? codec.mimeType.replace(/^video\//, '') : '',
        localCandidateType: localCandidate?.candidateType || '',
        remoteCandidateType: remoteCandidate?.candidateType || '',
        protocol: localCandidate?.protocol || remoteCandidate?.protocol || '',
        relayProtocol: localCandidate?.relayProtocol || '',
        inputChannels,
        mediaReadiness,
        firstPresentedFrameAt,
        lastPresentedFrameAt,
        frameRefreshCount,
        frameRefreshStatus,
        sampledAt: now,
        device,
      });
    } catch (error) {
      publish('player-error', {
        message: error instanceof Error ? error.message : String(error),
        sampledAt: wallNow(),
      });
    } finally {
      if (statsRequest === request) statsRequest = null;
    }
  };

  window.addEventListener('error', (event) => {
    console.error('Uncaught Exception:', event.error || event.message);
    publish('player-error', { message: event.message || 'Uncaught player error', sampledAt: wallNow() });
  });
  window.setInterval(sampleWebRtc, 1000);
  window.addEventListener('mall-demo-peer-connection', sampleWebRtc);
  document.addEventListener('pointerdown', capturePointerPress, { capture: true, passive: true });
  document.addEventListener('pointerup', capturePointerRelease, { capture: true, passive: true });
  document.addEventListener('pointercancel', invalidateInputMeasurements, { capture: true, passive: true });
  document.addEventListener('keydown', invalidateAcknowledgement, { capture: true, passive: true });
  window.addEventListener('mall-demo-input-dispatched', armInputMeasurements);
  window.addEventListener('mall-demo-input-dispatched', refreshAfterDispatchedInput);
  window.addEventListener('mall-demo-input-dropped', handleDroppedInput);
  scheduleFrameFallback(FIRST_FRAME_TIMEOUT_MS);
  publish('player-ready', { sampledAt: wallNow() });
}
