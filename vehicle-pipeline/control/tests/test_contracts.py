import json
from pathlib import Path
from uuid import uuid4

import jsonschema
import pytest

from vehicle_control.config import Config
from vehicle_control.lineage import Lineage
from vehicle_control.runtime import validate_bridge


@pytest.fixture
def config():
    return Config("localhost", "test", "DB_SECRET_SENTINEL", "INGEST_SECRET_SENTINEL", "bridge" * 8)


def test_sdk_events_validate_and_connect_mqtt_kafka_flink_spark(config):
    schema_path = (
        Path(__file__).resolve().parents[3] / "data-pipeline/tests/fixtures/OpenLineage-2-0-2.json"
    )
    validator = jsonschema.Draft202012Validator(json.loads(schema_path.read_text()))
    lineage = Lineage(config)
    events = {}
    for component in ("emqx", "flink"):
        identity = str(uuid4())
        counts = {"input": 10, "kafka": 10, "clean": 8, "anomalies": 2, "quarantine": 1}
        payloads = lineage.catalog(component) + [
            lineage.event(component, identity, state, counts)
            for state in ("START", "RUNNING", "COMPLETE")
        ]
        for payload in payloads:
            event = json.loads(payload)
            validator.validate(event)
            assert "SECRET_SENTINEL" not in payload
            assert "rawVehiclePayload" not in payload
        events[component] = json.loads(payloads[-1])
    source = events["emqx"]["outputs"][0]
    target = events["flink"]["inputs"][0]
    assert (source["namespace"], source["name"]) == (target["namespace"], target["name"])
    clean = events["flink"]["outputs"][0]
    assert (clean["namespace"], clean["name"]) == ("s3://vehicle-lake", "clean")
    assert events["flink"]["job"]["facets"]["jobType"]["integration"] == "FLINK"


def test_bridge_boundary_rejects_false_counts_and_drops_untrusted_metadata():
    data = {
        "version": 1,
        "instanceKey": "instance-1",
        "matched": 10,
        "success": 9,
        "failed": 0,
        "dropped": 0,
        "queuing": 1,
        "status": "connected",
        "password": "hidden",
    }
    assert "password" not in validate_bridge(data)
    for wrong in (-1, True, 1.2, "4"):
        with pytest.raises(ValueError):
            validate_bridge({**data, "success": wrong})
    with pytest.raises(ValueError):
        validate_bridge({**data, "status": "pretend-success"})


def test_only_configured_origins_are_accepted_and_credentials_are_redacted(config):
    assert "SECRET_SENTINEL" not in repr(config)
    with pytest.raises(ValueError):
        Config("localhost", "test", "secret", "token", "x" * 48, endpoint="http://example.test")
    with pytest.raises(ValueError):
        Config(
            "localhost",
            "test",
            "secret",
            "token",
            "x" * 48,
            flink_url="http://user:pass@example.test",
        )


@pytest.mark.parametrize("inconsistent", [False, True])
def test_flink_uses_one_atomic_subtask_snapshot(config, inconsistent):
    from vehicle_control.runtime import RuntimeReader

    reader = RuntimeReader(config)
    sample = {"input": 10, "clean": 8, "duplicates": 1, "quarantine": 1, "anomalies": 2}
    if inconsistent:
        sample["clean"] = 12

    def get(path):
        if path == "/jobs/overview":
            return {
                "jobs": [
                    {
                        "name": "vehicle_clean_and_detect",
                        "jid": "real-job",
                        "start-time": 1793072000000,
                        "state": "RUNNING",
                    }
                ]
            }
        if path == "/jobs/real-job":
            return {"vertices": [{"id": "operator", "parallelism": 1}]}
        if "/exceptions?" in path:
            return {}
        if path.endswith("/vertices/operator"):
            return {}
        if path.endswith("/checkpoints"):
            return {"counts": {"completed": 3}, "latest": {}}
        assert "/subtasks/0/metrics" in path
        if "?get=" not in path:
            return [{"id": "operator.vehicle.counts"}, {"id": "operator.vehicle.inputCount"}]
        assert path.endswith("?get=operator.vehicle.counts")
        return [{"id": "operator.vehicle.counts", "value": json.dumps(sample)}]

    reader.get = get
    observed = []

    class FakeStore:
        def observe_flink(self, *args, **kwargs):
            observed.append(args[2])

    reader.flink(FakeStore())
    assert observed == ([{}] if inconsistent else [sample])
