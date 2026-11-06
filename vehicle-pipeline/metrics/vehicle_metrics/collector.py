import json
import os
import signal
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

import boto3
import pymysql
import requests
from botocore.config import Config as BotoConfig
from prometheus_client.parser import text_string_to_metric_families

from .flow import FlowProjection
from .points import number, point, send, validate_workspace
from .presentation import StageProjection

SHANGHAI = timezone(timedelta(hours=8))


def epoch(value):
    return value.replace(tzinfo=UTC).timestamp()


def emqx_points(action, metrics, rule, now):
    fields = {
        key: number(metrics[key])
        for key in ("matched", "success", "failed", "dropped", "queuing", "inflight", "late_reply")
    }
    fields["rule_matched"] = number(rule["matched"])
    status = action["status"]
    if status not in {"connected", "connecting", "disconnected", "stopped"}:
        raise ValueError("unknown_connection_state")
    fields["connected"] = int(status == "connected" and action["enable"])
    return [
        point(
            "emqx",
            fields,
            now,
            component_cluster="vehicle-emqx",
            action="kafka_producer:vehicle_telemetry",
            rule="vehicle_to_kafka",
        )
    ]


def flink_points(row, now):
    age = now - epoch(row["last_seen_at"])
    if not 0 <= age <= 60:
        raise ValueError("flink_snapshot_stale")
    data = json.loads(row["payload"])
    fields = {
        key: number(data["counts"][key])
        for key in ("input", "clean", "duplicates", "quarantine", "anomalies")
    }
    if fields["input"] != fields["clean"] + fields["duplicates"] + fields["quarantine"]:
        raise ValueError("flink_counters_incoherent")
    fields.update(
        running=int(data["engineState"] == "RUNNING"),
        completed_checkpoints=number(data["completedCheckpoints"]),
        checkpoint_age_seconds=max(0.0, now - number(data["lastCheckpointAt"]) / 1000),
        observation_age_seconds=age,
    )
    result = point(
        "flink",
        fields,
        now,
        job="vehicle_clean_and_detect",
        scope="checkpoint_restored_cumulative",
    )
    result["observed_at"] = epoch(row["last_seen_at"])
    result["identity"] = data.get("attemptKey") or data.get("jobId", "flink")
    return [result]


def spark_points(batch, latest, five_rows, daily_rows, now):
    fields = {key: number(batch[key]) for key in ("input_rows", "unique_rows", "object_count")}
    fields.update(
        five_minute_rows=number(five_rows),
        daily_rows=number(daily_rows),
        source_age_seconds=max(0.0, now - number(batch["last_event_ms"]) / 1000),
        report_age_seconds=max(0.0, now - epoch(batch["generated_at"])),
        source_event_time_seconds=batch["last_event_ms"] / 1000,
        batch_completed_time_seconds=epoch(batch["generated_at"]),
    )
    points = [point("spark", fields, now, job="vehicle_summary", scope="last_successful_batch")]
    state = latest["state"]
    if state not in {"START", "RUNNING", "COMPLETE", "FAIL", "ABORT"}:
        raise ValueError("unknown_run_state")
    run = {
        "running": int(state in {"START", "RUNNING"}),
        "failed": int(state == "FAIL"),
        "aborted": int(state == "ABORT"),
        "complete": int(state == "COMPLETE"),
    }
    if latest["finished_at"]:
        run["duration_seconds"] = max(
            0.0, epoch(latest["finished_at"]) - epoch(latest["started_at"])
        )
    points.append(point("spark_run", run, now, job="vehicle_summary", scope="latest_run"))
    return points


def kafka_points(text, now, topic, group):
    allowed = {
        "kafka_topic_partition_current_offset": "end_offset",
        "kafka_topic_partition_oldest_offset": "oldest_offset",
        "kafka_consumergroup_current_offset": "committed_offset",
        "kafka_consumergroup_lag": "committed_lag",
    }
    partitions = {}
    for family in text_string_to_metric_families(text):
        for sample in family.samples:
            if sample.name not in allowed or sample.labels.get("topic") != topic:
                continue
            if (
                sample.name.startswith("kafka_consumergroup_")
                and sample.labels.get("consumergroup") != group
            ):
                continue
            value = number(sample.value)
            partitions.setdefault(sample.labels["partition"], {})[allowed[sample.name]] = value
    if not partitions or any(
        set(fields) != set(allowed.values()) for fields in partitions.values()
    ):
        raise ValueError("kafka_offsets_incomplete")
    return [
        point(
            "kafka",
            fields,
            now,
            component_cluster="vehicle-kafka",
            topic=topic,
            consumer_group=group,
            partition=partition,
        )
        for partition, fields in partitions.items()
    ]


