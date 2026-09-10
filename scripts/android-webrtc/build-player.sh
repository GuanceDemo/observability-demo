#!/usr/bin/env bash

set -euo pipefail

if [[ $# -gt 1 ]]; then
  echo "usage: $0 [output-directory]" >&2
  exit 2
fi

for command_name in git npm protoc rsync; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "missing build dependency: $command_name" >&2
    exit 2
  fi
done

SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPSTREAM_COMMIT=0654f694b46794fae4b178f1e1a17cb60c5d2d34
OUTPUT_ROOT="${1:-$SCRIPT_ROOT/player-dist}"
BUILD_ROOT="$(mktemp -d)"
UPSTREAM_ROOT="$BUILD_ROOT/android-emulator-container-scripts"

cleanup() {
  rm -rf "$BUILD_ROOT"
}
trap cleanup EXIT

git clone --filter=blob:none --no-checkout \
  https://github.com/google/android-emulator-container-scripts.git \
  "$UPSTREAM_ROOT"
git -C "$UPSTREAM_ROOT" fetch --depth=1 origin "$UPSTREAM_COMMIT"
git -C "$UPSTREAM_ROOT" checkout --detach "$UPSTREAM_COMMIT"
git -C "$UPSTREAM_ROOT" apply "$SCRIPT_ROOT/templates/player-embedded.patch"
git -C "$UPSTREAM_ROOT" apply "$SCRIPT_ROOT/templates/player-input-channel.patch"
git -C "$UPSTREAM_ROOT" apply --recount "$SCRIPT_ROOT/templates/player-low-latency.patch"
git -C "$UPSTREAM_ROOT" apply --recount "$SCRIPT_ROOT/templates/player-debug-telemetry.patch"
git -C "$UPSTREAM_ROOT" apply --recount "$SCRIPT_ROOT/templates/player-readiness-recovery.patch"
git -C "$UPSTREAM_ROOT" apply --recount "$SCRIPT_ROOT/templates/player-latest-video.patch"
install -m 0644 "$SCRIPT_ROOT/player/diagnostics.js" \
  "$UPSTREAM_ROOT/js/example/src/mall-demo-diagnostics.js"
install -m 0644 "$SCRIPT_ROOT/player/playback.ts" \
  "$UPSTREAM_ROOT/js/src/components/emulator/views/mall-demo-playback.ts"

# The pinned upstream commit's lock files are not accepted by current npm
# (`js@2.0.0` is missing from its own lock metadata), so a clean `npm ci`
# fails before dependency resolution. The checkout is disposable and pinned;
# install from those lock constraints without writing anything to this repo.
install -m 0644 "$SCRIPT_ROOT/player/transport.ts" \
  "$UPSTREAM_ROOT/js/src/components/emulator/net/mall-demo-transport.ts"
npm install --no-audit --no-fund --prefix "$UPSTREAM_ROOT/js"

# Upstream intentionally does not check in the generated JavaScript protobuf
# module consumed by the WebRTC input channel. Generate it before Vite resolves
# the library sources; the matching declaration file is tracked upstream.
mkdir -p "$UPSTREAM_ROOT/js/src/proto"
PATH="$UPSTREAM_ROOT/js/node_modules/.bin:$PATH" protoc \
  -I "$UPSTREAM_ROOT/js/proto" \
  --js_out="import_style=commonjs,binary:$UPSTREAM_ROOT/js/src/proto" \
  "$UPSTREAM_ROOT/js/proto/emulator_controller.proto"

npm install --no-audit --no-fund --prefix "$UPSTREAM_ROOT/js/example"
npm run build --prefix "$UPSTREAM_ROOT/js/example"

mkdir -p "$OUTPUT_ROOT"
rsync -a --delete "$UPSTREAM_ROOT/js/example/dist/" "$OUTPUT_ROOT/"

printf 'Built player at %s\n' "$OUTPUT_ROOT"
