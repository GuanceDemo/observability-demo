#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
: "${VEHICLE_KEYSTORE:?Set VEHICLE_KEYSTORE to a private signing keystore outside the repository}"
: "${VEHICLE_STORE_PASSWORD:?Set signing password}"
: "${VEHICLE_KEY_PASSWORD:?Set key password}"
./gradlew :app:assembleRelease :app:lintRelease :app:testDebugUnitTest --console=plain
sha256sum app/build/outputs/apk/release/app-release.apk > app/build/outputs/apk/release/app-release.apk.sha256
