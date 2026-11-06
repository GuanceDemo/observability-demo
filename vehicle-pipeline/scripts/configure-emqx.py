#!/usr/bin/env python3
"""Configure the broker's native Kafka Sink; never implements a subscriber bridge."""

import importlib.util
import json
from pathlib import Path
from urllib.error import HTTPError

spec = importlib.util.spec_from_file_location("broker", "/opt/vehicle-demo/bootstrap-users.py")
broker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(broker)
credentials = json.loads(Path("/etc/vehicle-demo/credentials.json").read_text())
pipeline = json.loads(Path("/etc/vehicle-demo/pipeline.json").read_text())
token = broker.request("login", {"username": "admin", "password": credentials["admin"]})["token"]
owner = "vehicle-pipeline:v1"


def configure(collection, identity, value):
    try:
        old = broker.request(collection + "/" + identity, token=token)
    except HTTPError as error:
        if error.code != 404:
            raise RuntimeError("inspect_http_" + str(error.code)) from None
        old = None
    value["description"] = owner
    if old and old.get("description") != owner:
        raise RuntimeError("Refusing to modify an unowned broker resource")
    try:
        if old:
            patch = {k: v for k, v in value.items() if k not in {"type", "name", "id"}}
            broker.request(collection + "/" + identity, patch, token, method="PUT")
        else:
            broker.request(collection, value, token)
    except HTTPError as error:
        # Never echo the response; it can contain submitted credentials.
        raise RuntimeError(collection + "_http_" + str(error.code)) from None


configure(
    "connectors",
    "kafka_producer:vehicle_kafka",
    {
        "type": "kafka_producer",
        "name": "vehicle_kafka",
        "enable": True,
        "bootstrap_hosts": pipeline.get("kafka_bootstrap_servers", "172.19.0.1:19092"),
        "authentication": {
            "mechanism": "plain",
            "username": "emqx",
            "password": pipeline["kafka_password"],
        },
        "ssl": {"enable": False},
        "health_check_topic": "vehicle.telemetry.raw.v1",
        "allow_auto_topic_creation": False,
    },
)
configure(
    "actions",
    "kafka_producer:vehicle_telemetry",
    {
        "type": "kafka_producer",
        "name": "vehicle_telemetry",
        "connector": "vehicle_kafka",
        "enable": True,
        "parameters": {
            "topic": "vehicle.telemetry.raw.v1",
            "message": {"key": "${vehicleId}", "value": "${payload}", "timestamp": "${timestamp}"},
            "partition_strategy": "key_dispatch",
            "required_acks": "all_isr",
            "max_inflight": 1,
            "buffer": {"mode": "disk", "per_partition_limit": "100MB", "segment_bytes": "5MB"},
            "max_batch_age": "24h",
            "max_linger_time": "5ms",
        },
    },
)
configure(
    "rules",
    "vehicle_to_kafka",
    {
        "id": "vehicle_to_kafka",
        "enable": True,
        "sql": 'SELECT payload, payload.vehicleId AS vehicleId FROM "vehicle/v1/demo-vehicle-001/telemetry"',
        "actions": ["kafka_producer:vehicle_telemetry"],
    },
)
print("Native EMQX Kafka connector, disk-buffered action and exact-topic rule configured.")
