from vehicle_metrics.points import encode, point
from vehicle_metrics.presentation import MinuteWindow, StageProjection


def test_exact_minute_with_irregular_samples_and_no_extrapolation():
    window = MinuteWindow()
    for t in (0, 11, 21, 31, 41, 51):
        assert window.observe(t, (t * 2, t), "one") == (-1, -1)
    assert window.observe(61, (122, 61), "one") == (120, 60)
    assert window.observe(61, (122, 61), "one") == (120, 60)


def test_reset_gap_identity_change_and_backward_clock_invalidate():
    for timestamp, counts, identity in [
        (70, (1, 1), "a"),
        (100, (100, 100), "a"),
        (70, (70, 70), "b"),
        (50, (50, 50), "a"),
    ]:
        window = MinuteWindow()
        for t in range(0, 61, 10):
            window.observe(t, (t, t), "a")
        assert window.observe(timestamp, counts, identity) == (-1, -1)


def test_failure_overwrites_known_values_without_erasing_last_update():
    projection = StageProjection("emqx")
    for t in range(100, 161, 10):
        p = point("emqx", dict(matched=t, success=t - 10, queuing=8, inflight=2), t)
        result = projection.build([p], t)
    assert result["fields"]["input_1m"] == 60
    assert result["fields"]["backlog"] == 10
    failed = projection.build([], 170)
    assert failed["fields"]["available"] == 0
    assert failed["fields"]["backlog"] == -1
    assert failed["fields"]["input_1m"] == -1
    assert failed["fields"]["updated_at_seconds"] == 160
    assert "backlog=-1i" in encode([failed]).decode()
    assert projection.build([p], 180)["fields"]["input_1m"] == -1


def test_flink_uses_source_time_and_excludes_anomaly_duplicate_outputs():
    projection = StageProjection("flink")
    for t in range(100, 161, 10):
        p = point(
            "flink", dict(input=t, clean=t - 10, quarantine=5, anomalies=10, duplicates=5), t + 9
        )
        p["observed_at"] = t
        result = projection.build([p], t + 9)
    assert result["fields"]["updated_at_seconds"] == 160
    assert result["fields"]["output_1m"] == 60
    assert result["fields"]["backlog"] == -1


def test_kafka_sum_partition_deltas_and_invalidate_hidden_partition_reset():
    projection = StageProjection("kafka")
    for t in range(100, 161, 10):
        points = [
            point(
                "kafka",
                dict(end_offset=t * n, committed_offset=t * n - 5, committed_lag=5),
                t,
                partition=str(n),
            )
            for n in (1, 2)
        ]
        result = projection.build(points, t)
    assert result["fields"]["input_1m"] == 180
    assert result["fields"]["output_1m"] == 180
    assert result["fields"]["backlog"] == 10
    points[0]["fields"]["end_offset"] = 0
    points[1]["fields"]["end_offset"] = 600
    for p in points:
        p["time"] = 170 * 10**9
    assert projection.build(points, 170)["fields"]["input_1m"] == -1


def test_spark_output_counts_report_rows_and_common_correlation_labels():
    projection = StageProjection("spark")
    p = point(
        "spark",
        dict(
            input_rows=1000,
            unique_rows=990,
            five_minute_rows=20,
            daily_rows=1,
            source_age_seconds=75,
            batch_completed_time_seconds=120,
        ),
        150,
    )
    result = projection.build([p], 150)
    assert result["fields"]["read_rows"] == 1000
    assert result["fields"]["output_rows"] == 21
    assert result["fields"]["data_delay_seconds"] == 75
    assert result["fields"]["report_updated_at_seconds"] == 120
    assert projection.build([], 160)["fields"]["read_rows"] == -1
    for key in ("pipeline", "cluster", "topic", "consumer_group"):
        assert result["tags"][key] == point("android", {"pending": 1}, 150)["tags"][key]
