"""Bounded retention of committed vehicle Parquet; checkpoint state is never listed."""

import argparse
import heapq
import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

BUCKET = "vehicle-lake"
PREFIXES = ("clean/", "anomalies/", "quarantine/")
PART = re.compile(
    r"^(clean|anomalies|quarantine)/(\d{4}-\d{2}-\d{2})/([01]\d|2[0-3])/"
    r"part-[A-Za-z0-9_-]+\.parquet$"
)


@dataclass(frozen=True)
class Policy:
    prior_days: int = 3
    max_scan: int = 150000
    max_delete: int = 10000
    deadline_seconds: int = 240

    def validate(self):
        for value, low, high in (
            (self.prior_days, 3, 30),
            (self.max_scan, 1, 500000),
            (self.max_delete, 1, 50000),
            (self.deadline_seconds, 30, 480),
        ):
            if type(value) is not int or not low <= value <= high:
                raise ValueError("invalid retention bound")


def cutoff_at(now, prior_days):
    if now.tzinfo is None:
        raise ValueError("UTC-aware time required")
    return now.astimezone(UTC).replace(
        hour=0, minute=0, second=0, microsecond=0
    ) - timedelta(days=prior_days)


def expired(obj, cutoff):
    match = PART.fullmatch(obj.get("Key", ""))
    if not match:
        return False
    try:
        partition = datetime.strptime(match[2], "%Y-%m-%d").replace(tzinfo=UTC)
        modified = obj["LastModified"]
        size = obj["Size"]
        return (
            partition < cutoff
            and modified.tzinfo is not None
            and modified < cutoff
            and type(size) is int
            and size >= 0
        )
    except (KeyError, ValueError, AttributeError, TypeError):
        return False


def maintain(client, policy, *, execute=False, now=None, clock=time.monotonic):
    policy.validate()
    started = clock()
    cutoff = cutoff_at(now or datetime.now(UTC), policy.prior_days)
    stats = {
        "status": "planned",
        "execute": execute,
        "cutoff": cutoff.isoformat(),
        "scanned": 0,
        "eligible": 0,
        "eligibleBytes": 0,
        "selected": 0,
        "selectedBytes": 0,
        "deleted": 0,
        "deletedBytes": 0,
    }

    def budget():
        if clock() - started >= policy.deadline_seconds:
            raise TimeoutError("retention deadline")

    # Versioned buckets need a separate lifecycle design; delete markers do not free data.
    budget()
    if client.get_bucket_versioning(Bucket=BUCKET).get("Status"):
        raise ValueError("versioned bucket unsupported")

    def candidates():
        for prefix in PREFIXES:
            token = None
            while True:
                budget()
                request = {"Bucket": BUCKET, "Prefix": prefix, "MaxKeys": 1000}
                if token:
                    request["ContinuationToken"] = token
                page = client.list_objects_v2(**request)
                for obj in page.get("Contents", []):
                    stats["scanned"] += 1
                    if stats["scanned"] > policy.max_scan:
                        raise ValueError("listing limit exceeded")
                    if not obj.get("Key", "").startswith(prefix):
                        raise ValueError("unexpected listing prefix")
                    if expired(obj, cutoff):
                        stats["eligible"] += 1
                        stats["eligibleBytes"] += obj["Size"]
                        yield (obj["Key"], obj["Size"])
                if not page.get("IsTruncated", False):
                    break
                following = page.get("NextContinuationToken")
                if not following or following == token:
                    raise ValueError("incomplete listing")
                token = following

    # Finish every listing before the first delete, keeping at most max_delete candidates.
    selected = heapq.nsmallest(policy.max_delete, candidates())
    budget()
    stats.update(
        selected=len(selected),
        selectedBytes=sum(size for _, size in selected),
        limitReached=stats["eligible"] > len(selected),
    )
    print(json.dumps(stats, sort_keys=True), flush=True)
    if not execute:
        return stats

    def recheck(item):
        budget()
        key, _ = item
        obj = client.head_object(Bucket=BUCKET, Key=key)
        if expired(dict(Key=key, Size=obj["ContentLength"], **obj), cutoff):
            return key, obj["ContentLength"]
        return None

    # HEAD is network-bound. Four read workers keep large historical passes bounded
    # without issuing concurrent deletes or flooding the single-node lake.
    with ThreadPoolExecutor(max_workers=4) as workers:
        for offset in range(0, len(selected), 500):
            budget()
            batch = selected[offset : offset + 500]
            checked = [obj for obj in workers.map(recheck, batch) if obj is not None]
            if not checked:
                continue
            budget()
            result = client.delete_objects(
                Bucket=BUCKET,
                Delete={
                    "Objects": [{"Key": key} for key, _ in checked],
                    "Quiet": False,
                },
            )
            acknowledged = {item["Key"] for item in result.get("Deleted", [])}
            if result.get("Errors") or acknowledged != {key for key, _ in checked}:
                raise RuntimeError("incomplete deletion")
            stats["deleted"] += len(checked)
            stats["deletedBytes"] += sum(size for _, size in checked)
            stats["status"] = "deleting"
            print(json.dumps(stats, sort_keys=True), flush=True)
    stats.update(status="completed", durationSeconds=round(clock() - started, 3))
    print(json.dumps(stats, sort_keys=True), flush=True)
    return stats


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--execute", action="store_true", help="delete reviewed expired files"
    )
    args = parser.parse_args()
    try:
        endpoint = os.environ["S3_ENDPOINT"]
        if endpoint != "http://vehicle-lake:8333":
            raise ValueError("unexpected lake endpoint")
        policy = Policy(
            prior_days=int(os.environ.get("RETAIN_PRIOR_UTC_DAYS", "3")),
            max_scan=int(os.environ.get("MAX_SCAN_OBJECTS", "150000")),
            max_delete=int(os.environ.get("MAX_DELETE_OBJECTS", "10000")),
            deadline_seconds=int(os.environ.get("DEADLINE_SECONDS", "240")),
        )
        policy.validate()
        client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=os.environ["S3_ACCESS_KEY"],
            aws_secret_access_key=os.environ["S3_SECRET_KEY"],
            config=Config(
                connect_timeout=3,
                read_timeout=10,
                retries={"total_max_attempts": 2, "mode": "standard"},
                s3={"addressing_style": "path"},
                request_checksum_calculation="when_required",
                response_checksum_validation="when_required",
            ),
        )
        maintain(client, policy, execute=args.execute)
    except (
        BotoCoreError,
        ClientError,
        KeyError,
        OSError,
        RuntimeError,
        TypeError,
        ValueError,
    ) as error:
        # SDK messages can contain object names, URLs or credentials; emit only the type.
        print(
            json.dumps({"status": "failed", "errorType": type(error).__name__}),
            flush=True,
        )
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
