# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d AS player
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 protobuf-compiler libprotobuf-dev rsync \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY scripts/android-webrtc/ scripts/android-webrtc/
RUN PLAYER_DEVICE_PROFILE=vehicle bash scripts/android-webrtc/build-player.sh /player

FROM python:3.12-slim-bookworm@sha256:8a7e7cc04fd3e2bd787f7f24e22d5d119aa590d429b50c95dfe12b3abe52f48b
WORKDIR /workspace
# Cluster transport uses the standard library and projected ServiceAccount token.
COPY scripts/vehicle-demo/local/*.py scripts/vehicle-demo/local/
COPY scripts/vehicle-demo/local/*.expr scripts/vehicle-demo/local/*.sh scripts/vehicle-demo/local/
COPY scripts/vehicle-demo/local/web/ scripts/vehicle-demo/local/web/
COPY --from=player /player/ /opt/vehicle-player/web/
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 VEHICLE_MODE=cluster \
    VEHICLE_PLAYER_ASSETS=/opt/vehicle-player/web \
    VEHICLE_PLAYER_CONFIG=/etc/vehicle-workbench/player-config.json
USER 10001:10001
EXPOSE 8767
HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8767/healthz', timeout=3).close()"
CMD ["python", "scripts/vehicle-demo/local/server.py", "--bind", "0.0.0.0"]
