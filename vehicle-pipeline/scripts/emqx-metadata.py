#!/usr/bin/env python3
"""Observe native EMQX counters; forward metadata only over the encrypted tunnel."""

import importlib.util
import json
import time
from pathlib import Path
from urllib.request import Request, urlopen
from uuid import uuid4

state_path = Path("/var/lib/vehicle-demo/pipeline-metadata-state.json")


def lifecycle_state(old, counts, node, uptime):
    replaced = old.get("node") != node or uptime < old.get("uptime", 0) or any(
        counts[k] < old.get(k, 0) for k in ["matched", "success"]
    )
    epoch = str(uuid4()) if replaced else old["epoch"]
    return dict(counts, node=node, uptime=uptime, epoch=epoch)


def observe():
    spec = importlib.util.spec_from_file_location("broker", "/opt/vehicle-demo/bootstrap-users.py")
    broker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(broker)
    credentials = json.loads(Path("/etc/vehicle-demo/credentials.json").read_text())
    pipeline = json.loads(Path("/etc/vehicle-demo/pipeline.json").read_text())
    token = broker.request("login", {"username": "admin", "password": credentials["admin"]})[
        "token"
    ]
    action = broker.request("actions/kafka_producer:vehicle_telemetry", token=token)
    metrics = broker.request("actions/kafka_producer:vehicle_telemetry/metrics", token=token)[
        "metrics"
    ]
    rule = broker.request("rules/vehicle_to_kafka/metrics", token=token)["metrics"]
    # Broker API works both for a local container and a Kubernetes deployment.
    nodes = broker.request("nodes", token=token)
    if len(nodes) != 1 or nodes[0].get("node_status") != "running":
        raise RuntimeError("broker_node_unavailable")
    node = nodes[0]["node"]
    uptime = int(nodes[0]["uptime"])
    old = json.loads(state_path.read_text()) if state_path.exists() else {}
    counts = {
        "matched": int(rule.get("matched", 0)),
        "success": int(metrics.get("success", 0)),
        "failed": int(metrics.get("failed", 0)),
        "dropped": int(metrics.get("dropped", 0)),
        "queuing": int(metrics.get("queuing", 0)),
    }
    state = lifecycle_state(old, counts, node, uptime)
    state_path.parent.mkdir(parents=True, exist_ok=True)
    temp = state_path.with_suffix(".tmp")
    temp.write_text(json.dumps(state))
    temp.chmod(0o600)
    temp.replace(state_path)
    status = action.get("status", "disconnected") if action.get("enable", False) else "stopped"
    if status not in {"connected", "connecting", "disconnected", "stopped"}:
        status = "disconnected"
    data = dict(counts, version=1, instanceKey=state["epoch"], status=status)
    req = Request(
        "http://127.0.0.1:18089/internal/emqx",
        data=json.dumps(data).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + pipeline["bridge_token"],
        },
    )
    with urlopen(req, timeout=10) as response:
        if response.status != 200:
            raise RuntimeError("snapshot_rejected")


if __name__ == "__main__":
    while True:
        try:
            observe()
        except (
            OSError,
            ValueError,
            TypeError,
            KeyError,
            RuntimeError,
        ) as error:
            print(
                json.dumps({"event": "metadata_unavailable", "code": type(error).__name__}),
                flush=True,
            )
        time.sleep(20)
