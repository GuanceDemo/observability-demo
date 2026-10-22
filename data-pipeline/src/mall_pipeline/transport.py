import random
import time
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime

import requests

from .config import Config


class DeliveryError(Exception):
    """Safe diagnostic code only: never include headers, URLs or response bodies."""


class HttpSink:
    def __init__(self, config: Config):
        self.url = config.endpoint.rstrip("/") + "/v1/write/openlineage"
        self.session = requests.Session()
        self.session.headers.update(
            {
                # The Demo DataWay accepts X-Token; its edge currently ignores Bearer.
                "X-Token": config.token,
                "Content-Type": "application/json",
            }
        )

    def send(self, payload: str) -> None:
        for attempt in range(3):
            retry_after = None
            try:
                response = self.session.post(
                    self.url, data=payload.encode(), timeout=(5, 10), allow_redirects=False
                )
            except requests.RequestException:
                code = "network_error"
            else:
                if 200 <= response.status_code < 300:
                    # DataWay can acknowledge buffered ingestion with dataway.cached.
                    try:
                        body = response.json()
                    except ValueError:
                        body = {}
                    if isinstance(body, dict) and body.get("error_code") not in (
                        None,
                        "",
                        "dataway.cached",
                    ):
                        raise DeliveryError("ingestion_rejected")
                    return
                code = f"http_{response.status_code}"
                try:
                    failure = response.json()
                except ValueError:
                    failure = None
                if isinstance(failure, dict) and failure.get("error_code") == "dataway.emptyToken":
                    code += "_missing_token"
                if response.status_code != 429 and response.status_code < 500:
                    raise DeliveryError(code)
                retry_after = response.headers.get("Retry-After")
            if attempt < 2:
                time.sleep(retry_delay(attempt, retry_after))
        raise DeliveryError(code)


def retry_delay(attempt: int, retry_after: str | None) -> float:
    if retry_after:
        try:
            return min(10.0, max(0.0, float(retry_after)))
        except ValueError:
            try:
                delay = (parsedate_to_datetime(retry_after) - datetime.now(UTC)).total_seconds()
                return min(10.0, max(0.0, delay))
            except (ValueError, TypeError, OverflowError):
                pass
    return float(2**attempt) + random.uniform(0, 0.5)
