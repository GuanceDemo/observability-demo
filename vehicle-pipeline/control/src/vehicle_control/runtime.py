import json
from datetime import UTC, datetime
from typing import Any

import requests

from .config import Config
from .flink_evidence import attempt_identity, failures
from .lineage import Lineage
from .store import Store

METRICS = {
    "inputCount": "input",
    "cleanCount": "clean",
    "duplicateCount": "duplicates",
    "invalidCount": "quarantine",
    "anomalyCount": "anomalies",
}


def validate_bridge(data: Any) -> dict[str, Any]:
    if not isinstance(data, dict) or data.get("version") != 1:
        raise ValueError("Invalid bridge snapshot")
    instance = data.get("instanceKey")
    if not isinstance(instance, str) or not 1 <= len(instance) <= 128:
        raise ValueError("Invalid instance")
    output = {"version": 1, "instanceKey": instance}
    for field in ("matched", "success", "failed", "dropped", "queuing"):
        value = data.get(field)
        if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value < 2**63:
            raise ValueError("Invalid counter")
        output[field] = value
    status = data.get("status")
    if status not in {"connected", "connecting", "disconnected", "stopped"}:
        raise ValueError("Invalid status")
    output["status"] = status
    output["ruleId"] = "vehicle_to_kafka"
    return output


class RuntimeReader:
    def __init__(self, config: Config):
        self.config, self.lineage = config, Lineage(config)
        self.http = requests.Session()

    def get(self, path: str) -> Any:
        response = self.http.get(
            self.config.flink_url.rstrip("/") + path, timeout=(3, 10), allow_redirects=False
        )
        response.raise_for_status()
        return response.json()

    def flink(self, store: Store) -> None:
        jobs = [
            job
            for job in self.get("/jobs/overview")["jobs"]
            if job["name"] == "vehicle_clean_and_detect"
        ]
        if not jobs:
            return  # Unreachable/absent execution is unknown, never a fabricated success.
        # Finished jobs can remain in the REST archive. Prefer the newest actual execution.
        job = max(jobs, key=lambda item: item["start-time"])
        detail = self.get("/jobs/" + job["jid"])
        now_ms = int(datetime.now(UTC).timestamp() * 1000)
        # Read engine exceptions before optional task metrics, which disappear during a restart.
        errors = failures(self.get("/jobs/" + job["jid"] + "/exceptions?maxExceptions=30"), now_ms)
        vertices = []
        for vertex in detail.get("vertices", []):
            try:
                execution = self.get("/jobs/" + job["jid"] + "/vertices/" + vertex["id"])
                vertices.append({**execution, "id": vertex["id"]})
            except requests.RequestException:
                vertices = []
                break
        attempt, attempt_started = attempt_identity(job["jid"], vertices)
        counts: dict[str, int] = {}
        metrics_available = True
        for vertex in detail.get("vertices", []):
            for subtask in range(vertex.get("parallelism", 1)):
                base = f"/jobs/{job['jid']}/vertices/{vertex['id']}/subtasks/{subtask}/metrics"
                try:
                    available = self.get(base)
                except requests.RequestException:
                    metrics_available = False
                    continue
                wanted = [item["id"] for item in available if item["id"].endswith("vehicle.counts")]
                for name in wanted:
                    try:
                        values = self.get(base + "?get=" + name)
                    except requests.RequestException:
                        metrics_available = False
                        continue
                    if not values:
                        continue
                    try:
                        sample = json.loads(values[0]["value"])
                        if not isinstance(sample, dict) or set(sample) != set(METRICS.values()):
                            raise ValueError("Invalid counter snapshot")
                        if any(type(v) is not int or v < 0 for v in sample.values()):
                            raise ValueError("Invalid counter value")
                        if sample["input"] != sum(
                            sample[k] for k in ("clean", "duplicates", "quarantine")
                        ):
                            raise ValueError("Incoherent counter snapshot")
                    except (ValueError, TypeError, KeyError):
                        metrics_available = False
                        continue
                    for key, value in sample.items():
                        counts[key] = counts.get(key, 0) + value
        if not metrics_available:
            counts = {}  # Never publish a partial sum as a complete snapshot.
        try:
            checkpoint = self.get("/jobs/" + job["jid"] + "/checkpoints")
        except requests.RequestException:
            checkpoint = {}
        latest = checkpoint.get("latest", {}).get("completed") or {}
        payload = {
            "jobId": job["jid"],
            "engineState": detail.get("state", job["state"]),
            "attemptKey": attempt,
            "attemptStartedAt": attempt_started,
            "tasksReady": attempt is not None,
            "executionReady": (
                detail.get("state", job["state"]) == "RUNNING"
                and attempt is not None
                and bool(counts)
                and (latest.get("latest_ack_timestamp") or 0) >= attempt_started
            ),
            "counts": counts,
            "completedCheckpoints": checkpoint.get("counts", {}).get("completed", 0),
            "lastCheckpointId": latest.get("id"),
            "lastCheckpointAt": latest.get("latest_ack_timestamp"),
        }
        store.observe_flink(self.lineage, payload, counts, errors)

    def emqx(self, store: Store) -> None:
        rows = store.rows("SELECT payload,received_at FROM emqx_snapshot WHERE id=1")
        if (
            not rows
            or (datetime.now(UTC).replace(tzinfo=None) - rows[0]["received_at"]).total_seconds()
            > 90
        ):
            return
        payload = validate_bridge(json.loads(rows[0]["payload"]))
        state = "ABORT" if payload["status"] == "stopped" else "RUNNING"
        store.observe(
            self.lineage,
            "emqx",
            payload["instanceKey"],
            state,
            payload,
            {"input": payload["matched"], "kafka": payload["success"]},
        )
