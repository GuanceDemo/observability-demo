#!/usr/bin/env bash
set -euo pipefail

platform="${1:-}"
case "${platform}" in
  android)
    bundle_name="index.android.bundle"
    asset_directory="android-assets"
    ;;
  ios)
    bundle_name="main.jsbundle"
    asset_directory="ios-assets"
    ;;
  *)
    echo "usage: $0 <android|ios>" >&2
    exit 2
    ;;
esac

root_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_directory="${root_directory}/build/sourcemaps"
mkdir -p "${output_directory}/${asset_directory}"

cd "${root_directory}"
npx react-native bundle \
  --platform "${platform}" \
  --dev false \
  --minify true \
  --entry-file index.js \
  --bundle-output "${output_directory}/${bundle_name}" \
  --sourcemap-output "${output_directory}/${bundle_name}.map" \
  --assets-dest "${output_directory}/${asset_directory}"
