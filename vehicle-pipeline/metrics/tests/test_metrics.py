import json
from datetime import UTC, datetime

import pytest

from vehicle_metrics.collector import (
    collect_one,
    emqx_points,
    flink_points,
    kafka_points,
    lake_points,
    spark_points,
)
from vehicle_metrics.points import android_sample, encode, point, validate_workspace


def test_emqx_uses_action_counters_not_rule_difference():
    fields = dict(
        matched=100, success=70, failed=2, dropped=3, queuing=20, inflight=5, late_reply=0
    )
    p = emqx_points({"status": "disconnected", "enable": True}, fields, {"matched": 99}, 100)[0]
    assert p["fields"]["queuing"] == 20
    assert p["fields"]["inflight"] == 5
    assert p["fields"]["connected"] == 0
    assert p["fields"]["rule_matched"] == 99
    with pytest.raises(KeyError):
        emqx_points({"status": "connected", "enable": True}, {}, {}, 100)


def test_flink_staleness_conservation_and_anomaly_subset():
    data = {
        "counts": {"input": 10, "clean": 7, "duplicates": 2, "quarantine": 1, "anomalies": 3},
        "engineState": "RUNNING",
        "completedCheckpoints": 3,
        "lastCheckpointAt": 90000,
    }
    row = {"last_seen_at": datetime.fromtimestamp(95, UTC), "payload": json.dumps(data)}
    assert flink_points(row, 100)[0]["fields"]["clean"] == 7
    with pytest.raises(ValueError, match="stale"):
        flink_points(row, 160)
    data["counts"]["input"] = 11
    row["payload"] = json.dumps(data)
    with pytest.raises(ValueError, match="incoherent"):
        flink_points(row, 100)


def test_kafka_scope_and_unknown_committed_offset():
    text = "\n".join(
        [
            'kafka_topic_partition_current_offset{topic="raw",partition="0"} 120',
            'kafka_topic_partition_oldest_offset{topic="raw",partition="0"} 10',
            "kafka_consumergroup_current_offset"
            '{topic="raw",partition="0",consumergroup="flink"} 100',
            'kafka_consumergroup_lag{topic="raw",partition="0",consumergroup="flink"} 20',
            'kafka_consumergroup_lag_sum{topic="raw",consumergroup="flink"} 20',
            'kafka_consumergroup_lag{topic="raw",partition="0",consumergroup="other"} 80',
        ]
    )
    result = kafka_points(text, 100, "raw", "flink")
    assert len(result) == 1
    assert result[0]["fields"]["committed_lag"] == 20
    with pytest.raises(ValueError):
        kafka_points(text.replace("} 100", "} -1"), 100, "raw", "flink")


def test_failure_emits_health_without_fake_business_zero():
    def broken(_now):
        raise TimeoutError("private url password should not appear")

    result = collect_one("kafka", broken, 100)
    assert len(result) == 1
    assert result[0]["measurement"] == "vehicle_pipeline_collector"
    assert result[0]["fields"] == {"up": 0}


def test_android_source_time_freshness_and_incoherence():
    item = dict(
        version=1, event="state", at=95000, generated=100, acknowledged=95, dropped=2, pending=3
    )
    sample = android_sample("ignored\n" + json.dumps(item), 100)
    assert sample["time"] == 95000000000
    assert sample["fields"]["pending"] == 3
    with pytest.raises(ValueError, match="stale"):
        android_sample(json.dumps(item), 150)
    item["pending"] = 20
    with pytest.raises(ValueError, match="incoherent"):
        android_sample(json.dumps(item), 100)


def test_line_protocol_rejects_injection_nonfinite_and_preserves_types():
    encoded = encode([point("kafka", {"n": 1, "lag": 2.5}, 100, topic="a,b =c")]).decode()
    assert "topic=a\\,b\\ \\=c" in encoded
    assert "lag=2.5,n=1i" in encoded
    for value in (-1, float("nan"), float("inf"), True):
        with pytest.raises(ValueError):
            point("kafka", {"n": value}, 100)
    with pytest.raises(ValueError):
        encode([point("kafka", {"n": 1}, 100, topic="x\ny")])


def test_lake_only_today_finished_files_and_limit():
    now = datetime(2026, 11, 5, 0, 1, tzinfo=UTC).timestamp()
    prefixes = []

    class Paginator:
        def paginate(self, **kw):
            prefixes.append(kw["Prefix"])
            return [
                {
                    "Contents": [
                        {
                            "Key": kw["Prefix"] + "part-one",
                            "Size": 20,
                            "LastModified": datetime.fromtimestamp(now - 10, UTC),
                        },
                        {
                            "Key": kw["Prefix"] + ".part-two.inprogress",
                            "Size": 30,
                            "LastModified": datetime.fromtimestamp(now - 10, UTC),
                        },
                        {
                            "Key": kw["Prefix"] + "part-new",
                            "Size": 40,
                            "LastModified": datetime.fromtimestamp(now - 1, UTC),
                        },
                    ]
                }
            ]

    class Client:
        def get_paginator(self, _name):
            return Paginator()

    points = lake_points(Client(), now)
    assert len(prefixes) == 27
    assert prefixes[0] == "clean/2026-11-04/16/"
    assert all(p["fields"]["committed_files"] == 9 for p in points)
    assert all(p["fields"]["committed_bytes"] == 180 for p in points)


def test_failed_spark_run_keeps_distinct_successful_batch_metrics():
    batch = dict(
        input_rows=1000,
        unique_rows=999,
        object_count=10,
        last_event_ms=90000,
        generated_at=datetime.fromtimestamp(95, UTC),
    )
    failed = dict(
        state="FAIL",
        started_at=datetime.fromtimestamp(96, UTC),
        finished_at=datetime.fromtimestamp(98, UTC),
    )
    good, latest = spark_points(batch, failed, 20, 1, 100)
    assert good["fields"]["input_rows"] == 1000
    assert good["fields"]["source_age_seconds"] == 10
    assert latest["fields"]["failed"] == 1
    assert latest["fields"]["duration_seconds"] == 2
    assert good["tags"]["scope"] == "last_successful_batch"


def test_ingestion_rejects_http_200_error_and_sends_original_timestamp(monkeypatch):
    from vehicle_metrics import points

    captured = []

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            pass

        def read(self, _limit):
            return b'{"error_code":"rejected"}'

    def open_request(request, **_):
        captured.append(request)
        return Response()

    monkeypatch.setattr(points, "urlopen", open_request)
    with pytest.raises(ValueError, match="ingestion_rejected"):
        points.send("http://localhost:9529/v1/write/metric", [point("android", {"pending": 3}, 95)])
    assert captured[0].data.endswith(b" 95000000000\n")


@pytest.mark.parametrize("value", [None, "", "demo", "wksp_", "wksp_test?token=value"])
def test_workspace_must_be_explicit_and_valid(value):
    with pytest.raises(ValueError, match="invalid_workspace"):
        validate_workspace(value)


def test_workspace_accepts_configured_id():
    value = "wksp_" + "0" * 32
    assert validate_workspace(value) == value
