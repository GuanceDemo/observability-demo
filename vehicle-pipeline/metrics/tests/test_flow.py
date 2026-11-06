import pytest

from vehicle_metrics.flow import FlowProjection
from vehicle_metrics.points import encode, point


def values(points):
    return {p["tags"]["target"]: p["fields"]["value"] for p in points}


def android(projection, t, generated, acknowledged, dropped=0, pending=None):
    pending = generated - acknowledged - dropped if pending is None else pending
    p = point(
        "android",
        dict(generated=generated, acknowledged=acknowledged, dropped=dropped, pending=pending),
        t,
    )
    return projection.build([p], t)


def test_android_offline_60_new_plus_35_opening_goes_to_95_pending():
    projection = FlowProjection("android")
    for t in range(0, 61, 10):
        result = android(projection, t, 100 + t, 65)
    edges = {(p["tags"]["source"], p["tags"]["target"]): p["fields"]["value"] for p in result}
    assert edges["近1分钟新生成", "Android"] == 60
    assert edges["Android 期初积压", "Android"] == 35
    assert edges["Android", "Android 本地积压"] == 95
    assert edges["Android", "EMQX"] == 0
    assert all(p["fields"]["available"] == 1 for p in result)


def test_android_recovery_can_forward_155_without_inventing_new_input():
    projection = FlowProjection("android")
    for t in range(0, 61, 10):
        result = android(projection, t, 100 + t, 5 + 155 * t / 60)
    edges = {(p["tags"]["source"], p["tags"]["target"]): p["fields"]["value"] for p in result}
    assert edges["近1分钟新生成", "Android"] == 60
    assert edges["Android 期初积压", "Android"] == 95
    assert edges["Android", "EMQX"] == 155
    assert edges["Android", "Android 本地积压"] == 0


def test_android_drop_and_diagnostic_read_race_keep_counters_conserved():
    projection = FlowProjection("android")
    for t in range(0, 61, 10):
        result = android(projection, t, 100 + t, 65 + t / 2, t / 12, pending=36 + t * 5 / 12)
    edges = values(result)
    assert edges["EMQX"] == 30
    assert edges["Android 丢弃"] == 5
    assert edges["Android 本地积压"] == 60
    assert sum(p["fields"]["value"] for p in result if p["tags"]["level"] == "0") == 95


def test_unknown_reset_gap_and_missing_drop_do_not_leave_old_branch():
    for fault in ("failure", "reset", "gap", "missing"):
        projection = FlowProjection("android")
        for t in range(0, 61, 10):
            android(projection, t, 100 + t, 65)
        if fault == "failure":
            result = projection.build([], 70)
        elif fault == "reset":
            result = android(projection, 70, 1, 0)
        elif fault == "gap":
            result = android(projection, 100, 200, 65)
        else:
            result = projection.build(
                [point("android", dict(generated=170, acknowledged=65, pending=105), 70)], 70
            )
        assert all(p["fields"]["value"] == -1 and p["fields"]["available"] == 0 for p in result)
        assert b"value=-1i" in encode(result)


def test_emqx_all_terminal_outcomes_and_native_queue_reconcile():
    projection = FlowProjection("emqx")
    for t in range(0, 61, 10):
        p = point(
            "emqx",
            dict(
                matched=100 + t,
                success=60 + t / 2,
                failed=2 + t / 10,
                dropped=3 + t / 20,
                late_reply=5 + t / 20,
                queuing=25 + t * 0.3,
                inflight=5,
            ),
            t,
        )
        result = projection.build([p], t)
    v = values(result)
    assert v["EMQX"] == 30
    assert v["Kafka"] == 30
    assert v["EMQX 转发积压"] == 48
    assert v["EMQX 投递失败"] == 6
    assert v["EMQX 丢弃"] == 3
    assert v["EMQX 迟到响应"] == 3


def test_kafka_partition_reset_cannot_hide_in_aggregate_progress():
    projection = FlowProjection("kafka")
    for t in range(0, 61, 10):
        points = [
            point(
                "kafka",
                dict(end_offset=100 + t, committed_offset=90 + t / 2, committed_lag=10 + t / 2),
                t,
                partition=str(i),
            )
            for i in range(2)
        ]
        result = projection.build(points, t)
    v = values(result)
    assert v["Kafka"] == 20
    assert v["Flink"] == 60
    assert v["Kafka 当前未提交"] == 80
    points[0]["fields"].update(end_offset=50, committed_offset=40, committed_lag=10)
    for p in points:
        p["time"] = 70 * 10**9
    assert all(p["fields"]["value"] == -1 for p in projection.build(points, 70))


def test_flink_splits_clean_quarantine_and_duplicates_without_anomaly_double_count():
    projection = FlowProjection("flink")
    for t in range(0, 61, 10):
        p = point(
            "flink",
            dict(
                input=100 + t,
                clean=80 + t * 0.8,
                quarantine=10 + t * 0.1,
                duplicates=10 + t * 0.1,
                anomalies=5 + t / 2,
            ),
            t + 5,
        )
        p["observed_at"] = t
        result = projection.build([p], t + 5)
    assert values(result) == {"Parquet 清洗写入": 48, "Parquet 隔离写入": 6, "Flink 去重丢弃": 6}
    assert all(p["fields"]["updated_at_seconds"] == 60 for p in result)


def test_negative_sentinel_stays_restricted_to_presentation_measurements():
    p = point("android", dict(pending=0), 1)
    p["fields"]["pending"] = -1
    with pytest.raises(ValueError):
        encode([p])
