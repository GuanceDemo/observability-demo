#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
NAME="mall-report-test-${RANDOM}"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
# This disposable database contains fixtures only; never point integration tests at Demo.
docker run -d --name "$NAME" -e MYSQL_ROOT_PASSWORD=integration-only -p 127.0.0.1::3306 mysql:8.4 >/dev/null
for attempt in $(seq 1 90); do
  if docker exec "$NAME" sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqladmin ping -h127.0.0.1 -uroot --silent' >/dev/null 2>&1; then break; fi
  if [[ "$attempt" == 90 ]]; then echo 'MySQL fixture failed to start' >&2; exit 1; fi
  sleep 1
done
REPORT_MYSQL_PORT=$(docker port "$NAME" 3306/tcp | awk -F: '{print $NF}')
export REPORT_MYSQL_PORT
mvn -f "$ROOT/report-jobs/pom.xml" -B verify
