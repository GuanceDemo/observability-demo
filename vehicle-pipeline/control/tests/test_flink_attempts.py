import copy
import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import jsonschema
import pymysql
import pytest
import requests
from pymysql.cursors import DictCursor

from vehicle_control.config import Config
from vehicle_control.flink_evidence import attempt_identity, failures
from vehicle_control.lineage import Lineage
from vehicle_control.runtime import RuntimeReader
from vehicle_control.store import Store


def engine_error(stamp):
    return failures(
        {
            "exceptionHistory": {
                "entries": [
                    {
                        "timestamp": stamp,
                        "exceptionName": "org.apache.flink.util.FlinkExpectedException",
                        "stacktrace": "org.apache.flink.util.FlinkExpectedException: "
                        "TaskExecutor is shutting down.\n"
                        "\tat org.apache.flink.runtime.taskexecutor.TaskExecutor.onStop"
                        "(TaskExecutor.java:531)\n"
                        "password=SECRET_SENTINEL jdbc:mysql://private:3306/data row=PRIVATE_ROW",
                    }
                ]
            }
        },
        stamp,
    )[0]


def test_safe_engine_exception_and_standard_lineage_facets():
    error = engine_error(1000)
    assert error["errorCode"] == "FLINK_TASKEXECUTOR_LOST"
    assert "TaskExecutor.java:531" in error["stackTrace"]
    lineage = Lineage(Config("localhost", "test", "secret", "secret", "x" * 48))
    event = json.loads(
        lineage.event(
            "flink",
            str(uuid4()),
            "FAIL",
            error=error["errorCode"],
            error_details=error,
            metadata={
                "executionScope": "flink-attempt",
                "jobId": "real-job",
                "attemptKey": "attempt-1",
            },
        )
    )
    schema = (
        Path(__file__).resolve().parents[3] / "data-pipeline/tests/fixtures/OpenLineage-2-0-2.json"
    )
    jsonschema.Draft202012Validator(json.loads(schema.read_text())).validate(event)
    facet = event["run"]["facets"]["errorMessage"]
    assert facet["errorType"] == "org.apache.flink.util.FlinkExpectedException"
    assert facet["failureStage"] == "task-execution"
    assert "task-execution" in facet["message"]
    assert "SECRET_SENTINEL" not in json.dumps(event)
    assert "PRIVATE_ROW" not in json.dumps(event)
    assert "jdbc:" not in json.dumps(event)
    assert "retryCount" not in facet
    assert failures({"exceptionHistory": {"entries": [{"timestamp": 999999}]}}, 1000) == []


def test_root_resource_failure_and_attempt_identity():
    result = failures(
        {
            "exceptionHistory": {
                "entries": [
                    {
                        "timestamp": 20,
                        "exceptionName": "java.util.concurrent.CompletionException",
                        "stacktrace": "java.util.concurrent.CompletionException: wrapper\n"
                        "Caused by: "
                        "org.apache.flink.runtime.jobmanager.scheduler."
                        "NoResourceAvailableException: resources\n"
                        "\tat org.apache.flink.scheduler.Scheduler.run(Scheduler.java:42)",
                    }
                ]
            }
        },
        30,
    )[0]
    assert result["errorCode"] == "FLINK_RESOURCES_UNAVAILABLE"
    vertices = [
        {
            "id": "source",
            "parallelism": 1,
            "subtasks": [
                {"subtask": 0, "attempt": 13, "status": "RUNNING", "start-time": 1793696460697}
            ],
        }
    ]
    first, started = attempt_identity("engine-id", vertices)
    assert started == 1793696460697
    assert attempt_identity("engine-id", copy.deepcopy(vertices))[0] == first
    vertices[0]["subtasks"][0]["attempt"] += 1
    assert attempt_identity("engine-id", vertices)[0] != first
    vertices[0]["subtasks"][0]["status"] = "DEPLOYING"
    assert attempt_identity("engine-id", vertices) == (None, 0)
    assert attempt_identity("engine-id", []) == (None, 0)


