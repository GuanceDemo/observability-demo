import os
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime, time, timedelta
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo


@dataclass(frozen=True)
class Config:
    db_host: str
    db_user: str
    db_password: str = field(repr=False)
    token: str = field(repr=False)
    db_port: int = 3306
    source_schema: str = "selfheal"
    analytics_schema: str = "mall_analytics"
    dataset_namespace: str = "mysql://demo-observability-demo-mysql:3306"
    job_namespace: str = "mall-demo.data-pipeline"
    endpoint: str = "https://openway.guance.com"
    lookback_days: int = 7

    def __post_init__(self) -> None:
        for name in (self.source_schema, self.analytics_schema):
            if not re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_]{0,63}", name):
                raise ValueError("Invalid database identifier")
        if self.source_schema == self.analytics_schema:
            raise ValueError("Source and analytics databases must differ")
        url = urlsplit(self.endpoint)
        if (
            url.scheme != "https"
            or not url.hostname
            or url.username
            or url.password
            or url.query
            or url.fragment
            or url.path not in ("", "/")
        ):
            raise ValueError("OPENLINEAGE_URL must be an HTTPS origin without credentials or query")
        if not 1 <= self.lookback_days <= 31:
            raise ValueError("LOOKBACK_DAYS must be between 1 and 31")

    @classmethod
    def from_env(cls) -> "Config":
        required = ("MYSQL_HOST", "MYSQL_USER", "MYSQL_PASSWORD", "OPENLINEAGE_TOKEN")
        missing = [key for key in required if not os.environ.get(key)]
        if missing:
            raise ValueError("Missing settings: " + ", ".join(missing))
        return cls(
            db_host=os.environ["MYSQL_HOST"],
            db_user=os.environ["MYSQL_USER"],
            db_password=os.environ["MYSQL_PASSWORD"],
            token=os.environ["OPENLINEAGE_TOKEN"],
            db_port=int(os.getenv("MYSQL_PORT", "3306")),
            source_schema=os.getenv("SOURCE_DATABASE", "selfheal"),
            analytics_schema=os.getenv("ANALYTICS_DATABASE", "mall_analytics"),
            dataset_namespace=os.getenv(
                "DATASET_NAMESPACE", "mysql://demo-observability-demo-mysql:3306"
            ),
            job_namespace=os.getenv("JOB_NAMESPACE", "mall-demo.data-pipeline"),
            endpoint=os.getenv("OPENLINEAGE_URL", "https://openway.guance.com"),
            lookback_days=int(os.getenv("LOOKBACK_DAYS", "7")),
        )


def extraction_window(now: datetime, days: int) -> tuple[datetime, datetime]:
    """Return naive UTC bounds for MySQL; source TIMESTAMPs use a UTC session."""
    if now.tzinfo is None:
        raise ValueError("Extraction clock must include a timezone")
    zone = ZoneInfo("Asia/Shanghai")
    first_day = now.astimezone(zone).date() - timedelta(days=days - 1)
    start = datetime.combine(first_day, time.min, tzinfo=zone)
    return start.astimezone(UTC).replace(tzinfo=None), now.astimezone(UTC).replace(tzinfo=None)
