#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo "usage: $0 <public-host> <public-ip> <private-ip> <upstream-commit>" >&2
  exit 2
fi

PUBLIC_HOST="$1"
PUBLIC_IP="$2"
PRIVATE_IP="$3"
UPSTREAM_COMMIT="$4"
SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_ROOT="$SCRIPT_ROOT/templates"
INSTALL_ROOT=/opt/mall-demo-webrtc
UPSTREAM_ROOT="$INSTALL_ROOT/android-emulator-container-scripts"
AEMU_WORKSPACE="$INSTALL_ROOT/emu-main-next"
AEMU_PROTO_ROOT="$AEMU_WORKSPACE/hardware/google/aemu/protos"
TOOLS_BASE_ROOT="$INSTALL_ROOT/android-tools-base"
TOOLS_BASE_COMMIT=4e74507c931f725836deee44cd0cea04155d1d19
CONFIG_ROOT=/etc/mall-demo-webrtc
WEB_ROOT=/var/www/android-emulator-webrtc
RUNTIME_ROOT=/var/lib/mall-demo-webrtc
ANDROID_SDK_ROOT=/home/cherry/android-sdk
ANDROID_SERIAL=emulator-5554

if [[ ! -f "$SCRIPT_ROOT/app-safe-release.apk" || ! -f "$SCRIPT_ROOT/player-dist/index.html" ]]; then
  echo "app-safe-release.apk and player-dist/index.html must be next to the provisioner" >&2
  exit 2
fi

sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  caddy coturn git python3-venv qrencode

sudo install -d -m 0755 "$INSTALL_ROOT" "$CONFIG_ROOT" "$WEB_ROOT" "$RUNTIME_ROOT" /var/www/downloads
sudo chown -R cherry:cherry "$INSTALL_ROOT"
sudo install -m 0644 "$SCRIPT_ROOT/app-safe-release.apk" "$INSTALL_ROOT/app-safe-release.apk"
sudo install -m 0644 "$SCRIPT_ROOT/app-safe-release.apk" /var/www/downloads/mall-demo-safe.apk
qrencode -t SVG -o /tmp/mall-demo-safe.svg "https://$PUBLIC_HOST/downloads/mall-demo-safe.apk"
sudo install -m 0644 /tmp/mall-demo-safe.svg /var/www/downloads/mall-demo-safe.svg
sudo cp -a "$SCRIPT_ROOT/player-dist/." "$WEB_ROOT/"
sudo chown -R caddy:caddy "$WEB_ROOT" /var/www/downloads

if [[ ! -d "$UPSTREAM_ROOT/.git" ]]; then
  git clone https://github.com/google/android-emulator-container-scripts.git "$UPSTREAM_ROOT"
fi
git -C "$UPSTREAM_ROOT" fetch --depth=1 origin "$UPSTREAM_COMMIT"
git -C "$UPSTREAM_ROOT" checkout --detach "$UPSTREAM_COMMIT"
if ! git -C "$UPSTREAM_ROOT" apply --reverse --check "$TEMPLATE_ROOT/gateway-emulator-token.patch" >/dev/null 2>&1; then
  git -C "$UPSTREAM_ROOT" apply "$TEMPLATE_ROOT/gateway-emulator-token.patch"
fi
if ! git -C "$UPSTREAM_ROOT" apply --reverse --check "$TEMPLATE_ROOT/gateway-turn-config.patch" >/dev/null 2>&1; then
  git -C "$UPSTREAM_ROOT" apply "$TEMPLATE_ROOT/gateway-turn-config.patch"
fi
if ! git -C "$UPSTREAM_ROOT" apply --reverse --check "$TEMPLATE_ROOT/gateway-redact-ice.patch" >/dev/null 2>&1; then
  git -C "$UPSTREAM_ROOT" apply "$TEMPLATE_ROOT/gateway-redact-ice.patch"
fi
if ! git -C "$UPSTREAM_ROOT" apply --reverse --check "$TEMPLATE_ROOT/gateway-redact-signaling.patch" >/dev/null 2>&1; then
  git -C "$UPSTREAM_ROOT" apply "$TEMPLATE_ROOT/gateway-redact-signaling.patch"
fi
if ! git -C "$UPSTREAM_ROOT" apply --reverse --check "$TEMPLATE_ROOT/gateway-loopback.patch" >/dev/null 2>&1; then
  git -C "$UPSTREAM_ROOT" apply "$TEMPLATE_ROOT/gateway-loopback.patch"
fi
if ! git -C "$UPSTREAM_ROOT" apply --reverse --check "$TEMPLATE_ROOT/gateway-gfxinfo.patch" >/dev/null 2>&1; then
  git -C "$UPSTREAM_ROOT" apply --recount "$TEMPLATE_ROOT/gateway-gfxinfo.patch"
fi
if ! git -C "$UPSTREAM_ROOT" apply --reverse --check "$TEMPLATE_ROOT/gateway-interaction-ack.patch" >/dev/null 2>&1; then
  git -C "$UPSTREAM_ROOT" apply --recount "$TEMPLATE_ROOT/gateway-interaction-ack.patch"
fi
if ! git -C "$UPSTREAM_ROOT" apply --reverse --check "$TEMPLATE_ROOT/gateway-frame-refresh.patch" >/dev/null 2>&1; then
  git -C "$UPSTREAM_ROOT" apply --recount "$TEMPLATE_ROOT/gateway-frame-refresh.patch"
fi
if ! git -C "$UPSTREAM_ROOT" apply --recount --reverse --check "$TEMPLATE_ROOT/gateway-frame-snapshot.patch" >/dev/null 2>&1; then
  git -C "$UPSTREAM_ROOT" apply --recount "$TEMPLATE_ROOT/gateway-frame-snapshot.patch"
