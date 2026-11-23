"""Read-only, loopback-only correlation cache for the vehicle trace receiver.

Run IDs are attached only inside an observed execution interval. A current Run
is not evidence about processing after its latest observation or another attempt.
"""

import json
import os
import threading
import time
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit
from uuid import UUID

SERVICES = {
    "vehicle-android-producer": ("android", None),
    "emqx": ("emqx", "emqx_telemetry_to_kafka"),
    "vehicle-flink-consumer": ("flink", "vehicle_clean_and_detect"),
}


def millis(value):
    if isinstance(value, datetime):
        return int(value.replace(tzinfo=UTC).timestamp() * 1000)
    return int(value)


class ContextCache:
    def __init__(self, cluster, clock=time.monotonic):
        if not cluster:
            raise ValueError("cluster_required")
        self.cluster, self.clock = cluster, clock
        self.rows, self.loaded_at = (), None
        self.lock = threading.Lock()

    def replace(self, rows):
        # Convert once in the background; HTTP requests never access MySQL.
        converted = []
        for row in rows:
            run_id = str(UUID(row["run_id"]))
            start = millis(row["started_at"])
            observed = millis(row["updated_at"])
            end = millis(row["finished_at"]) if row["finished_at"] else observed
            if start <= end <= observed:
                converted.append((row["job_name"], run_id, start, end))
        with self.lock:
            self.rows, self.loaded_at = tuple(converted), self.clock()

    def context(self, service, start_us):
        component, job = SERVICES[service]
        result = {
            "pipeline": "vehicle-telemetry",
            "cluster": self.cluster,
            "topic": os.getenv("KAFKA_TOPIC", "vehicle.telemetry.raw.v1"),
            "consumer_group": os.getenv("KAFKA_GROUP", "vehicle-flink-clean-v1"),
            "component": component,
            "run_correlation": "not_applicable" if job is None else "unknown",
        }
        if job is None:
            return result
        result.update(job_namespace="vehicle-demo.telemetry", job_name=job)
        at = start_us // 1000
        with self.lock:
            if self.loaded_at is None or self.clock() - self.loaded_at > 30:
                return result
            matches = [r[1] for r in self.rows if r[0] == job and r[2] <= at < r[3]]
        if len(matches) == 1:
            result.update(run_id=matches[0], run_correlation="observed_interval")
        return result


def refresh(cache, stopped):
    import pymysql

    while not stopped.is_set():
        try:
            with (
                pymysql.connect(
                    host=os.environ["MYSQL_HOST"],
                    user="vehicle_reader",
                    password=os.environ["MYSQL_PASSWORD"],
                    database="vehicle_analytics",
                    cursorclass=pymysql.cursors.DictCursor,
                    autocommit=True,
                    connect_timeout=2,
                    read_timeout=2,
                    write_timeout=2,
                    init_command="SET time_zone='+00:00'",
                ) as db,
                db.cursor() as cursor,
            ):
                cursor.execute(
                    "SELECT job_name,run_id,started_at,updated_at,finished_at FROM pipeline_runs "
                    "WHERE job_name IN ('emqx_telemetry_to_kafka','vehicle_clean_and_detect') "
                    "AND (finished_at IS NULL OR finished_at>UTC_TIMESTAMP()-INTERVAL 1 DAY) "
                    "ORDER BY started_at DESC LIMIT 256"
                )
                cache.replace(cursor.fetchall())
        except (pymysql.MySQLError, OSError, ValueError, TypeError, KeyError) as error:
            # Never expose endpoints, SQL exception messages or credentials.
            print(
                json.dumps(
                    {
                        "event": "apm_context_refresh_failed",
                        "error_type": type(error).__name__,
                    }
                ),
                flush=True,
            )
        stopped.wait(5)


def handler(cache):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            path = urlsplit(self.path)
            status, result = 200, {"status": "ok"}
            if path.path == "/context":
                try:
                    args = parse_qs(path.query, strict_parsing=True)
                    if set(args) != {"service", "start"} or any(
                        len(v) != 1 for v in args.values()
                    ):
                        raise ValueError("invalid_query")
                    start = int(args["start"][0])
                    if not 10**15 <= start < 10**16:
                        raise ValueError("start_requires_microseconds")
                    result = cache.context(args["service"][0], start)
                except (KeyError, ValueError):
                    status, result = 400, {"error": "INVALID_CONTEXT"}
            elif path.path != "/healthz":
                status, result = 404, {"error": "NOT_FOUND"}
            body = json.dumps(result).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

    return Handler


if __name__ == "__main__":
    cache = ContextCache(os.environ["VEHICLE_CLUSTER"])
    stopped = threading.Event()
    threading.Thread(target=refresh, args=(cache, stopped), daemon=True).start()
    server = ThreadingHTTPServer(("127.0.0.1", 18092), handler(cache))
    server.daemon_threads = True
    server.serve_forever()
