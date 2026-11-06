#!/usr/bin/env python3
"""Retarget an offline restored broker before any MQTT clients can reconnect."""
import json
import os
import subprocess
from pathlib import Path

OLD = "172.19.0.1:19092"
NEW = "vehicle-kafka.vehicle-pipeline.svc.cluster.local:9092"


def retarget(text):
    if "vehicle_kafka" not in text or "vehicle-pipeline:v1" not in text:
        raise ValueError("Refusing unowned Kafka connector configuration")
    if OLD not in text and text.count(NEW) == 1:
        return text
    if text.count(OLD) != 1 or NEW in text:
        raise ValueError("Expected exactly one legacy Kafka endpoint")
    return text.replace(OLD, NEW)


def main():
    deployment = json.loads(subprocess.check_output(
        ["kubectl", "-n", "vehicle-pipeline", "get", "deployment", "vehicle-emqx", "-o", "json"],
        universal_newlines=True,
    ))
    if deployment["spec"].get("replicas", 1) != 0 or deployment.get("status", {}).get("replicas", 0):
        raise SystemExit("Stop all target broker pods before changing restored data")
    pods = json.loads(subprocess.check_output(
        ["kubectl", "-n", "vehicle-pipeline", "get", "pods", "-l", "app=vehicle-emqx", "-o", "json"],
        universal_newlines=True,
    ))
    if pods["items"]:
        raise SystemExit("Wait for all target broker pods to terminate")
    config = Path("/var/lib/vehicle-pipeline/emqx/configs/cluster.hocon")
    original = config.read_text()
    updated = retarget(original)
    if updated == original:
        print("Restored broker already uses in-cluster Kafka.")
        return
    backup = Path("/var/lib/vehicle-pipeline/emqx-migration/cluster.hocon.before")
    backup.parent.mkdir(mode=0o700, exist_ok=True)
    if not backup.exists():
        descriptor = os.open(str(backup), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as output:
            output.write(original)
    previous = config.stat()
    temp = config.with_suffix(".migration.tmp")
    descriptor = os.open(str(temp), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as output:
        output.write(updated)
        output.flush()
        os.fsync(output.fileno())
    os.chown(str(temp), previous.st_uid, previous.st_gid)
    temp.chmod(previous.st_mode & 0o777)
    temp.replace(config)
    print("Offline Kafka endpoint updated; credentials, rules and buffers preserved.")


if __name__ == "__main__":
    main()
