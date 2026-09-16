# Android launcher icon deployment — 2026-09-15

Reused `order-service/src/main/resources/static/assets/android-storefront-scene-icon.png`
for Android launcher and round launcher resources at 48/72/96/144/192 px.

Safe Release 2.3.16 (9), x86_64 + arm64-v8a, jankfix02 SDK pair,
existing gateway-proxy configuration. APK SHA-256:
`3d85a00cf226e76f4b34b465ab6ea07c2d7297adbfd7316b4b8c8652a67b0a95`.

Installed with `adb install -r` on GCP `mall-demo-kvm-emulator-poc`,
project `twt-gcp-integration`, zone `asia-east2-a`. Updated
`/opt/mall-demo-webrtc/app-safe-release.apk` and
`/var/www/downloads/mall-demo-safe.apk`; both hashes match.
Previous APK: `/opt/mall-demo-webrtc/backups/icon-20260915/app-safe-release.apk`.
Local artifact: `mobile-app/build/releases/icon-20260915/app-safe-release.apk`.

Build, typecheck, lint and 87 tests passed. Launch succeeded; emulator returned
HOME after verification, app stopped after background buffer. Services active.
No USB device connected; physical phone was not updated.

## Circular adaptive icon follow-up

Added API 26+ adaptive launcher resources using a full gradient background and
safe-zone robot vector foreground. Both icon and roundIcon select these resources;
older Android versions retain the legacy PNGs. This removes launcher's white
legacy-icon wrapper on the GCP Android desktop.

Rebuilt and installed with `adb install -r`; build including lintVital passed.
Updated both GCP APK paths. SHA-256:
`0d6297b596af78fdc9a957cefdd81985dee06c556a27f0acd79760282b6123e8`.
Backup: `/opt/mall-demo-webrtc/backups/round-icon-20260915/app-safe-release.apk`.
