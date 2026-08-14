#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

readonly DEMO_VERSION="2.3.0"
readonly DATAKIT_CHART_VERSION="2.5.0"
readonly DEMO_NAMESPACE="observability-demo"
readonly DATAKIT_NAMESPACE="datakit"
readonly DEMO_RELEASE="demo"
readonly DATAKIT_RELEASE="datakit"
readonly PROJECT="mall-demo"
readonly REGISTRY="pubrepo.jiagouyun.com/demo"
readonly PROVIDER="truewatch"
readonly APP_TIMEOUT="8m"
readonly DATAKIT_TIMEOUT="5m"
readonly LOAD_BALANCER_TIMEOUT_SECONDS="600"

export DEMO_VERSION

ASSUME_YES=false
WITH_DATAKIT=false

usage() {
  cat <<'EOF'
Usage:
  scripts/workshop.sh install [--yes]
  scripts/workshop.sh status
  scripts/workshop.sh verify
  scripts/workshop.sh cleanup [--with-datakit] [--yes]

Install inputs can be supplied through environment variables or entered when
prompted: EKS_CLUSTER_NAME, AWS_REGION, DATAWAY_URL, RUM_APPLICATION_ID, and
TRUEWATCH_WORKSPACE_ID. DATAWAY_URL is always read silently when prompted.
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

prompt_required() {
  local variable_name="$1"
  local prompt="$2"
  local value="${!variable_name:-}"
  if [[ -z "$value" ]]; then
    read -r -p "$prompt" value
  fi
  [[ -n "$value" ]] || die "$variable_name is required"
  printf -v "$variable_name" '%s' "$value"
  export "${variable_name?}"
}

prompt_secret() {
  local variable_name="$1"
  local prompt="$2"
  local value="${!variable_name:-}"
  if [[ -z "$value" ]]; then
    read -r -s -p "$prompt" value
    printf '\n'
  fi
  [[ -n "$value" ]] || die "$variable_name is required"
  printf -v "$variable_name" '%s' "$value"
  export "${variable_name?}"
}

confirm_context() {
  local context
  context="$(kubectl config current-context)"
  printf 'Kubernetes context: %s\n' "$context"
  kubectl get nodes
  if [[ "$ASSUME_YES" != "true" ]]; then
    local answer
    read -r -p "Continue with this cluster? [y/N] " answer
    [[ "$answer" == "y" || "$answer" == "Y" ]] || die "cancelled"
  fi
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

install_workshop() {
  local detected_region
  for command in aws kubectl helm curl; do
    require_command "$command"
  done

  prompt_required EKS_CLUSTER_NAME 'EKS cluster name: '
  detected_region="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"
  if [[ -z "$detected_region" ]]; then
    detected_region="$(aws configure get region 2>/dev/null || true)"
  fi
  AWS_REGION="$detected_region"
  prompt_required AWS_REGION 'AWS region: '
  prompt_secret DATAWAY_URL 'DataWay URL: '
  prompt_required RUM_APPLICATION_ID 'RUM Application ID: '
  prompt_required TRUEWATCH_WORKSPACE_ID 'TrueWatch Workspace ID: '

  log "Connecting kubectl to ${EKS_CLUSTER_NAME}"
  aws eks update-kubeconfig --region "$AWS_REGION" --name "$EKS_CLUSTER_NAME"
  confirm_context
  kubectl wait --for=condition=Ready node --all --timeout=5m

  log "Installing DataKit ${DATAKIT_CHART_VERSION}"
  helm repo add datakit https://pubrepo.truewatch.com/chartrepo/datakit --force-update
  helm repo update datakit
  helm upgrade --install "$DATAKIT_RELEASE" datakit/datakit \
    --version "$DATAKIT_CHART_VERSION" \
    --namespace "$DATAKIT_NAMESPACE" \
    --create-namespace \
    --values "$REPO_ROOT/observability/datakit-values.example.yaml" \
    --set-string datakit.dataway_url="$DATAWAY_URL" \
    --set-string datakit.cluster_name_k8s="$EKS_CLUSTER_NAME"
  unset DATAWAY_URL
  kubectl -n "$DATAKIT_NAMESPACE" rollout status daemonset/datakit \
    --timeout="$DATAKIT_TIMEOUT"

  log "Installing observability demo ${DEMO_VERSION}"
  helm upgrade --install "$DEMO_RELEASE" "$REPO_ROOT/charts/observability-demo" \
    --namespace "$DEMO_NAMESPACE" \
    --create-namespace \
    --values "$REPO_ROOT/charts/observability-demo/values-workshop-truewatch.yaml" \
    --set-string image.registry="${REGISTRY%%/*}" \
    --set-string image.owner="${REGISTRY#*/}" \
    --set-string image.tag="$DEMO_VERSION" \
    --set-string rum.applicationId="$RUM_APPLICATION_ID" \
    --set-string observability.clusterName="$EKS_CLUSTER_NAME" \
    --set-string observabilityConsole.workspaceId="$TRUEWATCH_WORKSPACE_ID"
  unset RUM_APPLICATION_ID TRUEWATCH_WORKSPACE_ID
  kubectl -n "$DEMO_NAMESPACE" wait --for=condition=Available deployment --all \
    --timeout="$APP_TIMEOUT"

  DEMO_BASE_URL="$(discover_demo_url)"
  export DEMO_BASE_URL
  printf 'Demo URL: %s\n' "$DEMO_BASE_URL"
  run_verify

  printf '\nSourceMap package command:\n'
  printf '  scripts/package-rum-sourcemap.sh --version %s\n' "$DEMO_VERSION"
  printf 'SourceMap upload environment: demo\n'
  printf 'SourceMap upload version: %s\n' "$DEMO_VERSION"
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
  install)
    [[ "$WITH_DATAKIT" == "false" ]] || die "--with-datakit is only valid with cleanup"
    install_workshop
    ;;
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
