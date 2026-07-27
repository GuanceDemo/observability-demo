#!/usr/bin/env bash
set -euo pipefail

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
  set -- "android/app/build/outputs/apk/demoFaults/release/app-demoFaults-release.apk"
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

  grep -Fq \
    '.class public final Lcom/facebook/react/uimanager/drawable/BackgroundDrawable;' \
    <<<"${background_code}"
  grep -Eq '^\.field .* backgroundColor:I$' <<<"${background_code}"
  grep -Eq '^\.field .* computedBorderRadius:' <<<"${background_code}"
  grep -Fq \
    '.class public Lcom/facebook/react/views/text/ReactTextView;' \
    <<<"${text_code}"
  grep -Eq '^\.field .* mSpanned:Landroid/text/Spannable;$' <<<"${text_code}"

  echo "Session Replay reflection contract verified: ${apk_path}"
done
