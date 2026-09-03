#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

readonly DEMO_VERSION="2.3.6"
readonly DATAKIT_CHART_VERSION="2.5.0"
readonly HELM_VERSION="v3.17.3"
readonly DEMO_NAMESPACE="observability-demo"
readonly DATAKIT_NAMESPACE="datakit"
readonly DEMO_RELEASE="demo"
readonly DATAKIT_RELEASE="datakit"
readonly PROJECT="mall-demo"
readonly PROVIDER="guance"
readonly APP_TIMEOUT="8m"
readonly DATAKIT_TIMEOUT="5m"
readonly LOAD_BALANCER_TIMEOUT_SECONDS="${WORKSHOP_LOAD_BALANCER_TIMEOUT_SECONDS:-600}"
readonly LOAD_BALANCER_POLL_SECONDS="${WORKSHOP_LOAD_BALANCER_POLL_SECONDS:-10}"

export DEMO_VERSION

ASSUME_YES=false
WITH_DATAKIT=false
UPGRADE_EXISTING_DATAKIT=false

usage() {
  cat <<'EOF'
Usage:
  scripts/workshop.sh install [--yes] [--upgrade-existing-datakit]
  scripts/workshop.sh status
  scripts/workshop.sh verify
  scripts/workshop.sh cleanup [--with-datakit] [--yes]

Required install environment variables:
  EKS_CLUSTER_NAME DATAWAY_URL RUM_APPLICATION_ID RUM_GAME_APPLICATION_ID GUANCE_WORKSPACE_ID
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

validate_install_inputs() {
  local variable_name
  local -a missing=()
  for variable_name in \
    EKS_CLUSTER_NAME DATAWAY_URL RUM_APPLICATION_ID RUM_GAME_APPLICATION_ID GUANCE_WORKSPACE_ID; do
    if [[ -z "${!variable_name:-}" ]]; then
      missing+=("$variable_name")
    fi
  done
  if (( ${#missing[@]} > 0 )); then
    die "Missing required environment variables: ${missing[*]}"
  fi
  if [[ "$RUM_APPLICATION_ID" == "$RUM_GAME_APPLICATION_ID" ]]; then
    die "RUM_GAME_APPLICATION_ID must differ from RUM_APPLICATION_ID"
  fi
}

helm_archive_architecture() {
  case "$(uname -m)" in
    x86_64|amd64)
      printf 'amd64'
      ;;
    aarch64|arm64)
      printf 'arm64'
      ;;
    *)
      die "Unsupported architecture for Helm: $(uname -m)"
      ;;
  esac
}

ensure_helm() {
  if command -v helm >/dev/null 2>&1; then
    return
  fi

  local architecture archive_name download_dir expected_checksum checksum_output actual_checksum
  architecture="$(helm_archive_architecture)"
  archive_name="helm-${HELM_VERSION}-linux-${architecture}.tar.gz"
  download_dir="$(mktemp -d)"
  trap 'rm -rf "$download_dir"' EXIT

  require_command curl
  require_command tar
  require_command install
  log "Installing Helm ${HELM_VERSION} in ${HOME}/bin"
  curl --fail --silent --show-error --location \
    "https://get.helm.sh/${archive_name}" \
    --output "${download_dir}/${archive_name}"
  curl --fail --silent --show-error --location \
    "https://get.helm.sh/${archive_name}.sha256sum" \
    --output "${download_dir}/${archive_name}.sha256sum"

  read -r expected_checksum _ < "${download_dir}/${archive_name}.sha256sum"
  if command -v sha256sum >/dev/null 2>&1; then
    checksum_output="$(sha256sum "${download_dir}/${archive_name}")"
  elif command -v shasum >/dev/null 2>&1; then
    checksum_output="$(shasum -a 256 "${download_dir}/${archive_name}")"
  else
    die "Required checksum command not found: sha256sum or shasum"
  fi
  actual_checksum="${checksum_output%% *}"
  [[ "$actual_checksum" == "$expected_checksum" ]] || die "Helm checksum verification failed"

  tar -xzf "${download_dir}/${archive_name}" -C "$download_dir"
  mkdir -p "${HOME}/bin"
  install -m 0755 "${download_dir}/linux-${architecture}/helm" "${HOME}/bin/helm"
  export PATH="${HOME}/bin:${PATH}"
  touch "${HOME}/.bashrc"
  if ! grep -Fqx 'export PATH="$HOME/bin:$PATH"' "${HOME}/.bashrc"; then
    printf '\nexport PATH="$HOME/bin:$PATH"\n' >> "${HOME}/.bashrc"
  fi
  command -v helm >/dev/null 2>&1 || die "Helm installation did not produce an executable"

  rm -rf "$download_dir"
  trap - EXIT
}

confirm_context() {
  local context answer
  context="$(kubectl config current-context)"
  printf 'Kubernetes context: %s\n' "$context"
  kubectl get nodes
  if [[ "$ASSUME_YES" != "true" ]]; then
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
    sleep "$LOAD_BALANCER_POLL_SECONDS"
  done
}

discover_demo_url() {
  local address
  if ! address="$(wait_for_load_balancer)"; then
    return 1
  fi
  printf 'http://%s' "$address"
}

run_verify() {
  local demo_base_url="${DEMO_BASE_URL:-}"
  require_command curl
  require_command kubectl
  if [[ -z "$demo_base_url" ]]; then
    if ! demo_base_url="$(discover_demo_url)"; then
      return 1
    fi
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
  local dataway_file demo_base_url

  validate_install_inputs
  for command in aws kubectl curl; do
    require_command "$command"
  done
  ensure_helm

  log "AWS identity"
  aws sts get-caller-identity --output table

  log "Connecting kubectl to the target EKS cluster"
  aws eks update-kubeconfig --name "$EKS_CLUSTER_NAME"
  confirm_context
  kubectl wait --for=condition=Ready node --all --timeout=5m

  if helm status "$DATAKIT_RELEASE" --namespace "$DATAKIT_NAMESPACE" >/dev/null 2>&1; then
    if [[ "$UPGRADE_EXISTING_DATAKIT" != "true" ]]; then
      die "DataKit release datakit/datakit already exists; use the detailed tutorial or rerun with --upgrade-existing-datakit"
    fi
    log "Upgrading the existing DataKit release by explicit request"
  else
    log "Installing DataKit ${DATAKIT_CHART_VERSION}"
  fi

  helm repo add datakit https://pubrepo.guance.com/chartrepo/datakit --force-update
  helm repo update datakit
  dataway_file="$(mktemp)"
  chmod 600 "$dataway_file"
  trap 'rm -f "$dataway_file"' EXIT
  printf '%s' "$DATAWAY_URL" > "$dataway_file"
  helm upgrade --install "$DATAKIT_RELEASE" datakit/datakit \
    --version "$DATAKIT_CHART_VERSION" \
    --namespace "$DATAKIT_NAMESPACE" \
    --create-namespace \
    --values "$REPO_ROOT/observability/datakit-values.example.yaml" \
    --set-file datakit.dataway_url="$dataway_file" \
    --set-string datakit.cluster_name_k8s="$EKS_CLUSTER_NAME" \
    --wait --timeout="$DATAKIT_TIMEOUT"
  rm -f "$dataway_file"
  trap - EXIT
  unset DATAWAY_URL
  kubectl -n "$DATAKIT_NAMESPACE" rollout status daemonset/datakit \
    --timeout="$DATAKIT_TIMEOUT"

  log "Installing observability demo ${DEMO_VERSION}"
  helm upgrade --install "$DEMO_RELEASE" "$REPO_ROOT/charts/observability-demo" \
    --namespace "$DEMO_NAMESPACE" \
    --create-namespace \
    --values "$REPO_ROOT/charts/observability-demo/values-eks.yaml" \
    --set-string image.tag="$DEMO_VERSION" \
    --set-string observability.project="$PROJECT" \
    --set-string observability.clusterName="$EKS_CLUSTER_NAME" \
    --set-string datakit.provider="$PROVIDER" \
    --set-string rum.enabled=true \
    --set-string rum.applicationId="$RUM_APPLICATION_ID" \
    --set-string rum.gameApplicationId="$RUM_GAME_APPLICATION_ID" \
    --set-string observabilityConsole.url="https://console.guance.com/" \
    --set-string observabilityConsole.workspaceId="$GUANCE_WORKSPACE_ID" \
    --wait --timeout="$APP_TIMEOUT"
  unset RUM_APPLICATION_ID RUM_GAME_APPLICATION_ID GUANCE_WORKSPACE_ID
  kubectl -n "$DEMO_NAMESPACE" wait --for=condition=Available deployment --all \
    --timeout="$APP_TIMEOUT"

  if ! demo_base_url="$(discover_demo_url)"; then
    return 1
  fi
  printf '\nDEMO_BASE_URL=%s\n' "$demo_base_url"
  printf 'SourceMap: scripts/package-rum-sourcemap.sh --version %s\n' "$DEMO_VERSION"
  printf 'SourceMap upload: Environment=demo, Version=%s\n' "$DEMO_VERSION"
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
    --upgrade-existing-datakit)
      UPGRADE_EXISTING_DATAKIT=true
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
    [[ "$ASSUME_YES" == "false" && "$WITH_DATAKIT" == "false" && "$UPGRADE_EXISTING_DATAKIT" == "false" ]] || die "status does not accept options"
    show_status
    ;;
  verify)
    [[ "$ASSUME_YES" == "false" && "$WITH_DATAKIT" == "false" && "$UPGRADE_EXISTING_DATAKIT" == "false" ]] || die "verify does not accept options"
    run_verify
    ;;
  cleanup)
    [[ "$UPGRADE_EXISTING_DATAKIT" == "false" ]] || die "--upgrade-existing-datakit is only valid with install"
    cleanup_workshop
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
