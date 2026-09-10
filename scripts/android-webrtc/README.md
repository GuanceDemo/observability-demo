# Android Emulator WebRTC POC

This provisioner turns an existing Linux KVM Android Emulator VM into an HTTPS WebRTC endpoint for the Mall Demo workbench.

It installs and configures:

- the pinned Google `android-emulator-container-scripts` Python gateway;
- a pinned, shallow checkout of the official AOSP Emulator protobuf definitions mirrored in Android Tools Base and used to build that gateway;
- Android Emulator gRPC with per-process bearer-token discovery;
- coturn with a narrow UDP relay range;
- Caddy for TLS, static player assets, WebSocket, and HTTP proxying;
- a stable HTTPS APK download plus a deployment-generated QR code;
- an optional full Mall Demo workbench on loopback port 18080;
- systemd units that reinstall and launch the latest safe APK after a reboot.

The pinned upstream gateway currently omits the emulator bearer token in its direct-RTC path and hardcodes a public STUN server. The provisioner applies scoped compatibility patches so the token remains VM-local, the browser/emulator receive the VM-local coturn configuration, and TURN credentials are redacted from gateway logs.

The gateway is also patched to bind `127.0.0.1:8080`; Caddy is its only HTTP
caller. This is defense in depth in addition to the GCP firewall policy.

The pinned player also drops the supplied ICE servers and starts an offer at the
same time as the Emulator. `build-player.sh` applies the repository-owned player
patch so the browser uses TURN, ignores a duplicate `start`, and acts as the
answerer for the Emulator offer. A compatibility patch prefers the Emulator's
announced `mouse`, `keyboard`, and `touch` channels, then falls back to the
newer unified `input` channel. The embedded layout preserves the AVD's 9:20
aspect ratio and forwards browser input over WebRTC.

Readiness now requires a connected PeerConnection, an open input DataChannel,
and a sampled non-black first frame. If the first frame stalls, the player asks
the Gateway for one fixed APK redraw, allows another three seconds for the
first frame, and, if necessary, rebuilds signaling once;
one redraw is allowed on the reconnected peer and the recovery state then stops
after at most two total redraw requests.
The Gateway route is parameterless and can only invoke the configured APK's
explicit `REFRESH_FRAME` Activity action; requests are coalesced and the APK
uses two imperceptible one-frame overlay pulses that neither navigate nor reset
application state.

Input generated while SCTP is still opening is held in a 16-message, 1.5-second
ordered startup queue. Diagnostics begin only when dispatch is confirmed,
publish the queue delay, and retain the first in-flight click sample instead of
letting repeated clicks replace it. A click still waiting for a presented frame
or visible change after 250 ms requests the same bounded redraw, retrying every
second for at most three requests. An unchanged video frame does not cancel
recovery. The measurement still has a five-second deadline.

The POC uses a 720-by-1600, 293 dpi display. It preserves the former ~393 dp
viewport while reducing software-rendering and VP8-encoding work by 56% versus
1080-by-2400. The player requests the browser's minimum receiver/playout delay,
starts inline playback immediately, and omits the muted audio track from the
video element so A/V synchronization cannot add avoidable control latency.

The embedded player also publishes a credential-free diagnostics envelope to
its parent once per second. The workbench validates the configured player
origin and iframe window before showing RTT, interval packet loss, decoded FPS,
receive bitrate, selected direct/STUN/TURN route, codec/resolution, SCTP RTT
when the browser exposes it, interval jitter-buffer and decode delay, cumulative
freezes, the latest pointer-to-next-presented-frame delay, input channels, and
public Emulator status. The Gateway also exposes a fixed-command,
aggregate-only `gfxinfo` endpoint; the player polls it every 10 seconds for
p50/p90/p95 Android frame times. Candidate addresses, raw `dumpsys` output, ADB
command parameters, and TURN credentials are deliberately excluded.
Application fault selection remains inside the APK; the Web diagnostics panel
does not duplicate those controls.

Pointer diagnostics also report three independent timings: the next presented
video frame, the first material thumbnail change, and a structured APK handler
acknowledgement. The visual sampler runs only for the bounded measurement
window. The APK marker is normalized and read by one filtered Gateway Logcat
task; the public endpoint exposes only version, sequences, action, Android
elapsed time, and acknowledgement time. Raw Logcat is never returned. These
measurements mean frame delivery, first visible change, and `onPress` handler
acceptance respectively; none alone proves that asynchronous backend work has
finished.

Only TCP 80/443, TCP/UDP 3478, and UDP 49160-49200 should be public. Keep ADB, emulator console, gRPC, and the Python gateway private.

Build the pinned player locally first. The build host needs Git, Node.js/npm,
the Protocol Buffers compiler (`protoc`), and `rsync`:

```bash
./build-player.sh
```

