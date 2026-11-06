# Isolated EMQX send-window validation

This test uses only the named local Docker project and loopback ports18183/19183.
It creates no vehicle-cluster fault or production telemetry. Use a fresh lab for
setup. Never point the scripts at a remote broker. Requirements: Docker and uv.

```sh
export EMQX_LAB_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')"
docker compose -p vehicle-emqx-gate-lab -f scripts/vehicle-demo/local/tests/emqx_lab/compose.yaml up -d
# Wait until both containers are ready (typically30s), then create the raw topic:
docker exec vehicle-emqx-gate-lab-kafka-1 /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 --create --topic vehicle.telemetry.raw.v1 --partitions 1 --replication-factor 1
python3 scripts/vehicle-demo/local/tests/emqx_lab/setup.py
mkdir -p .local-work/vehicle-demo/emqx-internal
uv run --with paho-mqtt==2.1.0 python scripts/vehicle-demo/local/tests/emqx_lab/verify.py
docker compose -p vehicle-emqx-gate-lab -f scripts/vehicle-demo/local/tests/emqx_lab/compose.yaml down
unset EMQX_LAB_PASSWORD
```

The verification captures the starting Kafka offset and a unique test session.
It publishes75 QoS1 messages, exercises manual and independent broker-watchdog
restoration, and requires both real queue growth and zero queue/drop/failure
increase after draining. It consumes precisely the new records and compares
every ordered session/ID; an earlier test's records cannot satisfy the check.
The production60s protection uses the same code with a10s deadline in this test.
Evidence is written to `.local-work/vehicle-demo/emqx-internal/lab-proof.json`,
or `EMQX_LAB_PROOF` when set. No sample contents or credentials are persisted.
