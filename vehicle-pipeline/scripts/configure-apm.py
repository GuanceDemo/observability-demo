#!/usr/bin/env python3
"""Configure only owned vehicle resources. Run on the GCP management host.

Stop the publisher under its existing maintenance guard first. Never replace a
Kafka action with queued/inflight messages. Backups contain secrets: mode 0600.
"""
import argparse
import copy
import importlib.util
import json
import os
import time
from pathlib import Path
from urllib.parse import urlsplit

ACTION = "kafka_producer:vehicle_telemetry"
RULE = "vehicle_to_kafka"
OWNER = "vehicle-pipeline:v1"
HEADER = {"kafka_ext_header_key": "traceparent",
          "kafka_ext_header_value": "${pub_props.User-Property.traceparent}"}


def plans(action, rule, otel, endpoint):
    url = urlsplit(endpoint)
    if url.scheme != "http" or not url.hostname or not url.port or url.username or url.query or url.fragment:
        raise ValueError("invalid_private_otlp_endpoint")
    if action.get("description") != OWNER or rule.get("description") != OWNER:
        raise ValueError("unowned_broker_resource")
    if any(otel.get(k, {}).get("enable") for k in ("metrics", "logs")) and otel["exporter"]["endpoint"] != endpoint:
        raise ValueError("existing_otel_export_destination_in_use")
    a, r, o = copy.deepcopy(action), copy.deepcopy(rule), copy.deepcopy(otel)
    parameters = a["parameters"]
    if parameters.get("kafka_header_value_encode_mode", "none") != "none":
        raise ValueError("unexpected_existing_header_encoding")
    headers = parameters.setdefault("kafka_ext_headers", [])
    existing = [h for h in headers if h["kafka_ext_header_key"] == "traceparent"]
    if existing and existing != [HEADER]:
        raise ValueError("foreign_traceparent_mapping")
    if not existing:
        headers.append(HEADER.copy())
    parameters["kafka_header_value_encode_mode"] = "none"
    expected = 'SELECT payload, payload.vehicleId AS vehicleId FROM "vehicle/v1/demo-vehicle-001/telemetry"'
    traced = expected.replace("SELECT payload,", "SELECT pub_props, payload,")
    if r["sql"] not in (expected, traced):
        raise ValueError("unexpected_rule_sql")
    r["sql"] = traced
    o["traces"]["enable"] = True
    o["traces"]["filter"].update(trace_mode="legacy", trace_all=False)
    o["exporter"].update(endpoint=endpoint, protocol="grpc")
    return a, r, o


def drained(metrics):
    return all(metrics.get(k) == 0 for k in ("queuing", "inflight"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--endpoint", default="http://vehicle-apm.vehicle-pipeline.svc.cluster.local:4317")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location("broker", "/opt/vehicle-demo/bootstrap-users.py")
    broker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(broker)
    credentials = json.loads(Path("/etc/vehicle-demo/credentials.json").read_text())
    token = broker.request("login", {"username": "admin", "password": credentials["admin"]})["token"]

    def request(path, data=None):
        return broker.request(path, data, token, method="PUT" if data is not None else "GET")

    old = [request("actions/" + ACTION), request("rules/" + RULE), request("opentelemetry")]
    new = plans(*old, args.endpoint)
    if not args.apply:
        print("Plan valid: preserve payload/key/buffer; add context header and native tracing.")
        return
    before = request("actions/" + ACTION + "/metrics")["metrics"]
    time.sleep(3)
    after = request("actions/" + ACTION + "/metrics")["metrics"]
    if not drained(before) or not drained(after) or before["matched"] != after["matched"]:
        raise RuntimeError("publisher_must_be_quiesced_and_native_queue_empty")
    backup = Path("/etc/vehicle-demo/apm-before-{}.json".format(time.time_ns()))
    fd = os.open(str(backup), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(old, f)
    action_fields = {k: v for k, v in new[0].items()
                     if k in {"description", "enable", "connector", "parameters", "resource_opts", "fallback_actions"}}
    # Producer must remain stopped until these writes and readback finish.
    request("actions/" + ACTION, action_fields)
    request("rules/" + RULE, {k: new[1][k] for k in ("sql", "actions", "enable", "description")})
    request("opentelemetry", new[2])
    actual = [request("actions/" + ACTION), request("rules/" + RULE), request("opentelemetry")]
    assert HEADER in actual[0]["parameters"]["kafka_ext_headers"]
    assert actual[1]["sql"] == new[1]["sql"] and actual[2]["traces"]["enable"]
    print("Native tracing and Kafka context mapping verified; private rollback backup saved.")


if __name__ == "__main__":
    main()
