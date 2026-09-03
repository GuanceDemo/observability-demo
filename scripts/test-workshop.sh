#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly WORKSHOP_SCRIPT="${SCRIPT_DIR}/workshop.sh"

TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

TEST_COUNT=0
RUN_EXIT=0
RUN_OUTPUT=""

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

assert_success() {
  [[ "$RUN_EXIT" -eq 0 ]] || {
    sed -n '1,240p' "$RUN_OUTPUT" >&2
    fail "expected success, got exit ${RUN_EXIT}"
  }
}

assert_failure() {
  [[ "$RUN_EXIT" -ne 0 ]] || {
    sed -n '1,240p' "$RUN_OUTPUT" >&2
    fail "expected failure"
  }
}

assert_output_contains() {
  grep -Fq -- "$1" "$RUN_OUTPUT" || {
    sed -n '1,240p' "$RUN_OUTPUT" >&2
    fail "output did not contain: $1"
  }
}

assert_output_excludes() {
  if grep -Fq -- "$1" "$RUN_OUTPUT"; then
    sed -n '1,240p' "$RUN_OUTPUT" >&2
    fail "output unexpectedly contained: $1"
  fi
}

assert_log_contains() {
  grep -Fq -- "$1" "$WORKSHOP_TEST_LOG" || {
    sed -n '1,240p' "$WORKSHOP_TEST_LOG" >&2
    fail "command log did not contain: $1"
  }
}

assert_log_excludes() {
  if grep -Fq -- "$1" "$WORKSHOP_TEST_LOG"; then
    sed -n '1,240p' "$WORKSHOP_TEST_LOG" >&2
    fail "command log unexpectedly contained: $1"
  fi
}

write_common_fakes() {
  local fake_bin="$1"
  mkdir -p "$fake_bin"

  cat > "${fake_bin}/aws" <<'EOF'
#!/usr/bin/env bash
printf 'aws %s\n' "$*" >> "$WORKSHOP_TEST_LOG"
case "$1 $2" in
  "sts get-caller-identity")
    printf 'Account: workshop-test\n'
    ;;
  "eks update-kubeconfig")
    printf 'Updated context\n'
    ;;
esac
EOF

  cat > "${fake_bin}/kubectl" <<'EOF'
#!/usr/bin/env bash
printf 'kubectl %s\n' "$*" >> "$WORKSHOP_TEST_LOG"
args=" $* "
if [[ "$args" == *" config current-context "* ]]; then
  printf 'arn:aws:eks:workshop\n'
elif [[ "$args" == *" get nodes "* ]]; then
  printf 'NAME STATUS\nnode-1 Ready\n'
elif [[ "$args" == *"jsonpath={.items[0].metadata.name}"* ]]; then
  printf 'demo-observability-demo-gateway-service'
elif [[ "$args" == *"jsonpath={.items[0].status.loadBalancer.ingress[0].hostname}"* ]]; then
  if [[ "${WORKSHOP_TEST_LB_MODE:-hostname}" == "hostname" ]]; then
    printf 'demo.example.test'
  fi
elif [[ "$args" == *"jsonpath={.items[0].status.loadBalancer.ingress[0].ip}"* ]]; then
  if [[ "${WORKSHOP_TEST_LB_MODE:-hostname}" == "ip" ]]; then
    printf '203.0.113.10'
  fi
elif [[ "$args" == *" describe service/"* ]]; then
  printf 'Service diagnostics\n'
elif [[ "$args" == *" get events "* ]]; then
  printf 'LoadBalancer event diagnostics\n'
fi
EOF

  cat > "${fake_bin}/helm" <<'EOF'
#!/usr/bin/env bash
printf 'helm %s\n' "$*" >> "$WORKSHOP_TEST_LOG"
if [[ "$1" == "status" && "$2" == "datakit" ]]; then
  [[ "${WORKSHOP_TEST_EXISTING_DATAKIT:-false}" == "true" ]]
  exit
