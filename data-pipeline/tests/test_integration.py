import json
from collections import defaultdict
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from uuid import uuid4

import pymysql
import pytest

from mall_pipeline.transport import HttpSink
from mall_pipeline.worker import Worker

pytestmark = pytest.mark.integration
NOW = datetime(2026, 10, 22, 10, tzinfo=UTC)


def snapshots(worker):
    return [
        worker.rows("SELECT * FROM demo_orders_clean ORDER BY order_id"),
        worker.rows("SELECT * FROM demo_sales_daily ORDER BY order_date"),
    ]


def business_rows(rows):
    return [{k: v for k, v in r.items() if k not in {"run_id", "processed_at"}} for r in rows]


def test_actual_sql_totals_idempotence_rollbacks_and_recovery(database, capsys):
    worker, sink, config = database
    assert worker.run(now=NOW) == 0
    clean, sales = snapshots(worker)
    assert len(clean) == 3
    assert next(r for r in clean if r["order_id"] == "left")["sku"] == "sku-a"
    assert [str(r["order_date"]) for r in sales] == ["2026-10-16", "2026-10-21", "2026-10-22"]
    assert sum(r["revenue_cent"] for r in sales) == 1150
    assert sum(r["units"] for r in sales) == 6
    assert sum(r["order_count"] for r in sales) == 3
    assert worker.run(now=NOW) == 0
    after = snapshots(worker)
    for old_rows, new_rows in zip([clean, sales], after, strict=True):
        assert business_rows(old_rows) == business_rows(new_rows)
    assert worker.run(mode="fail-clean", now=NOW) == 2
    assert snapshots(worker) == after
    assert worker.run(mode="fail-aggregate", now=NOW) == 2
    assert snapshots(worker)[1] == after[1]
    assert snapshots(worker)[0] != after[0]
    assert worker.run(mode="recovery", now=NOW) == 0
    events = [json.loads(p) for p in sink.payloads if "eventType" in json.loads(p)]
    runs = defaultdict(list)
    for e in events:
        runs[e["run"]["runId"]].append(e)
    assert len(runs) == 10
    assert all(es[0]["eventType"] == "START" and len(es) == 2 for es in runs.values())
    assert [e["eventType"] for e in events].count("FAIL") == 2
    assert [e["eventType"] for e in events].count("ABORT") == 1
    clean_end = next(
        e for e in events if e["job"]["name"] == "orders_clean" and e["eventType"] == "COMPLETE"
    )
    assert clean_end["inputs"][0]["inputFacets"]["inputStatistics"]["rowCount"] == 8
    assert clean_end["outputs"][0]["outputFacets"]["outputStatistics"]["rowCount"] == 3
    pending = worker.rows("SELECT COUNT(*) AS n FROM openlineage_outbox WHERE delivered_at IS NULL")
    assert pending[0]["n"] == 0
    output = "".join(sink.payloads) + capsys.readouterr().out
    for forbidden in ("private-customer-id", config.db_password, config.token):
        assert forbidden not in output
    with pytest.raises(pymysql.err.OperationalError):
        worker.execute(f"DELETE FROM {config.source_schema}.demo_orders")
    with pytest.raises(pymysql.err.OperationalError):
        worker.execute("DROP TABLE demo_sales_daily")


def test_real_http_outage_commits_data_and_replays_original_events(database):
    worker, _, config = database
    accepted, requests_seen = [], []
    state = {"status": 503}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            payload = self.rfile.read(int(self.headers["Content-Length"]))
            requests_seen.append(payload)
            if state["status"] == 200:
                accepted.append(payload)
            self.send_response(state["status"])
            self.send_header("Retry-After", "0")
            self.end_headers()
            self.wfile.write(b"{}")

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    sink = HttpSink(config)
    sink.url = f"http://127.0.0.1:{server.server_port}/v1/write/openlineage"
    worker.sink = sink
    try:
        assert worker.run(now=NOW) == 3
        assert len(requests_seen) == 3
        assert len(set(requests_seen)) == 1
        pending = [
            r["payload"].encode()
            for r in worker.rows(
                "SELECT payload FROM openlineage_outbox WHERE delivered_at IS NULL ORDER BY id"
            )
        ]
        assert len(pending) == 9
        assert len(snapshots(worker)[0]) == 3
        before = snapshots(worker)
        state["status"] = 200
        replay = Worker(config, sink)
        try:
            assert replay.run(mode="replay") == 0
        finally:
            replay.close()
        assert accepted == pending
        assert snapshots(worker) == before
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def test_lock_and_crash_recovery(database):
    worker, sink, config = database
    worker.initialize()
    lock = f"mall-pipeline:{config.analytics_schema}"
    worker.execute("SELECT GET_LOCK(%s,0)", (lock,))
    other = Worker(config, sink)
    try:
        assert other.run(now=NOW) == 4
    finally:
        other.close()
        worker.execute("SELECT RELEASE_LOCK(%s)", (lock,))
    run_id = str(uuid4())
    worker.execute(
        "INSERT INTO pipeline_runs VALUES (%s,'orders_clean','START',UTC_TIMESTAMP(),NULL)",
        (run_id,),
    )
    worker.enqueue(worker.lineage.run("orders_clean", run_id, "START"))
    assert worker.run(mode="replay") == 0
    recovered = [
        json.loads(p) for p in sink.payloads if json.loads(p).get("run", {}).get("runId") == run_id
    ]
    assert [e["eventType"] for e in recovered] == ["START", "ABORT"]