@pytest.mark.parametrize("broken_metrics,checkpoint", [(True, 110), (False, 90), (False, 110)])
def test_exception_evidence_survives_missing_metrics_and_requires_new_checkpoint(
    broken_metrics, checkpoint
):
    reader = RuntimeReader(Config("localhost", "test", "secret", "secret", "x" * 48))

    def get(path):
        if path == "/jobs/overview":
            return {
                "jobs": [
                    {
                        "name": "vehicle_clean_and_detect",
                        "jid": "engine",
                        "state": "RUNNING",
                        "start-time": 1,
                    }
                ]
            }
        if path == "/jobs/engine":
            return {"vertices": [{"id": "v", "parallelism": 1}], "state": "RUNNING"}
        if "/exceptions?" in path:
            return {
                "exceptionHistory": {
                    "entries": [{"timestamp": 80, "exceptionName": "java.io.IOException"}]
                }
            }
        if path.endswith("/vertices/v"):
            return {
                "subtasks": [{"subtask": 0, "attempt": 2, "status": "RUNNING", "start-time": 100}]
            }
        if path.endswith("/checkpoints"):
            return {"latest": {"completed": {"id": 3, "latest_ack_timestamp": checkpoint}}}
        if broken_metrics:
            raise requests.HTTPError("Task metric unavailable while restarting")
        if "?get=" not in path:
            return [{"id": "operator.vehicle.counts"}]
        return [
            {
                "value": json.dumps(
                    {"input": 4, "clean": 3, "duplicates": 1, "quarantine": 0, "anomalies": 0}
                )
            }
        ]

    reader.get = get

    class Capture:
        def observe_flink(self, lineage, payload, counts, errors):
            assert errors[0]["errorType"] == "java.io.IOException"
            assert payload["executionReady"] == (not broken_metrics and checkpoint > 100)
            assert bool(counts) == (not broken_metrics)

    reader.flink(Capture())


@pytest.fixture
def database():
    if not os.getenv("VEHICLE_TEST_MYSQL_PORT"):
        pytest.skip("isolated MySQL not supplied")
    db = pymysql.connect(
        host="127.0.0.1",
        port=int(os.environ["VEHICLE_TEST_MYSQL_PORT"]),
        user="root",
        autocommit=False,
        cursorclass=DictCursor,
    )
    schema = "vehicle_attempt_test_" + uuid4().hex
    store = Store.__new__(Store)
    store.db = db
    store.execute(f"CREATE DATABASE {schema}")
    store.execute(f"USE {schema}")
    for sql in (Path(__file__).resolve().parents[2] / "schema.sql").read_text().split(";"):
        if sql.strip():
            store.execute(sql)
    try:
        yield store
    finally:
        db.rollback()
        store.execute(f"DROP DATABASE {schema}")
        db.close()


def setup_legacy(store):
    lineage = Lineage(Config("localhost", "test", "secret", "secret", "x" * 48))
    now = int(datetime.now(UTC).timestamp() * 1000)
    payload = {
        "jobId": "engine",
        "engineState": "RUNNING",
        "attemptKey": "engine:13",
        "attemptStartedAt": now - 30000,
        "executionReady": True,
        "counts": {"input": 10, "clean": 10},
    }
    store.observe(
        lineage,
        "flink",
        "engine",
        "RUNNING",
        payload,
        payload["counts"],
        started=datetime.now(UTC) - timedelta(hours=1),
    )
    old = store.rows("SELECT run_id FROM component_state WHERE component='flink'")[0]["run_id"]
    store.observe_flink(
        lineage, copy.deepcopy(payload), payload["counts"], [engine_error(now - 60000)]
    )
    assert store.rows("SELECT run_id FROM component_state")[0]["run_id"] == old
    assert store.rows("SELECT state FROM pipeline_runs")[0]["state"] == "RUNNING"
    cursor = json.loads(store.rows("SELECT payload FROM component_state")[0]["payload"])[
        "failureCursor"
    ]
    return lineage, old, payload, cursor


