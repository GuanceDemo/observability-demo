import importlib.util
import json
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/data-observability-bootstrap.py"
spec = importlib.util.spec_from_file_location("bootstrap", SCRIPT)
bootstrap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bootstrap)


def prepare(monkeypatch, existing="", users="0"):
    calls = []

    def kubectl(args, data=None):
        calls.append((args, data))
        if "ds" in args:
            return json.dumps(
                {
                    "spec": {
                        "template": {
                            "spec": {
                                "containers": [
                                    {
                                        "env": [
                                            {
                                                "name": "ENV_DATAWAY",
                                                "value": "https://example.invalid?token=test-token",
                                            }
                                        ]
                                    }
                                ]
                            }
                        }
                    }
                }
            )
        if "get" in args:
            return existing
        if data and data.startswith("SELECT COUNT"):
            return users
        return ""

    monkeypatch.setattr(bootstrap, "kubectl", kubectl)
    monkeypatch.setattr(bootstrap.secrets, "token_hex", lambda count: "a" * 48)
    monkeypatch.setattr("sys.argv", ["bootstrap", "--from-datakit"])
    return calls


def test_bootstrap_persists_secret_before_sql_and_redacts_output(monkeypatch, capsys):
    calls = prepare(monkeypatch)
    bootstrap.main()
    secret_idx = next(i for i, (a, _) in enumerate(calls) if "apply" in a)
    sql_idx = next(i for i, (_, d) in enumerate(calls) if d and "CREATE DATABASE" in d)
    assert secret_idx < sql_idx
    assert "--server-side" in calls[secret_idx][0]
    assert "GRANT SELECT ON selfheal.demo_orders" in calls[sql_idx][1]
    assert "DROP" not in calls[sql_idx][1]
    assert "a" * 48 not in " ".join(calls[sql_idx][0])
    output = capsys.readouterr().out
    assert "test-token" not in output
    assert "a" * 48 not in output


def test_bootstrap_refuses_existing_account_without_owned_secret(monkeypatch):
    calls = prepare(monkeypatch, users="1")
    with pytest.raises(ValueError, match="refusing adoption"):
        bootstrap.main()
    assert not any("apply" in a for a, _ in calls)


def test_bootstrap_refuses_unrelated_secret(monkeypatch):
    calls = prepare(monkeypatch, existing=json.dumps({"metadata": {"labels": {}}}))
    with pytest.raises(ValueError, match="not owned"):
        bootstrap.main()
    assert not any("apply" in a for a, _ in calls)
