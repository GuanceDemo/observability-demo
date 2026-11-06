import hmac
import json
import signal
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from mall_pipeline.transport import DeliveryError, HttpSink

from .config import Config
from .runtime import RuntimeReader, validate_bridge
from .store import Store, encode


def log(event: str, **fields: Any) -> None:
    print(json.dumps({"event": event, "service": "vehicle-pipeline-control", **fields}), flush=True)


def deliver(store: Store, sink: HttpSink) -> None:
    # Only one replica owns delivery; GET_LOCK also protects accidental overlap during rollout.
    if store.rows("SELECT GET_LOCK('vehicle-lineage-delivery',0) AS acquired")[0]["acquired"] != 1:
        return
    try:
        for event in store.rows(
            "SELECT id,payload FROM lineage_outbox WHERE delivered_at IS NULL ORDER BY id LIMIT 100"
        ):
            try:
                sink.send(event["payload"])
            except DeliveryError as error:
                store.execute(
                    "UPDATE lineage_outbox SET attempts=attempts+1,last_error=%s WHERE id=%s",
                    (str(error), event["id"]),
                )
                store.db.commit()
                log("lineage_delivery_pending", code=str(error))
                break
            store.execute(
                "UPDATE lineage_outbox SET "
                "delivered_at=UTC_TIMESTAMP(3),attempts=attempts+1,last_error=NULL WHERE id=%s",
                (event["id"],),
            )
            store.db.commit()
        cleanup(store)
    finally:
        store.rows("SELECT RELEASE_LOCK('vehicle-lineage-delivery')")


def cleanup(store: Store) -> None:
    # End the delivery read snapshot before configuring only this transaction.
    # REPEATABLE READ range/gap locks can deadlock a new Spark run that owns its
    # pipeline_runs row and is about to insert the lineage catalog into outbox.
    # Report GETs retain their independent REPEATABLE READ batch snapshot.
    store.db.commit()
    store.execute("SET TRANSACTION ISOLATION LEVEL READ COMMITTED")
    try:
        store.execute(
            "DELETE FROM lineage_outbox WHERE delivered_at<UTC_TIMESTAMP()-INTERVAL 7 DAY"
        )
        store.execute(
            "DELETE FROM pipeline_runs WHERE finished_at<UTC_TIMESTAMP()-INTERVAL 7 DAY AND "
            "run_id NOT IN (SELECT run_id FROM lineage_outbox)"
        )
        store.execute(
            "DELETE FROM report_batches WHERE generated_at<UTC_TIMESTAMP()-INTERVAL 7 DAY "
            "AND run_id NOT IN (SELECT DISTINCT run_id FROM vehicle_summary_5m)"
        )
        store.db.commit()
    except Exception:
        store.db.rollback()
        raise


def handler(config: Config) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args: Any) -> None:
            pass

        def send_json(self, status: int, body: Any) -> None:
            payload = json.dumps(body, default=encode, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self) -> None:
            if self.path not in {"/healthz", "/api/report"}:
                self.send_json(404, {"error": "NOT_FOUND"})
                return
            try:
                with Store(config, read_only=True) as store:
                    if self.path == "/healthz":
                        store.rows("SELECT 1")
                        self.send_json(200, {"status": "ok", "version": "0.1.0"})
                    else:
                        self.send_json(200, store.report())
            except Exception:
                self.send_json(503, {"error": "REPORT_UNAVAILABLE"})

        def do_POST(self) -> None:
            if self.path != "/internal/emqx":
                self.send_json(404, {"error": "NOT_FOUND"})
                return
            if not hmac.compare_digest(
                self.headers.get("Authorization", ""), "Bearer " + config.bridge_token
            ):
                self.send_json(401, {"error": "UNAUTHORIZED"})
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 1 <= size <= 16384:
                    raise ValueError("length")
                data = validate_bridge(json.loads(self.rfile.read(size)))
                with Store(config) as store:
                    store.execute(
                        "INSERT INTO emqx_snapshot VALUES(1,UTC_TIMESTAMP(3),%s) ON "
                        "DUPLICATE KEY UPDATE "
                        "received_at=VALUES(received_at),payload=VALUES(payload)",
                        (json.dumps(data),),
                    )
                    store.db.commit()
                self.send_json(200, {"accepted": True})
            except (ValueError, TypeError):
                self.send_json(400, {"error": "INVALID_SNAPSHOT"})
            except Exception:
                self.send_json(503, {"error": "STORE_UNAVAILABLE"})

    return Handler


def main() -> None:
    config = Config.from_env()
    stopped = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stopped.set())
    signal.signal(signal.SIGINT, lambda *_: stopped.set())
    server = ThreadingHTTPServer(("0.0.0.0", 8080), handler(config))
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    runtime, sink = RuntimeReader(config), HttpSink(config.transport_config())
    log("control_started", version="0.1.0")
    try:
        while not stopped.is_set():
            try:
                with Store(config) as store:
                    runtime.emqx(store)
                    try:
                        runtime.flink(store)
                    except Exception as error:
                        store.db.rollback()
                        log("flink_observation_unavailable", code=type(error).__name__)
                    deliver(store, sink)
            except Exception as error:
                log("control_iteration_failed", code=type(error).__name__)
            stopped.wait(20)
    finally:
        server.shutdown()
        server.server_close()
