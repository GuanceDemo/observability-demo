#!/usr/bin/env bash
set -euo pipefail

require_patched=false
if [[ "${1:-}" == "--patched" ]]; then
  require_patched=true
  shift
fi

if command -v apkanalyzer >/dev/null 2>&1; then
  apk_analyzer="$(command -v apkanalyzer)"
else
  android_sdk_root="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
  apk_analyzer="${android_sdk_root}/cmdline-tools/latest/bin/apkanalyzer"
fi

if [[ ! -x "${apk_analyzer}" ]]; then
  echo "apkanalyzer was not found; install Android SDK Command-line Tools." >&2
  exit 1
fi

if [[ "$#" -eq 0 ]]; then
  set -- "android/app/build/outputs/apk/safe/release/app-safe-release.apk"
fi

for apk_path in "$@"; do
  if [[ ! -f "${apk_path}" ]]; then
    echo "APK does not exist: ${apk_path}" >&2
    exit 1
  fi

  background_code="$(
    "${apk_analyzer}" dex code \
      --class com.facebook.react.uimanager.drawable.BackgroundDrawable \
      "${apk_path}"
  )"
  text_code="$(
    "${apk_analyzer}" dex code \
      --class com.facebook.react.views.text.ReactTextView \
      "${apk_path}"
  )"
  border_code="$(
    "${apk_analyzer}" dex code \
      --class com.facebook.react.uimanager.drawable.BorderDrawable \
      "${apk_path}"
  )"
  border_colors_code="$(
    "${apk_analyzer}" dex code \
      --class com.facebook.react.uimanager.style.BorderColors \
      "${apk_path}"
  )"
  replay_config_code="$(
    "${apk_analyzer}" dex code \
      --class com.ft.sdk.sessionreplay.BuildConfig \
      "${apk_path}"
  )"
  replay_resource_callback_code="$(
    "${apk_analyzer}" dex code \
      --class com.ft.sdk.sessionreplay.SessionReplayResourceUploadCallback \
      "${apk_path}"
  )"
  replay_sdk_callback_code="$(
    "${apk_analyzer}" dex code \
      --class 'com.ft.sdk.sessionreplay.SDKFeature$1' \
      "${apk_path}"
  )"

  grep -Fq \
    '.class public final Lcom/facebook/react/uimanager/drawable/BackgroundDrawable;' \
    <<<"${background_code}"
  grep -Eq '^\.field .* backgroundColor:I$' <<<"${background_code}"
  grep -Eq '^\.field .* borderRadius:' <<<"${background_code}"
  grep -Fq '.class public final Lcom/facebook/react/uimanager/drawable/BorderDrawable;' <<<"${border_code}"
  for field in context borderInsets borderColors borderRadius; do
    grep -Eq "^\\.field .* ${field}:" <<<"${border_code}"
  done
  grep -Fq 'resolve-impl([Ljava/lang/Integer;ILandroid/content/Context;)' <<<"${border_colors_code}"
  grep -Fq \
    '.class public Lcom/facebook/react/views/text/ReactTextView;' \
    <<<"${text_code}"
  grep -Eq '^\.field .* mSpanned:Landroid/text/Spannable;$' <<<"${text_code}"
  expected_replay_version=0.1.8
  if [[ "${require_patched}" == true ]]; then
    expected_replay_version=0.1.9-alpha03
  fi
  if ! grep -Fq "VERSION_NAME:Ljava/lang/String; = \"${expected_replay_version}\"" <<<"${replay_config_code}"; then
    echo "Unexpected Replay version in final APK; expected ${expected_replay_version}: ${apk_path}" >&2
    exit 1
  fi
  grep -Fq \
    '.method public abstract onCheckFilesExist(Ljava/lang/String;Ljava/util/List;Ljava/util/Map;)Lcom/ft/sdk/sessionreplay/internal/storage/UploadResult;' \
    <<<"${replay_resource_callback_code}"
  grep -Fq \
    '.method public onCheckFilesExist(Ljava/lang/String;Ljava/util/List;Ljava/util/Map;)Lcom/ft/sdk/sessionreplay/internal/storage/UploadResult;' \
    <<<"${replay_sdk_callback_code}"

  if [[ "${require_patched}" == true ]]; then
    compressor_code="$("${apk_analyzer}" dex code --class com.ft.sdk.sessionreplay.internal.net.BytesCompressor "${apk_path}")"
    if grep -Fq -- '->reset()V' <<<"${compressor_code}"; then
      echo "Rejected legacy Replay compressor in final APK: ${apk_path}" >&2
      exit 1
    fi
    grep -Fq -- '->deflate([BIII)I' <<<"${compressor_code}"
    resolver_code="$("${apk_analyzer}" dex code --class com.ft.sdk.sessionreplay.internal.recorder.PermanentIdResolver "${apk_path}")"
    grep -Fq 'Lcom/ft/sdk/FTViewPermanentIdResolver$Snapshot;' <<<"${resolver_code}"
    echo "Final APK Replay compression and paired traversal patches verified: ${apk_path}"
  fi
  echo "Session Replay reflection and resource-upload ABI verified: ${apk_path}"
done
