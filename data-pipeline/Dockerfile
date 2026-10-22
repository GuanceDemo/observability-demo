FROM python:3.12-slim AS builder
RUN pip install --no-cache-dir uv==0.9.5
ENV UV_NO_CACHE=1
WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY src ./src
RUN uv sync --frozen --no-dev --no-editable

FROM python:3.12-slim
ARG SOURCE_REVISION=unknown
LABEL org.opencontainers.image.title="mall-data-pipeline" \
      org.opencontainers.image.version="0.1.1" \
      org.opencontainers.image.revision=$SOURCE_REVISION
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
USER 10001:10001
ENTRYPOINT ["/app/.venv/bin/mall-data-pipeline"]
