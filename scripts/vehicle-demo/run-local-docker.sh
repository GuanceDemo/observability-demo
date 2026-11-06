#!/bin/sh
# Reuse the existing local Demo containers without recreating their configuration.
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/../.." && pwd)
cd "$repo_dir"
if [ ! -s .local-work/vehicle-demo/kube/config ] || [ ! -s .local-work/vehicle-demo/kube/compose.env ]; then
  echo 'Prepare Kubernetes access first: python3 scripts/vehicle-demo/configure-local-kube.py --help' >&2
  exit 1
fi
if [ ! -s .local-work/vehicle-demo/player/config.json ] || [ ! -s .local-work/vehicle-demo/player/web/index.html ]; then
  echo 'Prepare the local vehicle player bundle and endpoint configuration; see scripts/vehicle-demo/local/README.md.' >&2
  exit 1
fi
for component in mysql redis inventory-service payment-service order-service game-service gateway-service; do
  if ! docker container inspect "observability-demo-$component-1" >/dev/null 2>&1; then
    echo "Existing local Demo container missing: observability-demo-$component-1" >&2
    echo "Initialize the project's local Docker stack first; see scripts/vehicle-demo/local/README.md." >&2
    exit 1
  fi
done
docker start observability-demo-mysql-1 observability-demo-redis-1
attempt=0
until [ "$(docker inspect --format '{{.State.Health.Status}}' observability-demo-mysql-1)" = healthy ] \
   && [ "$(docker inspect --format '{{.State.Health.Status}}' observability-demo-redis-1)" = healthy ]; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then echo "Local MySQL/Redis did not become ready." >&2; exit 1; fi
  sleep 2
done
docker start observability-demo-inventory-service-1 observability-demo-payment-service-1 \
  observability-demo-game-service-1 observability-demo-order-service-1 observability-demo-gateway-service-1
docker compose --env-file .local-work/vehicle-demo/kube/compose.env -f compose.local-vehicle.yaml up -d --build
echo 'Open http://127.0.0.1:8767/business.html?scene=vehicle-telemetry&view=web'
