#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
NAMESPACE=${NAMESPACE:-observability-demo}
RELEASE=${RELEASE:-mall-reports}
action=${1:-status}
shift || true
case "$action" in
  install) helm upgrade --install "$RELEASE" "$ROOT/charts/report-jobs" -n "$NAMESPACE" --wait "$@" ;;
  run)
    mode=${1:-daily}
    case "$mode" in daily|trend|fail-daily|fail-trend|replay) ;; *) echo 'Unsupported report mode' >&2; exit 1;; esac
    component=${mode#fail-}
    [[ "$component" == replay ]] && component=daily
    job="${RELEASE}-${mode}-$(date -u +%Y%m%d%H%M%S)-${RANDOM}"
    kubectl -n "$NAMESPACE" create job "$job" --from="cronjob/${RELEASE}-${component}" --dry-run=client -o json |
      python3 -c 'import json,sys; obj=json.load(sys.stdin); obj["spec"]["template"]["spec"]["containers"][0]["args"]=[sys.argv[1]]; print(json.dumps(obj))' "$mode" |
      kubectl -n "$NAMESPACE" create -f -
    echo "$job"
    ;;
  enable|suspend)
    suspended=true; [[ "$action" == enable ]] && suspended=false
    helm upgrade "$RELEASE" "$ROOT/charts/report-jobs" -n "$NAMESPACE" --reuse-values --set "suspend=$suspended" --wait
    ;;
  status) kubectl -n "$NAMESPACE" get cronjobs,jobs -l "app.kubernetes.io/instance=$RELEASE" ;;
  logs) kubectl -n "$NAMESPACE" logs "job/${1:?Job name required}" ;;
  uninstall) helm uninstall "$RELEASE" -n "$NAMESPACE" ;;
  *) echo 'Usage: report-jobs.sh install|run [daily|trend|fail-daily|fail-trend|replay]|enable|suspend|status|logs JOB|uninstall' >&2; exit 1 ;;
esac