The provisioner expects `player-dist/index.html` and `app-safe-release.apk` next
to the script. Copy the RUM-enabled safe APK into place, upload the whole
directory to the VM, then run:

```bash
./provision-poc.sh \
  emulator.example.com \
  203.0.113.10 \
  10.0.0.10 \
  0654f694b46794fae4b178f1e1a17cb60c5d2d34
```

The generated player URL is stored in `/var/lib/mall-demo-webrtc/player-url`. Configure the website with that value through `MOBILE_DEVICE_PLAYER_URL` or Helm `mobileDevice.playerUrl`.

The safe release APK is served as
`https://<public-host>/downloads/mall-demo-safe.apk`. The matching
`mall-demo-safe.svg` QR code is generated during provisioning from that final
URL. Both files live under `/var/www/downloads` on the Emulator host instead of
inside the order-service image.

When the Compose workbench is started with `DEMO_PORT=18080`, the catch-all
Caddy route publishes it on the same HTTPS origin. The more specific player and
random Gateway paths are evaluated first.

Use the DNS hostname for the HTTPS player and WebSocket gateway, but keep the
generated TURN URLs on the public IP. Some browsers resolve WebRTC service names
through a separate network process, while a literal address also avoids DNS
rebinding differences in restricted environments.

## Latency regression checks

Owned browser diagnostics live in `player/diagnostics.js`; the build copies this
module, `player/playback.ts`, and `player/transport.ts` into the disposable pinned checkout. Keep these
sources and the patches together when releasing. Do not edit `player-dist` by
hand. Receiver intervals reset per peer/report/SSRC; slow device HTTP requests
must not block media monitoring. Recent 100-sample distributions separate video,
snapshot, waiting and mixed modes, with timeouts and excluded samples kept out
of successful latency percentiles.

Snapshot fetch and decode belong to a cancellable generation. Input refresh
bursts are independent of sample admission and use `frame.png?fresh=1` to skip
completed cache entries while coalescing in-flight capture. Reconnected playback
replaces old same-kind tracks. Every measured press starts a non-blocking fresh
ACK checkpoint; bounded history plus an epoch rejects old/reset cursors. This
is conservative single-client correlation, not a propagated per-input ID.

```bash
node --test scripts/android-webrtc/tests/*.test.mjs
python3 scripts/android-webrtc/tests/gateway_test.py /path/to/patched/gateway_server.py
```

The Node tests require a Node version with native TypeScript stripping. Gateway
tests run the actual patched handlers through AST extraction with mocked network
and capture boundaries. Reapply the complete patch sequence to a clean pinned
checkout before running them. Run the checkout's TypeScript check and Vite build
as well as `mvn -pl order-service test` for workbench changes.

When shipping player or translation changes, update the workbench player build
ID and translation asset query version together. A cached iframe entrypoint can
otherwise keep loading the old hashed bundle even after a normal parent refresh.

For a session-only network comparison, append `&rtcTransport=relay` to the
workbench URL. The player then requests relay-only ICE without changing Gateway,
TURN credentials, or the default for other sessions. Remove the query to return
to normal ICE selection. Compare only foreground samples; inspect presented vs
decoded frame counts, playback time and page visibility before trusting a video
latency distribution. Background samples are not a comparable benchmark.

## Latest-frame video (2026-09-10)

The workbench selects `latestVideo=1`; `latestVideo=0` keeps native Emulator
WebRTC for comparison. Failed new connections automatically retry the native
route. The APK, physical display and SDK do not change.

`latest-video/bridge.py` serves only loopback port 8091. Caddy forwards two exact
paths under the existing access prefix. Install its separate pinned venv and
`mall-demo-latest-video.service` through `provision-poc.sh`. Native gateway 8080
remains required for input and diagnostics. Screenshot RPC permissions are
unchanged. Keep the service beside the Emulator and TURN.

Run `python tests/latest_video_test.py` inside `latest-video-venv` for all media
and lifecycle tests; running it without aiortc skips media tests and is not full
acceptance. Also run `node --test tests/*.test.mjs` and rebuild the player.
The queue is a single immutable latest picture; 30 Hz RTP continues for a static
image, with 30/10 Hz active/idle capture and no capture after the last disconnect.
`latest-video-stats` exposes queue/capture timings and playout negotiation.
Play-out delay is best effort, so network delay must be reported separately.

Rollback: restore the backed-up player entrypoint and workbench image, or set
`latestVideo=0` in the configured player URL. Restore Caddy if removing the
service. Do not replace the gateway venv or broaden the Emulator allowlist.

Android 播放器与 APK 支持独立运行时版本：`mobileDevice.playerVersion`、`mobileDevice.apkVersion`、`mobileDevice.apkMinAndroidVersion`。首次升级支持该配置的 order-service 后，后续 Android 发布无需重建 Java 镜像，详见 [Android 独立版本配置](../../docs/android-emulator-webrtc.md#android-独立版本配置)。
