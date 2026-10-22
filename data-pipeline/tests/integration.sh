#!/usr/bin/env bash
set -euo pipefail
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
container="mall-data-test-$(date +%s)-${RANDOM}"
credentials="$(mktemp)"
chmod 600 "$credentials"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -f "$credentials"
}
trap cleanup EXIT
export TEST_MYSQL_PASSWORD
TEST_MYSQL_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_hex(24))')"
printf 'MYSQL_ROOT_PASSWORD=%s\n' "$TEST_MYSQL_PASSWORD" >"$credentials"
docker run -d --name "$container" --env-file "$credentials" \
  -p 127.0.0.1::3306 mysql:8.4 >/dev/null
export TEST_MYSQL_PORT
TEST_MYSQL_PORT="$(docker inspect "$container" --format '{{(index (index .NetworkSettings.Ports "3306/tcp") 0).HostPort}}')"
ready=false
for ((attempt=0; attempt<60; attempt++)); do
  if docker exec "$container" sh -c \
    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -h127.0.0.1 -uroot -e "SELECT 1"' >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo 'Disposable MySQL did not become ready' >&2
  exit 1
fi
uv run --project "$root_dir/data-pipeline" pytest "$root_dir/data-pipeline/tests" -m integration "$@"
