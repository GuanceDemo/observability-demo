import copy
import importlib.util
from pathlib import Path

import pytest

SOURCE = Path(__file__).resolve().parents[2] / "deploy/chart/files/lake-vacuum-policy.py"
SPEC = importlib.util.spec_from_file_location("lake_vacuum_policy", SOURCE)
vacuum = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(vacuum)


def config():
    return {
        "job_type": "vacuum",
        "descriptor_version": 1,
        "admin_runtime": {
            "enabled": True,
            "detection_interval_minutes": 17,
            "global_execution_concurrency": 16,
            "per_worker_execution_concurrency": 4,
            "retry_limit": 1,
        },
        "worker_config_values": {"garbage_threshold": {"double_value": 0.3}},
        "admin_config_values": {"collection_filter": {"string_value": ""}},
        "updated_at": "2026-10-27T00:00:00Z",
    }


def test_plugin_policy_overrides_persisted_scheduler_without_clearing_other_settings():
    original = config()
    actual = vacuum.desired(original, 120, 0.1)
    assert original["admin_runtime"]["detection_interval_minutes"] == 17
    assert actual["admin_runtime"]["detection_interval_minutes"] == 2
    assert actual["admin_runtime"]["global_execution_concurrency"] == 1
    assert actual["admin_runtime"]["per_worker_execution_concurrency"] == 1
    assert actual["admin_runtime"]["retry_limit"] == 1
    assert actual["worker_config_values"]["garbage_threshold"] == {"double_value": 0.1}
    assert actual["admin_config_values"] == original["admin_config_values"]


def test_reconcile_persists_readback_and_next_iteration_is_noop():
    stored = config()
    requests = []

    def api(method, payload=None):
        nonlocal stored
        requests.append(method)
        if method == "PUT":
            assert "updated_at" not in payload
            stored = copy.deepcopy(payload)
        return copy.deepcopy(stored)

    assert vacuum.reconcile(120, 0.1, api)
    assert requests == ["GET", "PUT", "GET"]
    assert not vacuum.reconcile(120, 0.1, api)
    assert requests == ["GET", "PUT", "GET", "GET"]


def test_reconcile_rejects_failed_persistence_readback():
    def api(method, payload=None):
        return config()

    with pytest.raises(RuntimeError, match="readback mismatch"):
        vacuum.reconcile(120, 0.1, api)


def test_wrong_plugin_is_never_written():
    methods = []

    def api(method, payload=None):
        methods.append(method)
        return {"job_type": "erasure_coding"}

    with pytest.raises(ValueError):
        vacuum.reconcile(120, 0.1, api)
    assert methods == ["GET"]


@pytest.mark.parametrize("interval,threshold", [(17, 0.1), (90, 0.1), (120, 0), (120, 1)])
def test_invalid_policy_rejected(interval, threshold):
    with pytest.raises(ValueError):
        vacuum.desired(config(), interval, threshold)
