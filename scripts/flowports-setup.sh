#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
demo_url="${DEMO_BASE_URL:-http://127.0.0.1:8080}"
admin_url="${FLOWPORTS_UI_URL:-http://127.0.0.1:${FLOWPORTS_ADMIN_PORT:-18082}}"

demo_request() {
  curl -fsS --max-time 15 "$@"
  printf '\n'
}

case "${1:-}" in
  status)
    printf 'FlowPorts readiness at %s\n' "$admin_url"
    if ! curl -fsS --max-time 5 "${admin_url%/}/readyz"; then
      printf 'FlowPorts is unreachable or still needs initialization.\n' >&2
      exit 1
    fi
    printf '\nDemo sink state\n'
    demo_request "${demo_url%/}/api/demo/flowports/state"
    ;;
  setup-token)
    docker compose -f compose.yaml -f compose.datakit.yaml -f compose.flowports.yaml \
      exec -T flowports cat /var/lib/flowport/manager/setup-token
    ;;
  replay-cli)
    printf 'FlowPorts drill summary\n'
    demo_request -X POST "${demo_url%/}/api/demo/flowports/drill"
    printf 'Demo sink state (delivery is asynchronous)\n'
    demo_request "${demo_url%/}/api/demo/flowports/state"
    ;;
  *)
    printf 'Usage: %s {status|setup-token|replay-cli}\n' "$0" >&2
    exit 2
    ;;
esac
