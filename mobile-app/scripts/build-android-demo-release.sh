#!/usr/bin/env bash
# GCP demo build entry point: paired SDK patches and final APK verification.
set -euo pipefail
mobile_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${MALL_DEMO_GATEWAY_URL:?Set the deployment gateway URL}"
cd "${mobile_root}"
python3 scripts/build-ft-sdk-patch.py
(
  cd android
  ./gradlew -I ../sdk-patches/ft-sdk-1.7.5/use-local.gradle assembleSafeRelease \
    -PMALL_DEMO_NATIVE_CRASH=true -PMALL_DEMO_NATIVE_PERFORMANCE=true -PMALL_DEMO_CHECKOUT_CRASH=true -PMALL_DEMO_REMOTE_CONTROL=true \
    "-PMALL_DEMO_GATEWAY_URL=${MALL_DEMO_GATEWAY_URL}"
)
bash scripts/verify-android-replay-reflection.sh --patched
python3 scripts/verify-native-crash.py \
  android/app/build/outputs/apk/safe/release/app-safe-release.apk \
  android/app/build/outputs/native-debug-symbols/safeRelease/native-debug-symbols.zip --enabled