fi

if [[ ! -d "$TOOLS_BASE_ROOT/.git" ]]; then
  git clone --depth=1 --filter=blob:none --sparse \
    https://android.googlesource.com/platform/tools/base \
    "$TOOLS_BASE_ROOT"
  git -C "$TOOLS_BASE_ROOT" sparse-checkout set emulator/proto
fi
git -C "$TOOLS_BASE_ROOT" fetch --depth=1 origin "$TOOLS_BASE_COMMIT"
git -C "$TOOLS_BASE_ROOT" checkout --detach "$TOOLS_BASE_COMMIT"

install -d "$AEMU_PROTO_ROOT/services/emulator-controller" "$AEMU_PROTO_ROOT/services/webrtc"
install -m 0644 \
  "$TOOLS_BASE_ROOT/emulator/proto/emulator_controller.proto" \
  "$AEMU_PROTO_ROOT/services/emulator-controller/emulator_controller.proto"
install -m 0644 \
  "$TOOLS_BASE_ROOT/emulator/proto/rtc_service_v2.proto" \
  "$TOOLS_BASE_ROOT/emulator/proto/ice_config.proto" \
  "$AEMU_PROTO_ROOT/services/webrtc/"

if [[ ! -x "$UPSTREAM_ROOT/gateway/venv/bin/videobridge-gateway" ]]; then
  BAZEL_ROOT="$AEMU_WORKSPACE" "$UPSTREAM_ROOT/gateway/setup_env.sh"
fi

python3 -m venv "$INSTALL_ROOT/latest-video-venv"
"$INSTALL_ROOT/latest-video-venv/bin/pip" install -r "$SCRIPT_ROOT/latest-video/requirements.txt"
install -d "$INSTALL_ROOT/latest-video"
install -m 0644 "$SCRIPT_ROOT"/latest-video/*.py "$INSTALL_ROOT/latest-video/"

if [[ ! -f "$CONFIG_ROOT/credentials.env" ]]; then
  ACCESS_PATH="android-$(openssl rand -hex 16)"
  TURN_USER="mall-$(openssl rand -hex 8)"
  TURN_PASSWORD="$(openssl rand -hex 24)"
  sudo install -m 0600 "$TEMPLATE_ROOT/credentials.env" "$CONFIG_ROOT/credentials.env"
  sudo sed -i \
    -e "s|__ACCESS_PATH__|$ACCESS_PATH|g" \
    -e "s|__TURN_USER__|$TURN_USER|g" \
    -e "s|__TURN_PASSWORD__|$TURN_PASSWORD|g" \
    "$CONFIG_ROOT/credentials.env"
fi

# shellcheck disable=SC1090
source <(sudo cat "$CONFIG_ROOT/credentials.env")

install_template() {
  local source_path="$1"
  local destination_path="$2"
  local mode="$3"
  sudo install -m "$mode" "$source_path" "$destination_path"
  sudo sed -i \
    -e "s|__PUBLIC_HOST__|$PUBLIC_HOST|g" \
    -e "s|__PUBLIC_IP__|$PUBLIC_IP|g" \
    -e "s|__PRIVATE_IP__|$PRIVATE_IP|g" \
    -e "s|__ACCESS_PATH__|$ACCESS_PATH|g" \
    -e "s|__TURN_USER__|$TURN_USER|g" \
    -e "s|__TURN_PASSWORD__|$TURN_PASSWORD|g" \
    "$destination_path"
}

install_template "$TEMPLATE_ROOT/turn.json" "$CONFIG_ROOT/turn.json" 0640
sudo chown root:cherry "$CONFIG_ROOT/turn.json"
install_template "$TEMPLATE_ROOT/emulator-access.json" "$CONFIG_ROOT/emulator-access.json" 0644
install_template "$TEMPLATE_ROOT/turnserver.conf" /etc/turnserver.conf 0640
sudo chown root:turnserver /etc/turnserver.conf
install_template "$TEMPLATE_ROOT/Caddyfile" /etc/caddy/Caddyfile 0644
install_template "$TEMPLATE_ROOT/mall-demo-gateway" /usr/local/bin/mall-demo-gateway 0755
install_template "$TEMPLATE_ROOT/mall-demo-start-app" /usr/local/bin/mall-demo-start-app 0755
install_template "$TEMPLATE_ROOT/mall-demo-emulator.service" /etc/systemd/system/mall-demo-emulator.service 0644
install_template "$TEMPLATE_ROOT/mall-demo-gateway.service" /etc/systemd/system/mall-demo-gateway.service 0644
install_template "$TEMPLATE_ROOT/mall-demo-app.service" /etc/systemd/system/mall-demo-app.service 0644
install_template "$TEMPLATE_ROOT/player-url" "$RUNTIME_ROOT/player-url" 0644
sudo sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn

sudo loginctl enable-linger cherry
"$ANDROID_SDK_ROOT/platform-tools/adb" -s "$ANDROID_SERIAL" emu kill >/dev/null 2>&1 || true
for _ in $(seq 1 30); do
  pgrep -f "qemu-system.*MallDemo_API36" >/dev/null || break
  sleep 1
done

install_template "$TEMPLATE_ROOT/mall-demo-latest-video.service" /etc/systemd/system/mall-demo-latest-video.service 0644

sudo systemctl daemon-reload
sudo systemctl enable coturn caddy mall-demo-emulator.service mall-demo-gateway.service mall-demo-app.service
sudo systemctl restart coturn caddy mall-demo-emulator.service mall-demo-gateway.service
sudo systemctl enable --now mall-demo-latest-video.service
sudo systemctl restart mall-demo-app.service

cat "$RUNTIME_ROOT/player-url"
