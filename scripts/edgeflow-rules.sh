#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EDGEFLOW_IMAGE="${EDGEFLOW_IMAGE:-pubrepo.guance.com/guance/edgeflow:1.0.1}"
EDGEFLOW_WORKSPACE="${EDGEFLOW_WORKSPACE:-demo}"
EDGEFLOW_CONTAINER="${EDGEFLOW_CONTAINER_NAME:-observability-demo-edgeflow}"
EDGEFLOW_NAMESPACE="${EDGEFLOW_K8S_NAMESPACE:-datakit}"
EDGEFLOW_POD="${EDGEFLOW_K8S_POD:-edgeflow-0}"
DSL_PATH="${EDGEFLOW_DSL_PATH:-${ROOT_DIR}/observability/edgeflow/rules/tracing.dsl}"
FIXTURE_PATH="${EDGEFLOW_FIXTURE_PATH:-${ROOT_DIR}/observability/edgeflow/fixtures/mall-demo-spans.json}"

usage() {
  cat <<'EOF'
Usage: scripts/edgeflow-rules.sh <validate|test|apply-docker|apply-k8s> [--if-match <revision>]

Commands:
  validate       Offline syntax and schema validation of observability/edgeflow/rules/tracing.dsl
  test           Replay mall-demo-spans.json against tracing.dsl and verify retention/drop/sampling contracts
  apply-docker   Apply tracing.dsl inside the running Docker Compose EdgeFlow container
  apply-k8s      Apply tracing.dsl inside the running Kubernetes EdgeFlow StatefulSet pod
EOF
}

cmd="${1:-}"
if [[ -z "${cmd}" || "${cmd}" == "-h" || "${cmd}" == "--help" ]]; then
  usage
  exit 0
fi
shift || true

case "${cmd}" in
  validate)
    docker run --rm --platform linux/amd64 \
      -v "${DSL_PATH}:/tmp/tracing.dsl:ro" \
      "${EDGEFLOW_IMAGE}" \
      rules validate /tmp/tracing.dsl
    ;;

  test)
    output="$(
      docker run --rm --platform linux/amd64 \
        -v "${DSL_PATH}:/tmp/tracing.dsl:ro" \
        -v "${FIXTURE_PATH}:/tmp/spans.json:ro" \
        "${EDGEFLOW_IMAGE}" \
        rules test /tmp/tracing.dsl --workspace "${EDGEFLOW_WORKSPACE}" --spans /tmp/spans.json --format json
    )"
    printf '%s\n' "${output}" | python3 -c '
import json, sys
data = json.load(sys.stdin)
assert data.get("ok") is True, f"rules test failed: {data}"
decisions = {item["group_id"]: item for item in data.get("tail_decisions", [])}

scanner = [k for k in decisions if k.startswith("trace-scan-")]
errors = [k for k in decisions if k.startswith("trace-err-")]
healthy = [k for k in decisions if k.startswith("trace-ok-")]

assert len(scanner) == 20, f"expected 20 scanner traces, got {len(scanner)}"
assert all(decisions[k]["decision"] == "drop" for k in scanner), "all unmatched scanner traces must be dropped"

assert len(errors) == 5, f"expected 5 payment_error traces, got {len(errors)}"
assert all(decisions[k]["decision"] == "keep" for k in errors), "all 4th-hop payment_error traces must be kept"

assert decisions["trace-slow-01"]["decision"] == "keep", "slow trace (>1s) must be kept"
assert decisions["trace-vip-01"]["decision"] == "keep", "VIP trace must be kept"
assert not decisions["trace-game-404"]["matched_action"].startswith("drop when"), "game missing-texture 404 must not be dropped by scanner rule"

assert len(healthy) == 100, f"expected 100 healthy traces, got {len(healthy)}"
kept_healthy = sum(1 for k in healthy if decisions[k]["decision"] == "keep")
assert 5 <= kept_healthy <= 18, f"expected ~10% healthy traces kept, got {kept_healthy}/100"

print(
    f"EdgeFlow fixture test passed: scanner_kept=0/{len(scanner)}, "
    f"healthy_kept={kept_healthy}/{len(healthy)}, "
    f"payment_error_kept={len(errors)}/{len(errors)}, "
    f"slow=keep, vip=keep"
)
'
    ;;

  apply-docker)
    docker exec "${EDGEFLOW_CONTAINER}" edgeflow rules validate /app/local-rules/tracing.dsl
    docker exec "${EDGEFLOW_CONTAINER}" edgeflow --config /app/edgeflow.toml \
      rules apply /app/local-rules/tracing.dsl --workspace "${EDGEFLOW_WORKSPACE}" --format json "$@"
    ;;

  apply-k8s)
    kubectl -n "${EDGEFLOW_NAMESPACE}" exec "${EDGEFLOW_POD}" -- \
      edgeflow rules validate /app/local-rules/tracing.dsl
    kubectl -n "${EDGEFLOW_NAMESPACE}" exec "${EDGEFLOW_POD}" -- \
      edgeflow --config /app/edgeflow.toml \
      rules apply /app/local-rules/tracing.dsl --workspace "${EDGEFLOW_WORKSPACE}" --format json "$@"
    ;;

  *)
    echo "Unknown command: ${cmd}" >&2
    usage >&2
    exit 1
    ;;
esac
