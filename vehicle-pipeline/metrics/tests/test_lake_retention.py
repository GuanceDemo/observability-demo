"""Retention regression tests: state safety and bounded, fail-closed deletion."""

import importlib.util
import sys
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

import pytest

SOURCE = Path(__file__).resolve().parents[2] / "deploy/chart/files/lake-retention.py"
SPEC = importlib.util.spec_from_file_location("lake_retention", SOURCE)
retention = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = retention
SPEC.loader.exec_module(retention)
NOW = datetime(2026, 11, 23, 1, tzinfo=UTC)
OLD = datetime(2026, 11, 19, tzinfo=UTC)


def part(key="clean/2026-11-19/01/part-abc-0.parquet", modified=OLD):
    return {"Key": key, "Size": 123, "LastModified": modified}


class Lake:
    def __init__(self, objects=(), *, pages=None, version=None):
        self.objects = {obj["Key"]: obj for obj in objects}
        self.pages = pages or {}
        self.version = version
        self.listed = []
        self.deleted = []
        self.head_overrides = {}
        self.errors = False

    def get_bucket_versioning(self, **kwargs):
        assert kwargs == {"Bucket": "vehicle-lake"}
        return {"Status": self.version} if self.version else {}

    def list_objects_v2(self, **kwargs):
        assert kwargs["Bucket"] == "vehicle-lake"
        prefix = kwargs["Prefix"]
        self.listed.append(prefix)
        if prefix in self.pages:
            return self.pages[prefix]
        return {"Contents": [obj for key, obj in self.objects.items() if key.startswith(prefix)]}

    def head_object(self, *, Bucket, Key):
        obj = self.head_overrides.get(Key, self.objects[Key])
        return {"ContentLength": obj["Size"], "LastModified": obj["LastModified"]}

    def delete_objects(self, *, Bucket, Delete):
        assert set(self.listed) == set(retention.PREFIXES)
        assert len(Delete["Objects"]) <= 500
        if self.errors:
            return {"Errors": [{"Code": "AccessDenied"}]}
        for item in Delete["Objects"]:
            self.deleted.append(item["Key"])
            del self.objects[item["Key"]]
        return {"Deleted": Delete["Objects"]}


def test_utc_cutoff_preserves_current_and_three_prior_days():
    shanghai = timezone(timedelta(hours=8))
    assert retention.cutoff_at(datetime(2026, 11, 23, 0, 1, tzinfo=shanghai), 3) == datetime(
        2026, 11, 19, tzinfo=UTC
    )
    cutoff = retention.cutoff_at(NOW, 3)
    assert cutoff == datetime(2026, 11, 20, tzinfo=UTC)
    assert retention.expired(part(), cutoff)
    assert not retention.expired(part("clean/2026-11-20/00/part-abc-0.parquet"), cutoff)
    assert not retention.expired(part(modified=cutoff), cutoff)


@pytest.mark.parametrize(
    "key",
    [
        "checkpoints/2026-11-19/01/part-abc-0.parquet",
        "ha/2026-11-19/01/part-abc-0.parquet",
        "savepoints/2026-11-19/01/part-abc-0.parquet",
        "clean/2026-11-19/01/.part-abc-0.parquet.inprogress.123",
        "clean/2026-11-19/01/part-abc-0.parquet.inprogress",
        "clean/2026-02-30/01/part-abc-0.parquet",
        "clean/2026-11-19/24/part-abc-0.parquet",
        "clean/2026-11-19/01/sub/part-abc-0.parquet",
        "clean/2026-11-19/01/part-../metadata.parquet",
        "clean/2026-11-19/01/part-abc-0.parquet\n",
    ],
)
def test_never_select_state_pending_or_malformed_paths(key):
    assert not retention.expired(part(key), retention.cutoff_at(NOW, 3))


