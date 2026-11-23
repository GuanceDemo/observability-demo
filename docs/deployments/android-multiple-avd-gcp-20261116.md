# GCP mall Android gateway recovery

## Incident

On 2026-11-16, the GCP VM `mall-demo-kvm-emulator-poc` in project
`twt-gcp-integration`, zone `asia-east2-a`, was running and both Android devices
were online. The mall gateway repeatedly exited after its 180-second discovery
wait (restart count reached 1443). Its Bash launcher used `find -print -quit`,
which selected the live vehicle discovery file on gRPC port 8556 and never
examined the mall endpoint on 8554. The video bridge restarted with the gateway.

## Change and deployment

- Replaced the mall gateway launcher with the existing shared discovery helper,
  selecting a live PID, port 8554 and a nonempty token, then passing the selected
  discovery file to the gateway. Tokens are not logged.
- Installed `/usr/local/bin/mall-demo-gateway` and the repository version of
  `/opt/mall-demo-webrtc/latest-video/discovery.py`.
- The first launcher-only update exposed an older deployed helper that lacked
  `grpc_port` and `discovery.path`; synchronizing the helper resolved the
  incompatibility. Both files must be treated as one deployment unit.
- Backups are under
  `/opt/mall-demo-webrtc/backups/gateway-multiple-avd-20261116/`.
- Restarted only `mall-demo-gateway.service` and
  `mall-demo-latest-video.service`. Their final start time is
  `2026-11-16 09:40:34 UTC`.

Installed SHA-256:

| File | SHA-256 |
|---|---|
| mall-demo-gateway | `5a4a87e0e25773f9c47e03bca2c7f1b6a72be27d0d8d5441c9541030e31fa012` |
| discovery.py | `ab360eee69deb8f593c93a01877ab69bd7fabe03ec7b425d6c39d660c703cfcc` |

## Verification

- Five discovery/launcher tests passed, including a live vehicle discovery file
  before the mall file and a vehicle-only directory. Syntax and diff checks passed.
- The installed launcher was imported on GCP and run against the installed
  helper with `execv` intercepted. It selected the real mall discovery path on
  8554 and gateway port 8080 without printing credentials.
- Both mall connection services remained active beyond the old 180-second
  retry cycle. Gateway restart count stayed at 42 after the final correction;
  the video bridge restart count stayed at zero.
- Both emulators and the vehicle gateway/video services remained active; their
  start times stayed at `2026-11-13 06:55:52 UTC`.
- The browser displayed the real Android launcher and bookstore homepage.
  Clicking the launcher icon started the APK, and the workbench loaded the
  actual Android fault catalog with phase `idle`.
- Browser diagnostics reported `connectionState=connected`,
  `mediaReadiness=ready`, 720x1600 VP8 and open native input channels. The
  observed session used the existing native-video fallback after the initial
  latest-frame attempt; sustained latest-frame operation is not claimed.
- The workbench connection history still rendered “等待播放器” for connected
  transport events. This UI label discrepancy was not part of the gateway
  deployment; live diagnostics and visible frames established readiness.

APK remains `2.3.32` (`versionCode=25`, `minSdk=24`). Application data, Java
images, Helm configuration, RUM version and SourceMaps were not changed.
No VM/emulator reboot, APK reinstall, fault injection or Git push was performed.
The existing idle return-to-home policy is retained. RUM/Replay ingestion was
not revalidated during this infrastructure recovery.