def test_real_failure_is_terminal_and_recovery_is_a_new_run(database):
    store = database
    lineage, old, payload, cursor = setup_legacy(store)
    failure = engine_error(cursor + 10)
    waiting = {
        **payload,
        "engineState": "RESTARTING",
        "executionReady": False,
        "attemptKey": None,
        "counts": {},
    }
    # REST can lose task details before exception history becomes available.
    store.observe_flink(lineage, copy.deepcopy(waiting), {}, [])
    assert json.loads(store.rows("SELECT metadata FROM pipeline_runs")[0]["metadata"])[
        "attemptKey"
    ] == "engine:13"
    store.observe_flink(lineage, copy.deepcopy(waiting), {}, [failure])
    original = store.rows("SELECT * FROM pipeline_runs WHERE run_id=%s", (old,))[0]
    assert original["state"] == "FAIL"
    assert json.loads(original["metadata"])["attemptKey"] == "engine:13"
    assert original["input_count"] == 10
    assert int(original["finished_at"].replace(tzinfo=UTC).timestamp() * 1000) == failure["atMs"]
    for engine in ("RUNNING", "RESTARTING"):
        store.observe_flink(
            lineage, {**waiting, "engineState": engine}, {}, [failure, engine_error(cursor + 20)]
        )
    assert store.rows("SELECT * FROM pipeline_runs WHERE run_id=%s", (old,))[0] == original
    assert (
        store.rows("SELECT COUNT(*) AS n FROM lineage_outbox WHERE event_key=%s", (old + ":FAIL",))[
            0
        ]["n"]
        == 1
    )
    # A new attempt cannot count as recovered without a post-attempt checkpoint.
    recovery = {**payload, "attemptKey": "engine:26", "attemptStartedAt": cursor + 30}
    store.observe_flink(
        lineage, {**recovery, "executionReady": False}, payload["counts"], [failure]
    )
    assert len(store.rows("SELECT * FROM pipeline_runs")) == 1
    store.observe_flink(lineage, copy.deepcopy(recovery), payload["counts"], [failure])
    component = store.rows("SELECT * FROM component_state")[0]
    assert component["run_id"] != old
    assert json.loads(component["payload"])["lastFailure"]["runId"] == old
    assert store.rows("SELECT * FROM pipeline_runs WHERE run_id=%s", (old,))[0] == original
    store.observe_flink(lineage, copy.deepcopy(recovery), payload["counts"], [failure])
    assert len(store.rows("SELECT * FROM pipeline_runs")) == 2
    assert (
        store.rows("SELECT state FROM pipeline_runs WHERE run_id=%s", (component["run_id"],))[0][
            "state"
        ]
        == "RUNNING"
    )


def test_outbox_and_failure_update_roll_back_together(database, monkeypatch):
    store = database
    lineage, old, payload, cursor = setup_legacy(store)
    enqueue = store.enqueue

    def broken(key, run, event):
        if key.endswith(":FAIL"):
            raise RuntimeError("isolated DB transaction interruption")
        enqueue(key, run, event)

    monkeypatch.setattr(store, "enqueue", broken)
    waiting = {**payload, "executionReady": False}
    with pytest.raises(RuntimeError):
        store.observe_flink(lineage, copy.deepcopy(waiting), {}, [engine_error(cursor + 10)])
    store.db.rollback()
    assert (
        store.rows("SELECT state FROM pipeline_runs WHERE run_id=%s", (old,))[0]["state"]
        == "RUNNING"
    )
    monkeypatch.setattr(store, "enqueue", enqueue)
    store.observe_flink(lineage, copy.deepcopy(waiting), {}, [engine_error(cursor + 10)])
    assert (
        store.rows("SELECT state FROM pipeline_runs WHERE run_id=%s", (old,))[0]["state"] == "FAIL"
    )


def test_no_exception_means_unknown_replacement_not_fake_failure(database):
    lineage, old, payload, cursor = setup_legacy(database)
    database.observe_flink(
        lineage, {**payload, "attemptKey": "engine:14", "attemptStartedAt": cursor + 10}, {}, []
    )
    assert (
        database.rows("SELECT state FROM pipeline_runs WHERE run_id=%s", (old,))[0]["state"]
        == "ABORT"
    )
    assert not database.rows("SELECT * FROM pipeline_runs WHERE state='FAIL'")


def test_actual_global_failed_state_is_evidence_even_without_exception_history(database):
    lineage, old, payload, _ = setup_legacy(database)
    database.observe_flink(
        lineage, {**payload, "engineState": "FAILED", "executionReady": False}, {}, []
    )
    assert (
        database.rows("SELECT state FROM pipeline_runs WHERE run_id=%s", (old,))[0]["state"]
        == "FAIL"
    )
    last = json.loads(database.rows("SELECT payload FROM component_state")[0]["payload"])[
        "lastFailure"
    ]
    assert last["code"] == "FLINK_JOB_FAILED"
