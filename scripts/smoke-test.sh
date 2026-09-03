#!/usr/bin/env bash
set -euo pipefail

base_url="${DEMO_BASE_URL:-http://127.0.0.1:8080}"
expected_project="${DEMO_PROJECT:-mall-demo}"
expected_provider="${DATAKIT_PROVIDER:-guance}"
expected_game_service="${RUM_GAME_SERVICE:-mall-game-h5}"
expected_version="${DEMO_VERSION:-}"
response_file="$(mktemp)"
cookie_jar="$(mktemp)"
visitor_id="visitor-12345678-1234-4123-8123-123456789abc"
trap 'rm -f "${response_file}" "${cookie_jar}"' EXIT

expect_status() {
  local expected="$1"
  shift
  local actual
  actual="$(curl --silent --show-error --output "${response_file}" --write-out '%{http_code}' "$@")"
  if [[ "${actual}" != "${expected}" ]]; then
    echo "expected HTTP ${expected}, got ${actual}: $(tr '\n' ' ' <"${response_file}")" >&2
    exit 1
  fi
}

expect_status 200 "${base_url}/actuator/health"
expect_status 200 "${base_url}/shop.html"
grep -Fq 'id="accountButton"' "${response_file}"
grep -Fq "const VISITOR_STORAGE_KEY = 'mall-demo-visitor-id-v1'" "${response_file}"
grep -Fq 'trackViewsManually: true' "${response_file}"
expect_status 200 "${base_url}/business.html?scene=webgl-game&view=web"
grep -Fq "id: 'webgl-game'" "${response_file}"
expect_status 200 "${base_url}/webgl-replay-game.html?embedded=1"
grep -Fq 'id="game-canvas"' "${response_file}"
expect_status 200 "${base_url}/assets/webgl-replay-game.css"
grep -Fq 'data-embedded="true"' "${response_file}"
expect_status 200 "${base_url}/assets/webgl-replay-game.js"
grep -Fq "game_render_overload_started" "${response_file}"
grep -Fq "game_render_overload_recovered" "${response_file}"
grep -Fq "game_asset_load_failed" "${response_file}"
grep -Fq "game_asset_load_retry" "${response_file}"
grep -Fq "game_asset_fallback_recovered" "${response_file}"
grep -Fq "ASSET_LOAD_FAILURE_RETRY_MS = 5000" "${response_file}"
grep -Fq "ASSET_LOAD_FAILURE_DURATION_MS = 10000" "${response_file}"
grep -Fq "RENDER_OVERLOAD_TARGET_FPS = 12" "${response_file}"
grep -Fq "observability-demo-scene" "${response_file}"
grep -Fq "var sampling = query.get('sampling') || '4'" "${response_file}"
grep -Fq "replayCanvasMimeType: 'image/webp'" "${response_file}"
grep -Fq "targetFps: 20" "${response_file}"
grep -Fq "interval: 50" "${response_file}"
grep -Fq "maxEncodedBytes: 160000" "${response_file}"
expect_status 200 "${base_url}/assets/webgl-game-scene-icon.png"
expect_status 404 "${base_url}/api/demo/game-assets/orbital-shield-texture.webp?triggerId=smoke&attempt=1"
expect_status 200 "${base_url}/api/demo/config"
grep -Fq "\"project\":\"${expected_project}\"" "${response_file}"
grep -Fq "\"datakitProvider\":\"${expected_provider}\"" "${response_file}"
if [[ -n "$expected_version" ]]; then
  grep -Fq "\"version\":\"${expected_version}\"" "${response_file}"
fi
if grep -Fq 'controlToken' "${response_file}"; then
  echo "demo config must not expose or require a control token" >&2
  exit 1
fi
expect_status 200 "${base_url}/api/demo/rum-config"
grep -Fq "\"project\":\"${expected_project}\"" "${response_file}"
grep -Fq "\"gameService\":\"${expected_game_service}\"" "${response_file}"
grep -Fq '"gameApplicationId":' "${response_file}"
if [[ -n "${RUM_GAME_APPLICATION_ID:-}" ]]; then
  grep -Fq "\"gameApplicationId\":\"${RUM_GAME_APPLICATION_ID}\"" "${response_file}"
fi
expect_status 200 "${base_url}/api/demo/auth/session" \
  -H "X-Demo-Visitor-Id: ${visitor_id}"
grep -Fq '"authenticated":false' "${response_file}"
grep -Fq '"id":"demo-reader-001"' "${response_file}"
expect_status 401 -X POST "${base_url}/api/orders" \
  -H 'Content-Type: application/json' \
  -H "X-Demo-Visitor-Id: ${visitor_id}" \
  --data '{"sku":"sku-1001","quantity":1,"amountCent":1999}'
grep -Fq '"error":"authentication_required"' "${response_file}"
expect_status 200 -X POST "${base_url}/api/demo/auth/session" \
  -H 'Content-Type: application/json' \
  -H "X-Demo-Visitor-Id: ${visitor_id}" \
  -c "${cookie_jar}" \
  --data '{"userId":"demo-reader-001"}'
grep -Fq '"authenticated":true' "${response_file}"
expect_status 200 -X POST "${base_url}/api/orders" \
  -H 'Content-Type: application/json' \
  -H 'X-Key-Request: smoke_authenticated_checkout' \
  -H "X-Business-Request-Id: biz-smoke-auth-$(date +%s)" \
  -H "X-Demo-Visitor-Id: ${visitor_id}" \
  -b "${cookie_jar}" \
  --data '{"sku":"sku-1001","quantity":1,"amountCent":1999}'
grep -Fq '"userId":"demo-reader-001"' "${response_file}"
expect_status 204 -X DELETE "${base_url}/api/demo/auth/session" \
  -H "X-Demo-Visitor-Id: ${visitor_id}" \
  -b "${cookie_jar}" -c "${cookie_jar}"
expect_status 401 -X POST "${base_url}/api/orders" \
  -H 'Content-Type: application/json' \
  -H "X-Demo-Visitor-Id: ${visitor_id}" \
  -b "${cookie_jar}" \
  --data '{"sku":"sku-1001","quantity":1,"amountCent":1999}'
expect_status 200 "${base_url}/api/orders/demo" \
  -H 'X-Key-Request: smoke_checkout' \
  -H "X-Business-Request-Id: biz-smoke-$(date +%s)"
expect_status 404 -X POST "${base_url}/admin/fault/off"
expect_status 200 -X POST "${base_url}/api/demo/faults/payment_error/enable"
expect_status 503 "${base_url}/api/orders/demo" \
  -H 'X-Key-Request: smoke_fault_checkout' \
  -H "X-Business-Request-Id: biz-smoke-fault-$(date +%s)"
expect_status 200 -X POST "${base_url}/api/demo/faults/off"

recovery_request_id="biz-smoke-recovery-$(date +%s)"
expect_status 200 "${base_url}/api/orders/demo" \
  -H 'X-Key-Request: smoke_recovery_checkout' \
  -H "X-Business-Request-Id: ${recovery_request_id}"

for _ in $(seq 1 10); do
  expect_status 200 --get "${base_url}/api/demo/logs" \
    --data-urlencode "biz_request_id=${recovery_request_id}"
  if grep -q '"service":"order-service"' "${response_file}" \
    && grep -q '"service":"inventory-service"' "${response_file}" \
    && grep -q '"service":"payment-service"' "${response_file}"; then
    break
  fi
  sleep 1
done
grep -q '"service":"order-service"' "${response_file}"
grep -q '"service":"inventory-service"' "${response_file}"
grep -q '"service":"payment-service"' "${response_file}"

echo "smoke test passed: ${base_url}"
