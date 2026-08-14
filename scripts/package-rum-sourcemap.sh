#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
assets_dir="${root_dir}/order-service/src/main/resources/static/assets"
chart_file="${root_dir}/charts/observability-demo/Chart.yaml"
version=""

usage() {
  cat <<'EOF'
Usage: scripts/package-rum-sourcemap.sh [--version VERSION]

If --version is omitted, the script uses appVersion from the Helm Chart.
EOF
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --version)
      [[ "$#" -ge 2 ]] || { echo "--version requires a value" >&2; exit 2; }
      version="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$version" ]]; then
  version="$(sed -n 's/^appVersion: *"\{0,1\}\([^"[:space:]]*\)"\{0,1\}$/\1/p' "$chart_file")"
fi
[[ "$version" =~ ^[0-9A-Za-z][0-9A-Za-z._-]*$ ]] || {
  echo "invalid SourceMap version: $version" >&2
  exit 2
}

output_dir="${root_dir}/dist/rum-sourcemap-${version}"
archive="${root_dir}/dist/observability-demo-rum-sourcemap-${version}.zip"

rm -rf -- "$output_dir"
mkdir -p "$output_dir/assets/src"
cp "$assets_dir/checkout-sourcemap-fault.min.js" "$output_dir/assets/"
cp "$assets_dir/checkout-sourcemap-fault.min.js.map" "$output_dir/assets/"
cp "$assets_dir/src/checkout-sourcemap-fault.js" "$output_dir/assets/src/"
rm -f -- "$archive"
(cd "$output_dir" && zip -qr "$archive" .)

printf 'created %s\n' "$archive"
printf 'upload environment: demo\n'
printf 'upload version: %s\n' "$version"
