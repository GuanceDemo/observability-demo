#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

readonly DEMO_VERSION="2.3.0"
readonly DEMO_NAMESPACE="observability-demo"
readonly DATAKIT_NAMESPACE="datakit"
readonly DEMO_RELEASE="demo"
readonly DATAKIT_RELEASE="datakit"
readonly PROJECT="mall-demo"
readonly PROVIDER="truewatch"
readonly LOAD_BALANCER_TIMEOUT_SECONDS="600"

export DEMO_VERSION

ASSUME_YES=false
WITH_DATAKIT=false

usage() {
  cat <<'EOF'
Usage:
  scripts/workshop.sh status
  scripts/workshop.sh verify
  scripts/workshop.sh cleanup [--with-datakit] [--yes]
EOF
}

log() {
  printf '\n==> %s\n' "$*"
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

gateway_service_name() {
  kubectl -n "$DEMO_NAMESPACE" get service \
    -l app.kubernetes.io/component=gateway-service \
    -o jsonpath='{.items[0].metadata.name}' 2>/dev/null
}

load_balancer_address() {
  local hostname ip
  hostname="$(kubectl -n "$DEMO_NAMESPACE" get service \
    -l app.kubernetes.io/component=gateway-service \
    -o jsonpath='{.items[0].status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true)"
  if [[ -n "$hostname" ]]; then
    printf '%s' "$hostname"
    return
  fi
  ip="$(kubectl -n "$DEMO_NAMESPACE" get service \
    -l app.kubernetes.io/component=gateway-service \
    -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
  printf '%s' "$ip"
}

show_load_balancer_diagnostics() {
  local service_name
  service_name="$(gateway_service_name || true)"
  if [[ -n "$service_name" ]]; then
    kubectl -n "$DEMO_NAMESPACE" describe "service/$service_name" || true
  fi
  kubectl -n "$DEMO_NAMESPACE" get events --sort-by=.lastTimestamp | tail -n 40 || true
}

wait_for_load_balancer() {
  local started address
  started="$(date +%s)"
  while true; do
    address="$(load_balancer_address)"
    if [[ -n "$address" ]]; then
      printf '%s' "$address"
      return
    fi
    if (( $(date +%s) - started >= LOAD_BALANCER_TIMEOUT_SECONDS )); then
      show_load_balancer_diagnostics >&2
      die "Gateway LoadBalancer did not receive an address within 10 minutes"
    fi
    sleep 10
  done
}

discover_demo_url() {
  local address
  address="$(wait_for_load_balancer)"
  printf 'http://%s' "$address"
}

run_verify() {
  local demo_base_url="${DEMO_BASE_URL:-}"
  require_command curl
  require_command kubectl
  if [[ -z "$demo_base_url" ]]; then
    demo_base_url="$(discover_demo_url)"
  fi
  export DEMO_BASE_URL="$demo_base_url"

  log "Waiting for ${DEMO_BASE_URL}"
  curl --fail --silent --show-error \
    --retry 60 --retry-delay 5 --retry-all-errors --retry-max-time 300 \
    "${DEMO_BASE_URL}/api/demo/config" >/dev/null

  log "Running smoke test"
  DATAKIT_PROVIDER="$PROVIDER" DEMO_PROJECT="$PROJECT" \
    "$SCRIPT_DIR/smoke-test.sh"

  log "Generating workshop traffic"
  TRAFFIC_COUNT="${WORKSHOP_TRAFFIC_COUNT:-10}" \
    TRAFFIC_INTERVAL_SECONDS="${WORKSHOP_TRAFFIC_INTERVAL_SECONDS:-0.2}" \
    "$SCRIPT_DIR/generate-traffic.sh"

  log "Checking fault injection and recovery"
  trap '"$SCRIPT_DIR/inject-fault.sh" off >/dev/null 2>&1 || true' EXIT
  "$SCRIPT_DIR/inject-fault.sh" payment_slow >/dev/null
  "$SCRIPT_DIR/inject-fault.sh" off >/dev/null
  trap - EXIT
  printf 'verification passed: %s\n' "$DEMO_BASE_URL"
}

show_status() {
  require_command helm
  require_command kubectl
  printf 'Kubernetes context: %s\n' "$(kubectl config current-context)"
  helm list --all --namespace "$DATAKIT_NAMESPACE" || true
  helm list --all --namespace "$DEMO_NAMESPACE" || true
  kubectl -n "$DATAKIT_NAMESPACE" get pods 2>/dev/null || true
  kubectl -n "$DEMO_NAMESPACE" get pods 2>/dev/null || true
  kubectl -n "$DEMO_NAMESPACE" get service \
    -l app.kubernetes.io/component=gateway-service 2>/dev/null || true
  local address
  address="$(load_balancer_address)"
  if [[ -n "$address" ]]; then
    printf 'Demo URL: http://%s\n' "$address"
  fi
}

cleanup_workshop() {
  require_command helm
  require_command kubectl
  local gateway_service
  printf 'Kubernetes context: %s\n' "$(kubectl config current-context)"
  if [[ "$ASSUME_YES" != "true" ]]; then
    local answer
    read -r -p "Remove the workshop application from this cluster? [y/N] " answer
    [[ "$answer" == "y" || "$answer" == "Y" ]] || die "cancelled"
  fi

  log "Removing the application and public LoadBalancer"
  gateway_service="$(gateway_service_name || true)"
  if helm status "$DEMO_RELEASE" --namespace "$DEMO_NAMESPACE" >/dev/null 2>&1; then
    helm uninstall "$DEMO_RELEASE" --namespace "$DEMO_NAMESPACE" \
      --wait --timeout=10m
  fi
  if [[ -n "$gateway_service" ]]; then
    kubectl -n "$DEMO_NAMESPACE" wait --for=delete \
      "service/$gateway_service" --timeout=10m
  fi
  kubectl delete namespace "$DEMO_NAMESPACE" --ignore-not-found \
    --wait=true --timeout=10m

  if [[ "$WITH_DATAKIT" == "true" ]]; then
    log "Removing DataKit"
    if helm status "$DATAKIT_RELEASE" --namespace "$DATAKIT_NAMESPACE" >/dev/null 2>&1; then
      helm uninstall "$DATAKIT_RELEASE" --namespace "$DATAKIT_NAMESPACE" \
        --wait --timeout=5m
    fi
    kubectl delete namespace "$DATAKIT_NAMESPACE" --ignore-not-found \
      --wait=true --timeout=5m
  else
    printf 'DataKit was preserved. Use --with-datakit to remove it explicitly.\n'
  fi
}

[[ "$#" -ge 1 ]] || { usage >&2; exit 2; }
command_name="$1"
shift
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --yes)
      ASSUME_YES=true
      ;;
    --with-datakit)
      WITH_DATAKIT=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
  shift
done

case "$command_name" in
  status)
    [[ "$ASSUME_YES" == "false" && "$WITH_DATAKIT" == "false" ]] || die "status does not accept options"
    show_status
    ;;
  verify)
    [[ "$ASSUME_YES" == "false" && "$WITH_DATAKIT" == "false" ]] || die "verify does not accept options"
    run_verify
    ;;
  cleanup)
    cleanup_workshop
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
