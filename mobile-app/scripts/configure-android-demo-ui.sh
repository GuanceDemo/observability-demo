#!/usr/bin/env bash

set -euo pipefail

ADB_BIN="${ADB_BIN:-adb}"
MODE="${1:-390}"

if [[ "$MODE" != "360" && "$MODE" != "390" && "$MODE" != "off" ]]; then
  echo "Usage: $0 [360|390|off]" >&2
  exit 2
fi

"$ADB_BIN" wait-for-device

if [[ "$MODE" == "off" ]]; then
  "$ADB_BIN" shell am broadcast \
    -a com.android.systemui.demo \
    -e command exit >/dev/null
  "$ADB_BIN" shell cmd statusbar send-disable-flag none >/dev/null
  "$ADB_BIN" shell wm density reset
  echo "Android demo viewport normalization disabled."
  exit 0
fi

if [[ "$MODE" == "360" ]]; then
  "$ADB_BIN" shell wm density 480
else
  "$ADB_BIN" shell wm density 440
fi

"$ADB_BIN" shell am broadcast \
  -a com.android.systemui.demo \
  -e command exit >/dev/null
"$ADB_BIN" shell cmd statusbar send-disable-flag notification-icons >/dev/null

echo "Android System UI normalized for the ${MODE}dp demo viewport with live network status."
