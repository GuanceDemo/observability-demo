import json
import os
from urllib.request import Request, urlopen

BASE = "http://127.0.0.1:18183/api/v5/"


def api(path, value=None, token=None):
    with urlopen(
        Request(
            BASE + path,
            data=None if value is None else json.dumps(value).encode(),
            headers={
                "Content-Type": "application/json",
                **({"Authorization": "Bearer " + token} if token else {}),
            },
        ),
        timeout=15,
    ) as r:
        return json.load(r)


token = api(
    "login", {"username": "admin", "password": os.environ["EMQX_LAB_PASSWORD"]}
)["token"]
print(
    [
        {k: v for k, v in n.items() if k in ("node", "node_status", "version")}
        for n in api("nodes", token=token)
    ]
)
for route, value in [
    (
        "connectors",
        {
            "type": "kafka_producer",
            "name": "vehicle_kafka",
            "enable": True,
            "description": "vehicle-pipeline:v1",
            "bootstrap_hosts": "kafka:9092",
            "authentication": "none",
            "ssl": {"enable": False},
            "health_check_topic": "vehicle.telemetry.raw.v1",
            "allow_auto_topic_creation": False,
        },
    ),
    (
        "actions",
        {
            "type": "kafka_producer",
            "name": "vehicle_telemetry",
            "connector": "vehicle_kafka",
            "enable": True,
            "description": "vehicle-pipeline:v1",
            "parameters": {
                "topic": "vehicle.telemetry.raw.v1",
                "message": {
                    "key": "${vehicleId}",
                    "value": "${payload}",
                    "timestamp": "${timestamp}",
                },
                "partition_strategy": "key_dispatch",
                "required_acks": "all_isr",
                "max_inflight": 1,
                "buffer": {
                    "mode": "disk",
                    "per_partition_limit": "100MB",
                    "segment_bytes": "5MB",
                },
                "max_batch_age": "24h",
                "max_linger_time": "5ms",
            },
        },
    ),
    (
        "rules",
        {
            "id": "vehicle_to_kafka",
            "enable": True,
            "description": "vehicle-pipeline:v1",
            "sql": 'SELECT payload, payload.vehicleId AS vehicleId FROM "vehicle/v1/demo-vehicle-001/telemetry"',
            "actions": ["kafka_producer:vehicle_telemetry"],
        },
    ),
]:
    api(route, value, token)
print("Isolated connector/action/rule created")
