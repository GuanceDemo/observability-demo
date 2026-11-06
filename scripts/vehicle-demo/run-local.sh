#!/bin/sh
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/../.." && pwd)
python_bin="$repo_dir/.local-work/vehicle-demo/venv/bin/python"
if [ ! -x "$python_bin" ]; then python_bin=python3; fi
if ! "$python_bin" -c 'import kubernetes' >/dev/null 2>&1; then
  echo 'Install scripts/vehicle-demo/local/requirements.txt into .local-work/vehicle-demo/venv first; see local/README.md.' >&2
  exit 1
fi
if [ -z "${VEHICLE_KUBE_CONTEXT:-}" ] && [ -f "$repo_dir/.local-work/vehicle-demo/kube/metadata.json" ]; then
  VEHICLE_KUBE_CONTEXT=$("$python_bin" -c 'import json,sys; print(json.load(open(sys.argv[1]))["context"])' "$repo_dir/.local-work/vehicle-demo/kube/metadata.json")
  export VEHICLE_KUBE_CONTEXT
fi
if [ -z "${VEHICLE_KUBECONFIG:-}" ] && [ -f "$repo_dir/.local-work/vehicle-demo/kube/config" ]; then
  VEHICLE_KUBECONFIG="$repo_dir/.local-work/vehicle-demo/kube/config"
  export VEHICLE_KUBECONFIG
fi
exec "$python_bin" "$script_dir/local/server.py" "$@"
