import json
from contextlib import AbstractContextManager
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any
from uuid import uuid4

import pymysql
from pymysql.cursors import DictCursor

from .config import Config
from .lineage import JOBS, Lineage


def encode(value: Any) -> str:
    if isinstance(value, datetime):
        return value.replace(tzinfo=UTC).isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    raise TypeError(type(value).__name__)


class Store(AbstractContextManager["Store"]):
    def __init__(self, config: Config, *, read_only: bool = False):
        self.db = pymysql.connect(
            host=config.mysql_host,
            port=config.mysql_port,
            user="vehicle_reader" if read_only else config.mysql_user,
            password=config.mysql_reader_password if read_only else config.mysql_password,
            database="vehicle_analytics",
            charset="utf8mb4",
            autocommit=False,
            cursorclass=DictCursor,
            connect_timeout=5,
            read_timeout=15,
            write_timeout=15,
            init_command="SET time_zone='+00:00'",
        )

    def __exit__(self, *args: Any) -> None:
        self.db.close()

    def execute(self, sql: str, args: Any = None) -> int:
        with self.db.cursor() as cursor:
            return cursor.execute(sql, args)

    def rows(self, sql: str, args: Any = None) -> list[dict[str, Any]]:
        with self.db.cursor() as cursor:
            cursor.execute(sql, args)
            return list(cursor.fetchall())

    def enqueue(self, key: str, run_id: str, payload: str) -> None:
        self.execute(
            "INSERT INTO lineage_outbox(event_key,run_id,payload) VALUES(%s,%s,%s)",
            (key, run_id, payload),
        )

    def observe_flink(
        self,
        lineage: Lineage,
        payload: dict[str, Any],
        counts: dict[str, int],
        failures: list[dict[str, Any]],
    ) -> None:
        """One run per evidenced execution episode; terminal events never turn RUNNING again."""
        now = datetime.now(UTC)
        rows = self.rows("SELECT * FROM component_state WHERE component='flink' FOR UPDATE")
        old = rows[0] if rows else None
        prior = json.loads(old["payload"]) if old else {}
        same_job = prior.get("jobId") == payload["jobId"]
        tracked = same_job and prior.get("executionScope") == "flink-attempt"
        # Adopting an existing healthy job must not retroactively fail it for archived exceptions.
        cursor = prior.get("failureCursor", 0) if tracked else int(now.timestamp() * 1000)
        payload.update(
            executionScope="flink-attempt",
            failureCursor=max([cursor] + [entry["atMs"] for entry in failures]),
        )
        if same_job and prior.get("lastFailure"):
            payload["lastFailure"] = prior["lastFailure"]
        ready = payload["executionReady"]
        attempt = payload.get("attemptKey")
        if ready:
            assert isinstance(attempt, str) and attempt, "Ready execution requires attempt identity"
        if not old:
            if ready:
                assert isinstance(attempt, str)
                self.observe(
                    lineage,
                    "flink",
                    attempt,
                    "RUNNING",
                    payload,
                    counts,
                    started=datetime.fromtimestamp(payload["attemptStartedAt"] / 1000, UTC),
                )
            else:
                self.db.commit()
            return
        current = self.rows("SELECT * FROM pipeline_runs WHERE run_id=%s", (old["run_id"],))[0]
        active = current["state"] in {"START", "RUNNING"}
        started_ms = int(current["started_at"].replace(tzinfo=UTC).timestamp() * 1000)
        new_errors = (
            [entry for entry in failures if entry["atMs"] > cursor and entry["atMs"] >= started_ms]
            if tracked
            else []
        )
        if active and payload["engineState"] == "FAILED" and not new_errors:
            new_errors = [
                {
                    "atMs": int(now.timestamp() * 1000),
                    "errorCode": "FLINK_JOB_FAILED",
                    "failureStage": "job-execution",
                    "message": "Flink 引擎已进入 FAILED 终态；异常详情暂不可用。",
                }
            ]
        if active and new_errors:
            failure = new_errors[0]
            reference = {
                "runId": old["run_id"],
                "job": JOBS["flink"],
                "state": "FAIL",
                "code": failure["errorCode"],
                "atMs": failure["atMs"],
            }
            payload["lastFailure"] = reference
            failed_metadata = {
                **prior,
                "attemptKey": old["instance_key"],
                "engineState": payload["engineState"],
                "failure": failure,
                "lastFailure": reference,
            }
            self.terminal(
                lineage,
                "flink",
                old["run_id"],
                "FAIL",
                prior.get("counts", {}),
                failure["errorCode"],
                at=datetime.fromtimestamp(failure["atMs"] / 1000, UTC),
                metadata=failed_metadata,
                error_details=failure,
            )
            active = False
        if not tracked and same_job and active and ready:
            # Migrate the instance key in place; preserve the existing UUID and its real START.
            self.execute(
                "UPDATE component_state SET instance_key=%s WHERE component='flink'", (attempt,)
            )
            old["instance_key"] = attempt
        last_failure = payload.get("lastFailure", {})
        can_start = ready and (
            active
            or (
                attempt != old["instance_key"]
                and payload["attemptStartedAt"] > last_failure.get("atMs", 0)
            )
        )
        if can_start:
            assert isinstance(attempt, str)
            self.observe(
                lineage,
                "flink",
                attempt,
                "RUNNING",
                payload,
                counts,
                started=datetime.fromtimestamp(payload["attemptStartedAt"] / 1000, UTC),
            )
            return
        if active:
            # A missing metric or REST endpoint is not proof of execution failure.
            terminal = {"FAILED": "FAIL", "CANCELED": "ABORT", "FINISHED": "COMPLETE"}
            state = terminal.get(payload["engineState"], "RUNNING")
            if state == "FAIL":
                payload["errorCode"] = "FLINK_JOB_FAILED"
            self.observe(lineage, "flink", old["instance_key"], state, payload, counts)
            return
        # Preserve terminal failure during resource waits; only component health moves.
        self.execute(
            "UPDATE component_state SET last_seen_at=%s,payload=%s WHERE component='flink'",
            (now.replace(tzinfo=None), json.dumps(payload)),
        )
        self.db.commit()

    def observe(
        self,
        lineage: Lineage,
        component: str,
        instance: str,
        state: str,
        payload: dict[str, Any],
        counts: dict[str, int],
        *,
        started: datetime | None = None,
    ) -> None:
        now = datetime.now(UTC).replace(tzinfo=None)
        previous = self.rows(
            "SELECT * FROM component_state WHERE component=%s FOR UPDATE", (component,)
        )
        old = previous[0] if previous else None
        new_instance = not old or old["instance_key"] != instance
        if new_instance:
            if old:
                old_state = self.rows(
                    "SELECT state FROM pipeline_runs WHERE run_id=%s", (old["run_id"],)
                )[0]["state"]
                if old_state in {"START", "RUNNING"}:
                    self.terminal(
                        lineage, component, old["run_id"], "ABORT", {}, "INSTANCE_REPLACED"
                    )
            run_id = str(uuid4())
            start = (started or datetime.now(UTC)).astimezone(UTC).replace(tzinfo=None)
            self.execute(
                "INSERT INTO "
                "pipeline_runs(run_id,job_name,engine,state,started_at,updated_at) "
                "VALUES(%s,%s,%s,'START',%s,%s)",
                (run_id, JOBS[component], component.upper(), start, now),
            )
            for i, event in enumerate(lineage.catalog(component)):
                self.enqueue(f"{run_id}:catalog:{i}", run_id, event)
            self.enqueue(
                f"{run_id}:START",
                run_id,
                lineage.event(
                    component, run_id, "START", at=start.replace(tzinfo=UTC), metadata=payload
                ),
            )
            self.execute(
                "INSERT INTO component_state VALUES(%s,%s,%s,%s,%s,%s) ON DUPLICATE KEY "
                "UPDATE "
                "instance_key=VALUES(instance_key),run_id=VALUES(run_id),last_seen_at=VALUES(last"
                "_seen_at),last_emitted_at=VALUES(last_emitted_at),payload=VALUES(payload)",
                (component, instance, run_id, now, now, json.dumps(payload)),
            )
            emit = True
        else:
            assert old is not None
            run_id = old["run_id"]
            emit = (now - old["last_emitted_at"]).total_seconds() >= 60
            self.execute(
                "UPDATE component_state SET last_seen_at=%s,payload=%s WHERE component=%s",
                (now, json.dumps(payload), component),
            )
        current = self.rows("SELECT state FROM pipeline_runs WHERE run_id=%s", (run_id,))[0][
            "state"
        ]
        if current in {"COMPLETE", "FAIL", "ABORT"}:
            self.db.commit()
            return
        output_count = counts.get("kafka") if component == "emqx" else counts.get("clean")
        run_metadata = dict(payload)
        if component == "flink" and payload.get("executionScope") == "flink-attempt":
            run_metadata["attemptKey"] = instance
        self.execute(
            "UPDATE pipeline_runs SET "
            "state='RUNNING',updated_at=%s,input_count=COALESCE(%s,input_count),"
            "output_count=COALESCE(%s,output_count),metadata=%s WHERE "
            "run_id=%s",
            (now, counts.get("input"), output_count, json.dumps(run_metadata), run_id),
        )
        if state in {"COMPLETE", "FAIL", "ABORT"}:
            self.terminal(
                lineage,
                component,
                run_id,
                state,
                counts,
                payload.get("errorCode"),
                metadata=run_metadata,
            )
        elif emit:
            self.enqueue(
                f"{run_id}:RUNNING:{int(now.replace(tzinfo=UTC).timestamp())}",
                run_id,
                lineage.event(component, run_id, "RUNNING", counts, metadata=run_metadata),
            )
            self.execute(
                "UPDATE component_state SET last_emitted_at=%s WHERE component=%s", (now, component)
            )
        self.db.commit()

    def terminal(
        self,
        lineage: Lineage,
        component: str,
        run_id: str,
        state: str,
        counts: dict[str, int],
        error: str | None,
        *,
        at: datetime | None = None,
        metadata: dict[str, Any] | None = None,
        error_details: dict[str, Any] | None = None,
    ) -> None:
        ended = (at or datetime.now(UTC)).astimezone(UTC).replace(tzinfo=None)
        self.execute(
            "UPDATE pipeline_runs SET "
            "state=%s,updated_at=UTC_TIMESTAMP(3),finished_at=%s,error_code=%s,"
            "metadata=COALESCE(%s,metadata) "
            "WHERE run_id=%s",
            (state, ended, error, json.dumps(metadata) if metadata is not None else None, run_id),
        )
        self.enqueue(
            f"{run_id}:{state}",
            run_id,
            lineage.event(
                component,
                run_id,
                state,
                counts,
                error=error,
                at=ended.replace(tzinfo=UTC),
                metadata=metadata,
                error_details=error_details,
            ),
        )

    def report(self) -> dict[str, Any]:
        # One repeatable-read snapshot keeps every report field on the same published batch.
        batches = self.rows("SELECT * FROM report_batches ORDER BY generated_at DESC LIMIT 1")
        jobs = self.rows(
            "SELECT r.* FROM pipeline_runs r JOIN (SELECT job_name,MAX(started_at) AS t FROM "
            "pipeline_runs GROUP BY job_name) j ON r.job_name=j.job_name AND "
            "r.started_at=j.t ORDER BY r.job_name"
        )
        components = self.rows(
            "SELECT component,last_seen_at,payload FROM component_state ORDER BY component"
        )
        for item in components:
            item["payload"] = json.loads(item["payload"])
        for job in jobs:
            job["metadata"] = json.loads(job["metadata"]) if job["metadata"] else None
        pending = self.rows(
            "SELECT COUNT(*) AS pending FROM lineage_outbox WHERE delivered_at IS NULL"
        )[0]["pending"]
        report: dict[str, Any] = {
            "status": "empty",
            "version": "0.1.0",
            "jobs": jobs,
            "components": components,
            "lineagePending": pending,
            "batch": None,
            "days": [],
            "windows": [],
            "generatedAt": datetime.now(UTC),
        }
        if batches:
            batch = batches[0]
            age = max(0, int(datetime.now(UTC).timestamp() - batch["last_event_ms"] / 1000))
            batch["ageSeconds"], batch["stale"] = age, age > 900
            report.update(
                status="ok",
                batch=batch,
                days=self.rows(
                    "SELECT * FROM vehicle_daily_summary WHERE run_id=%s ORDER BY day,vehicle_id",
                    (batch["run_id"],),
                ),
                windows=list(
                    reversed(
                        self.rows(
                            "SELECT * FROM vehicle_summary_5m WHERE run_id=%s ORDER BY "
                            "bucket_start DESC,vehicle_id LIMIT 288",
                            (batch["run_id"],),
                        )
                    )
                ),
            )
        return report
