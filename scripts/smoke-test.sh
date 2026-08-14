#!/usr/bin/env bash
set -euo pipefail

base_url="${DEMO_BASE_URL:-http://127.0.0.1:8080}"
expected_project="${DEMO_PROJECT:-mall-demo}"
expected_provider="${DATAKIT_PROVIDER:-guance}"
expected_version="${DEMO_VERSION:-}"

expect_status() {
  local expected="$1"
  shift
  local actual
  actual="$(curl --silent --show-error --output /tmp/observability-demo-response --write-out '%{http_code}' "$@")"
  if [[ "${actual}" != "${expected}" ]]; then
    echo "expected HTTP ${expected}, got ${actual}: $(tr '\n' ' ' </tmp/observability-demo-response)" >&2
    exit 1
  fi
}

expect_status 200 "${base_url}/actuator/health"
expect_status 200 "${base_url}/api/demo/config"
grep -Fq "\"project\":\"${expected_project}\"" /tmp/observability-demo-response
grep -Fq "\"datakitProvider\":\"${expected_provider}\"" /tmp/observability-demo-response
if [[ -n "$expected_version" ]]; then
  grep -Fq "\"version\":\"${expected_version}\"" /tmp/observability-demo-response
fi
if grep -Fq 'controlToken' /tmp/observability-demo-response; then
  echo "demo config must not expose or require a control token" >&2
  exit 1
fi
expect_status 200 "${base_url}/api/demo/rum-config"
grep -Fq "\"project\":\"${expected_project}\"" /tmp/observability-demo-response
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
  if grep -q '"service":"order-service"' /tmp/observability-demo-response \
    && grep -q '"service":"inventory-service"' /tmp/observability-demo-response \
    && grep -q '"service":"payment-service"' /tmp/observability-demo-response; then
    break
  fi
  sleep 1
done
grep -q '"service":"order-service"' /tmp/observability-demo-response
grep -q '"service":"inventory-service"' /tmp/observability-demo-response
grep -q '"service":"payment-service"' /tmp/observability-demo-response

echo "smoke test passed: ${base_url}"
