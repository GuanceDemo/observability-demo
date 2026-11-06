FROM python:3.12-slim-bookworm@sha256:8a7e7cc04fd3e2bd787f7f24e22d5d119aa590d429b50c95dfe12b3abe52f48b
WORKDIR /workspace
COPY scripts/vehicle-demo/local/requirements.txt /tmp/vehicle-requirements.txt
RUN pip install --no-cache-dir -r /tmp/vehicle-requirements.txt && rm /tmp/vehicle-requirements.txt
COPY order-service/src/main/resources/static/ order-service/src/main/resources/static/
COPY game-service/src/main/resources/static/ game-service/src/main/resources/static/
COPY scripts/vehicle-demo/local/*.py scripts/vehicle-demo/local/
COPY scripts/vehicle-demo/local/*.expr scripts/vehicle-demo/local/*.sh scripts/vehicle-demo/local/
COPY scripts/vehicle-demo/local/web/ scripts/vehicle-demo/local/web/
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
EXPOSE 8767
HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8767/business.html', timeout=3).close()"
CMD ["python", "scripts/vehicle-demo/local/server.py", "--bind", "0.0.0.0"]