def test_dry_run_and_execute_use_same_allowlist_and_are_idempotent():
    objects = [part(), part("anomalies/2026-11-19/00/part-abc-1.parquet")]
    lake = Lake(objects)
    preview = retention.maintain(lake, retention.Policy(), now=NOW)
    assert preview["selected"] == 2
    assert not lake.deleted
    actual = retention.maintain(lake, retention.Policy(), execute=True, now=NOW)
    assert actual["deleted"] == 2 and actual["deletedBytes"] == 246
    assert retention.maintain(lake, retention.Policy(), execute=True, now=NOW)["deleted"] == 0
    assert set(lake.listed) == set(retention.PREFIXES)


def test_old_date_new_write_survives_recheck():
    obj = part()
    lake = Lake([obj])
    lake.head_overrides[obj["Key"]] = part(modified=NOW)
    assert retention.maintain(lake, retention.Policy(), execute=True, now=NOW)["deleted"] == 0


def test_scan_overflow_deletes_nothing():
    lake = Lake([part(), part("quarantine/2026-11-18/00/part-abc-1.parquet")])
    with pytest.raises(ValueError, match="listing limit"):
        retention.maintain(lake, retention.Policy(max_scan=1), execute=True, now=NOW)
    assert not lake.deleted


@pytest.mark.parametrize(
    "page",
    [
        {"Contents": [part()], "IsTruncated": True},
        {"Contents": [part("checkpoints/2026-11-19/00/part-abc-0.parquet")]},
    ],
)
def test_incomplete_or_wrong_prefix_listing_deletes_nothing(page):
    lake = Lake(pages={"clean/": page})
    with pytest.raises(ValueError):
        retention.maintain(lake, retention.Policy(), execute=True, now=NOW)
    assert not lake.deleted


def test_all_pages_listed_before_deletion():
    lake = Lake([part()])
    original = lake.list_objects_v2

    def paged(**kwargs):
        if kwargs["Prefix"] == "clean/" and "ContinuationToken" not in kwargs:
            lake.listed.append("clean/")
            return {"Contents": [], "IsTruncated": True, "NextContinuationToken": "next"}
        return original(**kwargs)

    lake.list_objects_v2 = paged
    assert retention.maintain(lake, retention.Policy(), execute=True, now=NOW)["deleted"] == 1


def test_bounded_batches_and_delete_cap():
    lake = Lake([part(f"clean/2026-11-19/01/part-abc-{i:04d}.parquet") for i in range(1002)])
    result = retention.maintain(lake, retention.Policy(max_delete=1001), execute=True, now=NOW)
    assert result["deleted"] == 1001 and result["limitReached"]
    assert len(lake.objects) == 1


def test_delete_error_is_failure():
    lake = Lake([part()])
    lake.errors = True
    with pytest.raises(RuntimeError, match="incomplete deletion"):
        retention.maintain(lake, retention.Policy(), execute=True, now=NOW)


def test_failed_head_preserves_entire_current_batch():
    lake = Lake([part(), part("clean/2026-11-19/01/part-abc-1.parquet")])

    def unavailable(**kwargs):
        raise OSError("unavailable")

    lake.head_object = unavailable
    with pytest.raises(OSError):
        retention.maintain(lake, retention.Policy(), execute=True, now=NOW)
    assert not lake.deleted


def test_deadline_before_delete_is_failure():
    lake = Lake([part()])
    times = iter([0, 0, 0, 0, 241])
    with pytest.raises(TimeoutError):
        retention.maintain(
            lake, retention.Policy(), execute=True, now=NOW, clock=lambda: next(times)
        )
    assert not lake.deleted


@pytest.mark.parametrize("version", ["Enabled", "Suspended"])
def test_versioned_bucket_is_rejected(version):
    lake = Lake([part()], version=version)
    with pytest.raises(ValueError, match="versioned"):
        retention.maintain(lake, retention.Policy(), execute=True, now=NOW)
    assert not lake.listed and not lake.deleted


@pytest.mark.parametrize(
    "policy", [retention.Policy(prior_days=0), retention.Policy(max_delete=50001)]
)
def test_invalid_policy_fails_before_listing(policy):
    lake = Lake()
    with pytest.raises(ValueError):
        retention.maintain(lake, policy, execute=True, now=NOW)
    assert not lake.listed