fi
exit 0
EOF

  cat > "${fake_bin}/curl" <<'EOF'
#!/usr/bin/env bash
printf 'curl %s\n' "$*" >> "$WORKSHOP_TEST_LOG"
output=""
url=""
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --output)
      output="$2"
      shift 2
      ;;
    http*)
      url="$1"
      shift
      ;;
    *)
      shift
      ;;
  esac
done
if [[ -n "$output" ]]; then
  if [[ "$url" == *.sha256sum ]]; then
    printf 'testchecksum  archive\n' > "$output"
  else
    printf 'fake archive\n' > "$output"
  fi
fi
EOF

  chmod +x "${fake_bin}/aws" "${fake_bin}/kubectl" "${fake_bin}/helm" "${fake_bin}/curl"
}

run_install() {
  local name="$1"
  local input="$2"
  shift 2
  local case_root="${TEST_ROOT}/${name}"
  local fake_bin="${case_root}/bin"
  mkdir -p "${case_root}/home"
  write_common_fakes "$fake_bin"
  WORKSHOP_TEST_LOG="${case_root}/commands.log"
  RUN_OUTPUT="${case_root}/output.log"
  : > "$WORKSHOP_TEST_LOG"
  set +e
  env \
    PATH="${fake_bin}:/usr/bin:/bin" \
    HOME="${case_root}/home" \
    WORKSHOP_TEST_LOG="$WORKSHOP_TEST_LOG" \
    WORKSHOP_TEST_EXISTING_DATAKIT="${WORKSHOP_TEST_EXISTING_DATAKIT:-false}" \
    WORKSHOP_TEST_LB_MODE="${WORKSHOP_TEST_LB_MODE:-hostname}" \
    WORKSHOP_LOAD_BALANCER_TIMEOUT_SECONDS="${WORKSHOP_LOAD_BALANCER_TIMEOUT_SECONDS:-600}" \
    WORKSHOP_LOAD_BALANCER_POLL_SECONDS="0" \
    EKS_CLUSTER_NAME="${EKS_CLUSTER_NAME-}" \
    DATAWAY_URL="${DATAWAY_URL-}" \
    RUM_APPLICATION_ID="${RUM_APPLICATION_ID-}" \
    RUM_GAME_APPLICATION_ID="${RUM_GAME_APPLICATION_ID-}" \
    GUANCE_WORKSPACE_ID="${GUANCE_WORKSPACE_ID-}" \
    bash "$WORKSHOP_SCRIPT" install "$@" > "$RUN_OUTPUT" 2>&1 <<< "$input"
  RUN_EXIT=$?
  set -e
  TEST_COUNT=$((TEST_COUNT + 1))
}

set_valid_inputs() {
  EKS_CLUSTER_NAME="eks-workshop"
  DATAWAY_URL="https://example.invalid/workshop-test-dataway"
  RUM_APPLICATION_ID="rum-app-id"
  RUM_GAME_APPLICATION_ID="game-rum-app-id"
  GUANCE_WORKSPACE_ID="workspace-id"
  WORKSHOP_TEST_EXISTING_DATAKIT=false
  WORKSHOP_TEST_LB_MODE=hostname
  WORKSHOP_LOAD_BALANCER_TIMEOUT_SECONDS=600
}

test_missing_inputs() {
  unset EKS_CLUSTER_NAME DATAWAY_URL RUM_APPLICATION_ID RUM_GAME_APPLICATION_ID GUANCE_WORKSPACE_ID || true
  WORKSHOP_TEST_EXISTING_DATAKIT=false
  WORKSHOP_TEST_LB_MODE=hostname
  WORKSHOP_LOAD_BALANCER_TIMEOUT_SECONDS=600
  run_install missing "" --yes
  assert_failure
  assert_output_contains "Missing required environment variables: EKS_CLUSTER_NAME DATAWAY_URL RUM_APPLICATION_ID RUM_GAME_APPLICATION_ID GUANCE_WORKSPACE_ID"
  [[ ! -s "$WORKSHOP_TEST_LOG" ]] || fail "missing-input validation called external commands"
}

