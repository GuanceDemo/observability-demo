#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
namespace="${NAMESPACE:-observability-demo}"
release="${DATA_PIPELINE_RELEASE:-mall-data}"
cronjob="${release}-pipeline"

usage() {
  cat <<'USAGE'
Usage: scripts/data-observability.sh <command>
  install [helm flags]   Install/upgrade the independent chart, suspended by default
  run [mode] [seconds]   Create a manual Job from the CronJob (default: normal, 30s)
                        Modes: normal, fail-clean, fail-aggregate, slow, recovery, replay
  status                Show schedule, Jobs and Pods
  logs <job-name>        Read one manual/scheduled Job's logs
  enable | suspend      Enable or suspend the five-minute schedule
  uninstall             Suspend then remove only the pipeline Helm release
Env: NAMESPACE, DATA_PIPELINE_RELEASE
USAGE
}

command="${1:-help}"
shift || true
case "$command" in
  install)
    helm upgrade --install "$release" "$root_dir/charts/data-observability-demo" \
      --namespace "$namespace" --set suspend=true "$@"
    ;;
  run)
    mode="${1:-normal}"
    seconds="${2:-30}"
    case "$mode" in normal|fail-clean|fail-aggregate|slow|recovery|replay) ;; *) usage; exit 1 ;; esac
    if [[ ! "$seconds" =~ ^[0-9]+$ ]] || (( seconds < 1 || seconds > 120 )); then
      echo 'Delay must be between 1 and 120 seconds' >&2
      exit 1
    fi
    job="${release}-${mode}-$(date -u +%Y%m%d%H%M%S)-${RANDOM}"
    kubectl -n "$namespace" create job "$job" --from="cronjob/$cronjob" \
      --dry-run=client -o json |
      python3 -c 'import json,sys
d=json.load(sys.stdin)
d["spec"]["template"]["spec"]["containers"][0]["args"]=["--mode",sys.argv[1],"--delay-seconds",sys.argv[2]]
json.dump(d,sys.stdout)' "$mode" "$seconds" |
      kubectl -n "$namespace" create -f -
    echo "Read results: scripts/data-observability.sh logs $job"
    ;;
  status)
    kubectl -n "$namespace" get cronjob "$cronjob"
    kubectl -n "$namespace" get jobs,pods -l "app.kubernetes.io/instance=$release"
    ;;
  logs)
    kubectl -n "$namespace" logs "job/${1:?Job name required}" --all-containers=true
    ;;
  enable|suspend)
    suspended=true
    [[ "$command" == enable ]] && suspended=false
    helm upgrade "$release" "$root_dir/charts/data-observability-demo" \
      --namespace "$namespace" --reuse-values --set "suspend=$suspended"
    ;;
  uninstall)
    kubectl -n "$namespace" patch cronjob "$cronjob" --type=merge -p '{"spec":{"suspend":true}}'
    helm uninstall "$release" --namespace "$namespace"
    echo 'Analytics database, account and credential Secret are retained.'
    ;;
  help|-h|--help) usage ;;
  *) usage; exit 1 ;;
esac
