import os
from uuid import uuid4

import pymysql
import pytest

from mall_pipeline.config import Config
from mall_pipeline.worker import Worker


class CaptureSink:
    def __init__(self):
        self.payloads = []

    def send(self, payload):
        self.payloads.append(payload)


@pytest.fixture
def config():
    return Config("127.0.0.1", "pipeline", "private-test-password", "private-test-token")


@pytest.fixture
def database():
    if not os.environ.get("TEST_MYSQL_PORT"):
        pytest.skip("Use tests/integration.sh to create a disposable MySQL instance")
    connection = pymysql.connect(
        host="127.0.0.1",
        port=int(os.environ["TEST_MYSQL_PORT"]),
        user="root",
        password=os.environ["TEST_MYSQL_PASSWORD"],
        autocommit=True,
    )
    suffix = uuid4().hex[:12]
    source, analytics, user = f"source_{suffix}", f"analytics_{suffix}", f"worker_{suffix}"
    password = uuid4().hex
    with connection.cursor() as cur:
        cur.execute(f"CREATE DATABASE {source}")
        cur.execute(f"CREATE DATABASE {analytics}")
        cur.execute(f"""CREATE TABLE {source}.demo_orders (
            order_id VARCHAR(64) PRIMARY KEY,sku VARCHAR(96),quantity INT,amount_cent INT,
            status VARCHAR(32),created_at TIMESTAMP(3),user_id VARCHAR(128)
        ) ENGINE=InnoDB""")
        rows = [
            ("left", "  sku-a  ", 2, 300, "CONFIRMED", "2026-10-15 16:00:00"),
            ("before-midnight", "sku-b", 1, 100, "CONFIRMED", "2026-10-21 15:59:59.999"),
            ("midnight", "sku-c", 3, 750, "CONFIRMED", "2026-10-21 16:00:00"),
            ("failed", "sku-a", 1, 100, "FAILED", "2026-10-21 17:00:00"),
            ("empty-sku", "  ", 1, 100, "CONFIRMED", "2026-10-21 17:00:00"),
            ("zero-quantity", "sku-a", 0, 100, "CONFIRMED", "2026-10-21 17:00:00"),
            ("zero-amount", "sku-a", 1, 0, "CONFIRMED", "2026-10-21 17:00:00"),
            ("negative", "sku-a", -1, -100, "CONFIRMED", "2026-10-21 17:00:00"),
            ("right", "sku-a", 1, 100, "CONFIRMED", "2026-10-22 10:00:00"),
            ("old", "sku-a", 1, 100, "CONFIRMED", "2026-10-15 15:59:59.999"),
        ]
        cur.executemany(
            f"""INSERT INTO {source}.demo_orders
            (order_id,sku,quantity,amount_cent,status,created_at,user_id)
            VALUES (%s,%s,%s,%s,%s,%s,'private-customer-id')""",
            rows,
        )
        cur.execute(f"CREATE USER '{user}'@'%%' IDENTIFIED BY %s", (password,))
        cur.execute(f"GRANT SELECT ON {source}.demo_orders TO '{user}'@'%'")
        cur.execute(f"GRANT SELECT,INSERT,UPDATE,DELETE,CREATE ON {analytics}.* TO '{user}'@'%'")
    config = Config(
        "127.0.0.1",
        user,
        password,
        "private-test-token",
        db_port=int(os.environ["TEST_MYSQL_PORT"]),
        source_schema=source,
        analytics_schema=analytics,
    )
    sink = CaptureSink()
    worker = Worker(config, sink)
    try:
        yield worker, sink, config
    finally:
        worker.close()
        with connection.cursor() as cur:
            cur.execute(f"DROP DATABASE {analytics}")
            cur.execute(f"DROP DATABASE {source}")
            cur.execute(f"DROP USER '{user}'@'%'")
        connection.close()
