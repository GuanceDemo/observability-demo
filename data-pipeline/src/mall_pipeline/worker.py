import time
from datetime import UTC, datetime
from typing import Any, Protocol
from uuid import uuid4

import pymysql
from pymysql.cursors import DictCursor

from .config import Config, extraction_window
from .lineage import Lineage, log
from .transport import DeliveryError


class Sink(Protocol):
    def send(self, payload: str) -> None: ...


class InjectedFailure(Exception):
    pass


class Worker:
    def __init__(self, config: Config, sink: Sink):
        self.config = config
        self.sink = sink
        self.delivery_failed = False
        self.lineage = Lineage(config)
        self.db = pymysql.connect(
            host=config.db_host,
            port=config.db_port,
            user=config.db_user,
            password=config.db_password,
            database=config.analytics_schema,
            charset="utf8mb4",
            autocommit=True,
            cursorclass=DictCursor,
            connect_timeout=10,
            read_timeout=120,
            write_timeout=120,
            init_command="SET time_zone = '+00:00'",
        )

    def execute(self, sql: str, args: Any = None) -> int:
        with self.db.cursor() as cursor:
            return cursor.execute(sql, args)

    def rows(self, sql: str, args: Any = None) -> list[dict[str, Any]]:
        with self.db.cursor() as cursor:
            cursor.execute(sql, args)
            return list(cursor.fetchall())

    def initialize(self) -> None:
        definitions = {
            "demo_orders_clean": """order_id VARCHAR(64) PRIMARY KEY, sku VARCHAR(96) NOT NULL,
                quantity INT NOT NULL, amount_cent BIGINT NOT NULL, order_date DATE NOT NULL,
                created_at DATETIME(3) NOT NULL, processed_at DATETIME(3) NOT NULL,
                run_id CHAR(36) NOT NULL, INDEX(order_date)""",
            "demo_sales_daily": """order_date DATE PRIMARY KEY, order_count BIGINT NOT NULL,
                units BIGINT NOT NULL, revenue_cent BIGINT NOT NULL,
                processed_at DATETIME(3) NOT NULL, run_id CHAR(36) NOT NULL""",
            "openlineage_outbox": """id BIGINT AUTO_INCREMENT PRIMARY KEY, payload JSON NOT NULL,
                created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                delivered_at DATETIME(3) NULL, attempts INT NOT NULL DEFAULT 0,
                last_error VARCHAR(64) NULL, INDEX(delivered_at, id)""",
            "pipeline_runs": """run_id CHAR(36) PRIMARY KEY, job VARCHAR(64) NOT NULL,
                state VARCHAR(16) NOT NULL, started_at DATETIME(3) NOT NULL,
                finished_at DATETIME(3) NULL""",
        }
        for table, definition in definitions.items():
            self.execute(f"CREATE TABLE IF NOT EXISTS {table} ({definition}) ENGINE=InnoDB")

    def enqueue(self, payload: str) -> None:
        self.execute("INSERT INTO openlineage_outbox(payload) VALUES (%s)", (payload,))

    def flush(self) -> bool:
        if self.delivery_failed:
            return False
        # Ordered delivery also prevents a terminal event overtaking its START.
        while batch := self.rows(
            "SELECT id,payload FROM openlineage_outbox "
            "WHERE delivered_at IS NULL ORDER BY id LIMIT 100"
        ):
            for row in batch:
                try:
                    self.sink.send(row["payload"])
                except DeliveryError as error:
                    self.delivery_failed = True
                    self.execute(
                        """UPDATE openlineage_outbox SET attempts=attempts+1,
                        last_error=%s WHERE id=%s""",
                        (str(error), row["id"]),
                    )
                    log("lineage_delivery_pending", reason=str(error))
                    return False
                self.execute(
                    """UPDATE openlineage_outbox SET delivered_at=UTC_TIMESTAMP(3),
                    attempts=attempts+1,last_error=NULL WHERE id=%s""",
                    (row["id"],),
                )
        return True

    def terminal(self, job: str, run_id: str, state: str, **kwargs: Any) -> None:
        self.enqueue(self.lineage.run(job, run_id, state, **kwargs))
        self.execute(
            "UPDATE pipeline_runs SET state=%s,finished_at=UTC_TIMESTAMP(3) WHERE run_id=%s",
            (state, run_id),
        )

    def recover_interrupted(self) -> None:
        # Called only while holding the same MySQL advisory lock as all writers.
        for row in self.rows("SELECT run_id,job FROM pipeline_runs WHERE state='START'"):
            self.db.begin()
            self.terminal(
                row["job"],
                row["run_id"],
                "ABORT",
                error="Previous worker stopped before persisting its terminal event",
            )
            self.db.commit()

    def clean(self, run_id: str, window: tuple[datetime, datetime], fail: bool) -> tuple[int, int]:
        source = f"`{self.config.source_schema}`.demo_orders"
        where = "created_at >= %s AND created_at < %s"
        # One consistent, non-locking source snapshot. INSERT ... SELECT under
        # MySQL REPEATABLE READ would lock source rows and could block checkout.
        source_rows = self.rows(
            f"""SELECT order_id,TRIM(sku) AS sku,quantity,amount_cent,
                DATE(created_at + INTERVAL 8 HOUR) AS order_date,created_at,
                (status='CONFIRMED' AND CHAR_LENGTH(TRIM(sku))>0
                 AND quantity>0 AND amount_cent>0) AS eligible
                FROM {source} WHERE {where}""",
            window,
        )
        self.execute("DELETE FROM demo_orders_clean")
        if fail:
            raise InjectedFailure(
                "Cleansing failure injected after DELETE; transaction rolled back"
            )
        accepted = [
            (
                row["order_id"],
                row["sku"],
                row["quantity"],
                row["amount_cent"],
                row["order_date"],
                row["created_at"],
                run_id,
            )
            for row in source_rows
            if row["eligible"]
        ]
        with self.db.cursor() as cursor:
            for offset in range(0, len(accepted), 1000):
                cursor.executemany(
                    """INSERT INTO demo_orders_clean
                    (order_id,sku,quantity,amount_cent,order_date,created_at,processed_at,run_id)
                    VALUES (%s,%s,%s,%s,%s,%s,UTC_TIMESTAMP(3),%s)""",
                    accepted[offset : offset + 1000],
                )
        return len(source_rows), len(accepted)

    def aggregate(self, run_id: str, fail: bool) -> tuple[int, int]:
        count = int(self.rows("SELECT COUNT(*) AS n FROM demo_orders_clean")[0]["n"])
        self.execute("DELETE FROM demo_sales_daily")
        if fail:
            raise InjectedFailure(
                "Aggregation failure injected after DELETE; transaction rolled back"
            )
        days = self.execute(
            """INSERT INTO demo_sales_daily
            (order_date,order_count,units,revenue_cent,processed_at,run_id)
            SELECT order_date,COUNT(*),SUM(quantity),SUM(amount_cent),UTC_TIMESTAMP(3),%s
            FROM demo_orders_clean GROUP BY order_date""",
            (run_id,),
        )
        return count, days

    def stage(
        self, job: str, window: tuple[datetime, datetime], mode: str, delay: int, upstream_ok: bool
    ) -> bool:
        run_id = str(uuid4())
        started = time.monotonic()
        self.db.begin()
        self.execute(
            """INSERT INTO pipeline_runs(run_id,job,state,started_at)
            VALUES (%s,%s,'START',UTC_TIMESTAMP(3))""",
            (run_id, job),
        )
        self.enqueue(self.lineage.run(job, run_id, "START"))
        self.db.commit()
        self.flush()
        state = "COMPLETE"
        details: dict[str, Any] = {}
        try:
            self.db.begin()
            if not upstream_ok:
                state = "ABORT"
                details = {
                    "error": "Upstream orders_clean did not complete; previous output retained"
                }
            elif job == "orders_clean":
                source_count, output_count = self.clean(run_id, window, mode == "fail-clean")
                details = {"input_count": source_count, "output_count": output_count}
            else:
                if mode == "slow":
                    time.sleep(delay)
                source_count, output_count = self.aggregate(run_id, mode == "fail-aggregate")
                details = {"input_count": source_count, "output_count": output_count}
            self.terminal(job, run_id, state, **details)
            self.db.commit()
        except (Exception, KeyboardInterrupt) as error:
            self.db.rollback()
            state = "ABORT" if isinstance(error, KeyboardInterrupt) else "FAIL"
            # SQL exceptions can embed values and credentials: publish only a safe classification.
            message = str(error) if isinstance(error, InjectedFailure) else type(error).__name__
            details = {"error": message}
            self.db.begin()
            self.terminal(job, run_id, state, **details)
            self.db.commit()
        log(
            "stage_finished",
            job=job,
            run_id=run_id,
            state=state,
            elapsed_ms=round((time.monotonic() - started) * 1000),
            **details,
        )
        self.flush()
        return state == "COMPLETE"

    def run(self, mode: str = "normal", delay: int = 30, now: datetime | None = None) -> int:
        if mode not in {"normal", "recovery", "fail-clean", "fail-aggregate", "slow", "replay"}:
            raise ValueError("Unknown demo mode")
        if not 1 <= delay <= 120:
            raise ValueError("Delay must be between 1 and 120 seconds")
        self.delivery_failed = False
        lock = f"mall-pipeline:{self.config.analytics_schema}"
        acquired = self.rows("SELECT GET_LOCK(%s,0) AS acquired", (lock,))[0]["acquired"]
        if acquired != 1:
            log("pipeline_busy")
            return 4
        try:
            self.initialize()
            self.recover_interrupted()
            self.flush()
            if mode == "replay":
                return 0 if self.flush() else 3
            for payload in self.lineage.catalog():
                self.enqueue(payload)
            window = extraction_window(now or datetime.now(UTC), self.config.lookback_days)
            log(
                "pipeline_started",
                mode=mode,
                window_start=window[0].isoformat(),
                window_end=window[1].isoformat(),
            )
            clean_ok = self.stage("orders_clean", window, mode, delay, True)
            sales_ok = self.stage("sales_aggregate", window, mode, delay, clean_ok)
            delivered = self.flush()
            self.execute("""DELETE FROM openlineage_outbox WHERE
                delivered_at < UTC_TIMESTAMP() - INTERVAL 7 DAY""")
            self.execute("""DELETE FROM pipeline_runs WHERE
                finished_at < UTC_TIMESTAMP() - INTERVAL 7 DAY""")
            return (0 if delivered else 3) if clean_ok and sales_ok else 2
        finally:
            self.db.rollback()
            self.execute("SELECT RELEASE_LOCK(%s)", (lock,))

    def close(self) -> None:
        self.db.close()
