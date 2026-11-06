#!/bin/sh
# Build from this working tree, not an assumed Git commit. Never replace an existing image tag.
set -eu
pipeline_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$pipeline_root"
tag=${1:?Usage: build-images.sh UNUSED_IMAGE_TAG}
case "$tag" in *[!a-zA-Z0-9._-]*|'') echo 'Invalid image tag' >&2; exit 1 ;; esac
for component in flink spark control; do
  if docker manifest inspect "pubrepo.jiagouyun.com/demo/observability-demo-vehicle-$component:$tag" >/dev/null 2>&1; then
    echo "Image tag already exists for $component; choose a new tag." >&2
    exit 1
  fi
done
mvn -q -f vehicle-pipeline/pom.xml package
uv run --project vehicle-pipeline/control ruff check vehicle-pipeline/control
uv run --project vehicle-pipeline/control mypy vehicle-pipeline/control/src --config-file vehicle-pipeline/control/pyproject.toml
uv run --project vehicle-pipeline/control pytest -q vehicle-pipeline/control/tests
revision=$(python3 - <<'PY'
import hashlib
from pathlib import Path
h = hashlib.sha256()
for folder in ['vehicle-pipeline', 'data-pipeline']:
    for path in sorted(Path(folder).rglob('*')):
        if path.is_file() and not any(part in {'target', '.venv', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache'} for part in path.parts):
            h.update(str(path).encode()); h.update(path.read_bytes())
print('working-tree-sha256:' + h.hexdigest())
PY
)
for component in flink spark control; do
  docker buildx build --platform linux/amd64,linux/arm64 \
    -f "vehicle-pipeline/Dockerfile.$component" --build-arg "SOURCE_REVISION=$revision" \
    -t "pubrepo.jiagouyun.com/demo/observability-demo-vehicle-$component:$tag" --push .
done