def lake_points(client, now):
    deadline = time.monotonic() + 20
    start = datetime.fromtimestamp(now, SHANGHAI).replace(hour=0, minute=0, second=0, microsecond=0)
    points = []
    for dataset in ("clean", "anomalies", "quarantine"):
        files, size, latest, scanned = 0, 0, None, 0
        hour = start.astimezone(UTC)
        while hour.timestamp() <= now:
            pages = client.get_paginator("list_objects_v2").paginate(
                Bucket="vehicle-lake",
                Prefix=dataset + "/" + hour.strftime("%Y-%m-%d/%H/"),
                PaginationConfig={"PageSize": 1000},
            )
            for page in pages:
                if time.monotonic() > deadline:
                    raise TimeoutError("lake_snapshot_deadline")
                for obj in page.get("Contents", []):
                    scanned += 1
                    if scanned > 12000:
                        raise ValueError("lake_snapshot_limit")
                    name = obj["Key"].rsplit("/", 1)[-1]
                    modified = obj["LastModified"].timestamp()
                    if not name.startswith("part-") or ".inprogress" in name or modified > now - 5:
                        continue
                    files += 1
                    size += number(obj["Size"])
                    latest = max(latest or modified, modified)
            hour += timedelta(hours=1)
        fields = {"committed_files": files, "committed_bytes": size}
        if latest is not None:
            fields["latest_file_age_seconds"] = max(0.0, now - latest)
        points.append(
            point(
                "parquet",
                fields,
                now,
                dataset=dataset,
                scope="today_committed_files",
                bucket="vehicle-lake",
            )
        )
    return points


class Collector:
    def __init__(self):
        validate_workspace(os.environ.get("GUANCE_WORKSPACE"))
        self.topic = os.getenv("KAFKA_TOPIC", "vehicle.telemetry.raw.v1")
        self.group = os.getenv("KAFKA_GROUP", "vehicle-flink-clean-v1")
        self.s3 = boto3.client(
            "s3",
            endpoint_url=os.environ["S3_ENDPOINT"],
            aws_access_key_id=os.environ["S3_ACCESS_KEY"],
            aws_secret_access_key=os.environ["S3_SECRET_KEY"],
            region_name="us-east-1",
            config=BotoConfig(
                connect_timeout=3,
                read_timeout=5,
                retries={"total_max_attempts": 2},
                s3={"addressing_style": "path"},
            ),
        )

    def db(self):
        return pymysql.connect(
            host=os.environ["MYSQL_HOST"],
            user="vehicle_reader",
            password=os.environ["MYSQL_PASSWORD"],
            database="vehicle_analytics",
            connect_timeout=3,
            read_timeout=5,
            write_timeout=5,
            cursorclass=pymysql.cursors.DictCursor,
        )

    def get(self, url, auth=None):
        response = requests.get(url, auth=auth, timeout=(3, 6))
        response.raise_for_status()
        return response

    def emqx(self, now):
        origin = os.environ["EMQX_URL"].rstrip("/") + "/api/v5/"
        auth = (os.environ["EMQX_API_KEY"], os.environ["EMQX_API_SECRET"])
        action = "actions/" + quote("kafka_producer:vehicle_telemetry", safe="")
        return emqx_points(
            self.get(origin + action, auth).json(),
            self.get(origin + action + "/metrics", auth).json()["metrics"],
            self.get(origin + "rules/vehicle_to_kafka/metrics", auth).json()["metrics"],
            now,
        )

    def flink(self, now):
        with self.db() as db, db.cursor() as cur:
            cur.execute("SELECT last_seen_at,payload FROM component_state WHERE component='flink'")
            return flink_points(cur.fetchone(), now)

    def spark(self, now):
        with self.db() as db, db.cursor() as cur:
            cur.execute("SELECT * FROM report_batches ORDER BY generated_at DESC LIMIT 1")
            batch = cur.fetchone()
            cur.execute(
                "SELECT * FROM pipeline_runs WHERE job_name='vehicle_summary' "
                "ORDER BY started_at DESC LIMIT 1"
            )
            latest = cur.fetchone()
            rows = []
            for table in ("vehicle_summary_5m", "vehicle_daily_summary"):
                cur.execute(
                    "SELECT COUNT(*) AS n FROM " + table + " WHERE run_id=%s", (batch["run_id"],)
                )
                rows.append(cur.fetchone()["n"])
            return spark_points(batch, latest, *rows, now)

    def kafka(self, now):
        return kafka_points(
            self.get(os.environ["KAFKA_EXPORTER_URL"]).text, now, self.topic, self.group
        )

    def parquet(self, now):
        return lake_points(self.s3, now)


def collect_one(name, collect, now):
    try:
        points = collect(now)
        points.append(point("collector", {"up": 1}, now, source=name))
        return points
    except Exception as error:
        # Only the exception class is logged; request URLs/passwords/data stay private.
        print(
            json.dumps(
                {"event": "metric_source_unavailable", "source": name, "code": type(error).__name__}
            ),
            flush=True,
        )
        return [point("collector", {"up": 0}, now, source=name)]


def main():
    collector = Collector()
    stop = threading.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: stop.set())

    def worker(name):
        interval = 60 if name == "parquet" else 10
        projection = StageProjection(name)
        flow = FlowProjection(name)
        while not stop.is_set():
            now = time.time()
            started = time.monotonic()
            points = collect_one(name, getattr(collector, name), now)
            points.append(projection.build(points, now))
            points.extend(flow.build(points, now))
            try:
                send(os.environ["METRIC_WRITE_URL"], points)
                Path("/tmp/metrics-ready").touch()
            except Exception as error:
                print(
                    json.dumps({"event": "metric_delivery_failed", "code": type(error).__name__}),
                    flush=True,
                )
            stop.wait(max(1.0, interval - (time.monotonic() - started)))

    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = [
            pool.submit(worker, name) for name in ("emqx", "kafka", "flink", "spark", "parquet")
        ]
        for future in futures:
            future.result()


if __name__ == "__main__":
    main()
