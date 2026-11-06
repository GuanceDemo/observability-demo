import os
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from mall_pipeline.config import Config as TransportConfig


@dataclass(frozen=True)
class Config:
    mysql_host: str
    mysql_user: str
    mysql_password: str = field(repr=False)
    token: str = field(repr=False)
    bridge_token: str = field(repr=False)
    mysql_reader_password: str = field(default="", repr=False)
    mysql_port: int = 3306
    endpoint: str = "https://openway.guance.com"
    flink_url: str = "http://vehicle-flink:8081"
    job_namespace: str = "vehicle-demo.telemetry"
    kafka_namespace: str = "kafka://vehicle-kafka.vehicle-pipeline.svc.cluster.local:9092"
    kafka_topic: str = "vehicle.telemetry.raw.v1"
    mqtt_namespace: str = "mqtt://vehicle-emqx"
    mqtt_topic: str = "vehicle/v1/demo-vehicle-001/telemetry"
    lake_namespace: str = "s3://vehicle-lake"

    def __post_init__(self) -> None:
        # Reuse the already-tested Guance URL/auth contract, including X-Token.
        self.transport_config()
        url = urlsplit(self.flink_url)
        if (
            url.scheme not in {"http", "https"}
            or not url.hostname
            or url.username
            or url.password
            or url.query
            or url.fragment
            or url.path not in {"", "/"}
        ):
            raise ValueError("Invalid Flink origin")
        if len(self.bridge_token) < 32:
            raise ValueError("Bridge token must have sufficient entropy")

    def transport_config(self) -> TransportConfig:
        return TransportConfig(
            db_host=self.mysql_host,
            db_user=self.mysql_user,
            db_password=self.mysql_password,
            token=self.token,
            endpoint=self.endpoint,
            analytics_schema="vehicle_analytics",
        )

    @classmethod
    def from_env(cls) -> "Config":
        required = (
            "MYSQL_HOST",
            "MYSQL_USER",
            "MYSQL_PASSWORD",
            "MYSQL_READER_PASSWORD",
            "OPENLINEAGE_TOKEN",
            "BRIDGE_TOKEN",
        )
        if missing := [name for name in required if not os.getenv(name)]:
            raise ValueError("Missing settings: " + ", ".join(missing))
        return cls(
            mysql_host=os.environ["MYSQL_HOST"],
            mysql_user=os.environ["MYSQL_USER"],
            mysql_password=os.environ["MYSQL_PASSWORD"],
            mysql_reader_password=os.environ["MYSQL_READER_PASSWORD"],
            token=os.environ["OPENLINEAGE_TOKEN"],
            bridge_token=os.environ["BRIDGE_TOKEN"],
            mysql_port=int(os.getenv("MYSQL_PORT", "3306")),
            endpoint=os.getenv("OPENLINEAGE_URL", "https://openway.guance.com"),
            flink_url=os.getenv("FLINK_URL", "http://vehicle-flink:8081"),
            job_namespace=os.getenv("JOB_NAMESPACE", "vehicle-demo.telemetry"),
            kafka_namespace=os.getenv("KAFKA_NAMESPACE", cls.kafka_namespace),
            kafka_topic=os.getenv("KAFKA_TOPIC", cls.kafka_topic),
            lake_namespace=os.getenv("LAKE_NAMESPACE", cls.lake_namespace),
        )
