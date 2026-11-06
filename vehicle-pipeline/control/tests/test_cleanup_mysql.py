"""Run against an isolated disposable MySQL with VEHICLE_TEST_MYSQL_PORT set."""
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import pymysql
import pytest

from vehicle_control.service import cleanup
from vehicle_control.store import Store


@pytest.mark.skipif(not os.getenv("VEHICLE_TEST_MYSQL_PORT"), reason="isolated MySQL not supplied")
@pytest.mark.parametrize("legacy_isolation", [True, False])
def test_cleanup_does_not_deadlock_a_starting_spark_run(legacy_isolation):
    schema = "vehicle_cleanup_test_" + uuid4().hex

    def connect():
        return pymysql.connect(
            host="127.0.0.1", port=int(os.environ["VEHICLE_TEST_MYSQL_PORT"]), user="root",
            autocommit=False, read_timeout=10, write_timeout=10,
        )

    admin = connect()
    connections = []
    try:
        with admin.cursor() as cursor:
            cursor.execute(f"CREATE DATABASE {schema}")
            cursor.execute(f"USE {schema}")
            source = Path(__file__).resolve().parents[2] / "schema.sql"
            for statement in source.read_text().split(";"):
                if statement.strip():
                    cursor.execute(statement)
            cursor.execute(
                "INSERT INTO lineage_outbox(event_key,run_id,payload,delivered_at) "
                "VALUES('old','old','{}',UTC_TIMESTAMP()-INTERVAL 8 DAY),"
                "('recent','recent','{}',UTC_TIMESTAMP())"
            )
        admin.commit()
        writer, cleaner = connect(), connect()
        connections.extend([writer, cleaner])
        for db in connections:
            with db.cursor() as cursor:
                cursor.execute(f"USE {schema}")
                cursor.execute("SET SESSION innodb_lock_wait_timeout=5")
        with writer.cursor() as cursor:
            cursor.execute(
                "INSERT INTO pipeline_runs(run_id,job_name,engine,state,started_at,updated_at) "
                "VALUES('new-run','vehicle_summary','SPARK','START',UTC_TIMESTAMP(),UTC_TIMESTAMP())"
            )
        outbox_cleaned = threading.Event()

        class CoordinatedStore(Store):
            def __init__(self):
                self.db = cleaner

            def execute(self, sql, args=None):
                if legacy_isolation and sql.startswith("SET TRANSACTION"):
                    return 0
                result = super().execute(sql, args)
                if sql.startswith("DELETE FROM lineage_outbox"):
                    outbox_cleaned.set()
                return result

        def start_run():
            assert outbox_cleaned.wait(5)
            try:
                with writer.cursor() as cursor:
                    cursor.execute(
                        "INSERT INTO lineage_outbox(event_key,run_id,payload) "
                        "VALUES('new-run:START','new-run','{}')"
                    )
                writer.commit()
            except Exception:
                writer.rollback()
                raise

        errors = []
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(cleanup, CoordinatedStore()), pool.submit(start_run)]
            for future in futures:
                try:
                    future.result(timeout=12)
                except pymysql.OperationalError as error:
                    errors.append(error.args[0])
        if legacy_isolation:
            assert errors == [1213], "The regression must reproduce the original deadlock"
        else:
            assert not errors
            admin.commit()
            with admin.cursor() as cursor:
                cursor.execute("SELECT event_key FROM lineage_outbox ORDER BY event_key")
                assert cursor.fetchall() == (("new-run:START",), ("recent",))
                cursor.execute("SELECT run_id FROM pipeline_runs")
                assert cursor.fetchall() == (("new-run",),)
            with cleaner.cursor() as cursor:
                cursor.execute("SELECT @@transaction_isolation")
                assert cursor.fetchone()[0] == "REPEATABLE-READ"
    finally:
        for db in connections:
            db.close()
        with admin.cursor() as cursor:
            cursor.execute(f"DROP DATABASE IF EXISTS {schema}")
        admin.close()