test_shared_rum_application_is_rejected() {
  set_valid_inputs
  RUM_GAME_APPLICATION_ID="$RUM_APPLICATION_ID"
  run_install shared-rum "" --yes
  assert_failure
  assert_output_contains "RUM_GAME_APPLICATION_ID must differ from RUM_APPLICATION_ID"
  [[ ! -s "$WORKSHOP_TEST_LOG" ]] || fail "shared RUM validation called external commands"
}

test_confirmation() {
  set_valid_inputs
  run_install confirmation "n"
  assert_failure
  assert_output_contains "Kubernetes context: arn:aws:eks:workshop"
  assert_output_contains "ERROR: cancelled"
  assert_log_contains "aws sts get-caller-identity --output table"
  assert_log_contains "aws eks update-kubeconfig --name eks-workshop"
  assert_log_excludes "--region"
  assert_log_excludes "helm upgrade --install"
}

test_hostname_install() {
  set_valid_inputs
  run_install hostname "" --yes
  assert_success
  assert_output_contains "DEMO_BASE_URL=http://demo.example.test"
  assert_output_contains "SourceMap: scripts/package-rum-sourcemap.sh --version 2.3.6"
  assert_output_contains "SourceMap upload: Environment=demo, Version=2.3.6"
  assert_output_excludes "$DATAWAY_URL"
  assert_output_excludes "verification passed"
  assert_log_contains "helm repo add datakit https://pubrepo.guance.com/chartrepo/datakit --force-update"
  assert_log_contains "helm upgrade --install datakit datakit/datakit --version 2.5.0"
  assert_log_contains "--set-file datakit.dataway_url="
  assert_log_contains "helm upgrade --install demo"
  assert_log_contains "--set-string image.tag=2.3.6"
  assert_log_contains "--set-string datakit.provider=guance"
  assert_log_contains "--set-string rum.applicationId=rum-app-id"
  assert_log_contains "--set-string rum.gameApplicationId=game-rum-app-id"
  assert_log_contains "--set-string observability.clusterName=eks-workshop"
  assert_log_contains "--set-string observabilityConsole.url=https://console.guance.com/"
  assert_log_excludes "$DATAWAY_URL"
  assert_log_excludes "--region"
  assert_log_excludes "smoke-test"
  assert_log_excludes "generate-traffic"
  assert_log_excludes "inject-fault"
}

test_existing_datakit_protection() {
  set_valid_inputs
  WORKSHOP_TEST_EXISTING_DATAKIT=true
  run_install existing "" --yes
  assert_failure
  assert_output_contains "DataKit release datakit/datakit already exists"
  assert_log_excludes "helm upgrade --install"
}

test_explicit_datakit_upgrade() {
  set_valid_inputs
  WORKSHOP_TEST_EXISTING_DATAKIT=true
  run_install upgrade "" --yes --upgrade-existing-datakit
  assert_success
  assert_output_contains "Upgrading the existing DataKit release by explicit request"
  assert_log_contains "helm upgrade --install datakit datakit/datakit"
}

test_ip_load_balancer() {
  set_valid_inputs
  WORKSHOP_TEST_LB_MODE=ip
  run_install ip "" --yes
  assert_success
  assert_output_contains "DEMO_BASE_URL=http://203.0.113.10"
}

test_load_balancer_timeout() {
  set_valid_inputs
  WORKSHOP_TEST_LB_MODE=none
  WORKSHOP_LOAD_BALANCER_TIMEOUT_SECONDS=0
  run_install timeout "" --yes
  assert_failure
  assert_output_contains "Service diagnostics"
  assert_output_contains "LoadBalancer event diagnostics"
  assert_output_contains "Gateway LoadBalancer did not receive an address within 10 minutes"
}

test_helm_bootstrap() {
  local case_root="${TEST_ROOT}/helm-bootstrap"
  local fake_bin="${case_root}/bin"
  mkdir -p "$fake_bin" "${case_root}/home"
  write_common_fakes "$fake_bin"
  cp "$fake_bin/helm" "${case_root}/helm-template"
  rm "$fake_bin/helm"

  cat > "${fake_bin}/sha256sum" <<'EOF'
#!/usr/bin/env bash
printf 'testchecksum  %s\n' "$1"
EOF
  cat > "${fake_bin}/tar" <<'EOF'
#!/usr/bin/env bash
destination=""
while [[ "$#" -gt 0 ]]; do
  if [[ "$1" == "-C" ]]; then
    destination="$2"
    break
  fi
  shift
done
mkdir -p "${destination}/linux-amd64" "${destination}/linux-arm64"
cp "$WORKSHOP_TEST_HELM_TEMPLATE" "${destination}/linux-amd64/helm"
cp "$WORKSHOP_TEST_HELM_TEMPLATE" "${destination}/linux-arm64/helm"
EOF
  cat > "${fake_bin}/install" <<'EOF'
#!/usr/bin/env bash
source_path="${@: -2:1}"
target_path="${@: -1}"
cp "$source_path" "$target_path"
chmod 0755 "$target_path"
EOF
  chmod +x "${fake_bin}/sha256sum" "${fake_bin}/tar" "${fake_bin}/install"

  WORKSHOP_TEST_LOG="${case_root}/commands.log"
  RUN_OUTPUT="${case_root}/output.log"
  : > "$WORKSHOP_TEST_LOG"
  set_valid_inputs
  set +e
  env \
    PATH="${fake_bin}:/usr/bin:/bin" \
    HOME="${case_root}/home" \
    WORKSHOP_TEST_LOG="$WORKSHOP_TEST_LOG" \
    WORKSHOP_TEST_HELM_TEMPLATE="${case_root}/helm-template" \
    WORKSHOP_TEST_EXISTING_DATAKIT=false \
    WORKSHOP_TEST_LB_MODE=hostname \
    WORKSHOP_LOAD_BALANCER_TIMEOUT_SECONDS=600 \
    WORKSHOP_LOAD_BALANCER_POLL_SECONDS=0 \
    EKS_CLUSTER_NAME="$EKS_CLUSTER_NAME" \
    DATAWAY_URL="$DATAWAY_URL" \
    RUM_APPLICATION_ID="$RUM_APPLICATION_ID" \
    RUM_GAME_APPLICATION_ID="$RUM_GAME_APPLICATION_ID" \
    GUANCE_WORKSPACE_ID="$GUANCE_WORKSPACE_ID" \
    bash "$WORKSHOP_SCRIPT" install --yes > "$RUN_OUTPUT" 2>&1
  RUN_EXIT=$?
  set -e
  TEST_COUNT=$((TEST_COUNT + 1))
  assert_success
  assert_output_contains "Installing Helm v3.17.3"
  assert_log_contains "https://get.helm.sh/helm-v3.17.3-linux-"
  assert_log_contains ".tar.gz.sha256sum"
  [[ -x "${case_root}/home/bin/helm" ]] || fail "Helm was not installed into HOME/bin"
  [[ "$(grep -Fc 'export PATH="$HOME/bin:$PATH"' "${case_root}/home/.bashrc")" -eq 1 ]] || fail "CloudShell PATH was not added exactly once"
}

test_missing_inputs
test_shared_rum_application_is_rejected
test_confirmation
test_hostname_install
test_existing_datakit_protection
test_explicit_datakit_upgrade
test_ip_load_balancer
test_load_balancer_timeout
test_helm_bootstrap

printf 'workshop install tests passed: %s cases\n' "$TEST_COUNT"
