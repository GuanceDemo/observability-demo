import json
import subprocess
import tomllib
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

import jsonschema
import pytest
import yaml

from mall_pipeline.config import Config, extraction_window
from mall_pipeline.lineage import Lineage

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = json.loads((Path(__file__).parent / "fixtures/OpenLineage-2-0-2.json").read_text())


def test_calendar_window():
    start, end = extraction_window(datetime(2026, 10, 22, 0, 1, tzinfo=UTC), 7)
    assert start == datetime(2026, 10, 15, 16)
    assert end == datetime(2026, 10, 22, 0, 1)
    with pytest.raises(ValueError):
        extraction_window(datetime(2026, 10, 22), 7)


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://example.org",
        "https://user:secret@example.org",
        "https://example.org?token=secret",
        "https://example.org/path",
        "https://example.org/#fragment",
    ],
)
def test_reject_secret_bearing_or_insecure_origins(endpoint):
    with pytest.raises(ValueError):
        Config("db", "user", "password", "token", endpoint=endpoint)


def test_config_redaction_and_identifiers(config):
    assert "private-test" not in repr(config)
    with pytest.raises(ValueError):
        Config("db", "user", "password", "token", source_schema="db`; DROP TABLE x")
    with pytest.raises(ValueError):
        Config("db", "user", "password", "token", analytics_schema="selfheal")


def test_official_event_schema_and_connected_identities(config):
    lineage = Lineage(config)
    catalog = [json.loads(p) for p in lineage.catalog()]
    assert len([e for e in catalog if "dataset" in e]) == 3
    run_id = str(uuid4())
    runs = [
        json.loads(lineage.run("orders_clean", run_id, s, input_count=8, output_count=3))
        for s in ("START", "COMPLETE")
    ]
    for event in [*catalog, *runs]:
        jsonschema.Draft202012Validator(SCHEMA).validate(event)
        assert "private-test" not in json.dumps(event)
        assert "user_id" not in json.dumps(event)
    assert UUID(runs[0]["run"]["runId"]).version == 4
    assert runs[0]["run"]["runId"] == runs[1]["run"]["runId"]
    jobs = [e for e in catalog if "job" in e]
    assert jobs[0]["outputs"][0]["name"] == jobs[1]["inputs"][0]["name"]
    assert runs[1]["outputs"][0]["outputFacets"]["outputStatistics"]["rowCount"] == 3
    assert runs[1]["inputs"][0]["inputFacets"]["inputStatistics"]["rowCount"] == 8


def test_chart_security_schedule_and_version():
    rendered = subprocess.check_output(
        ["helm", "template", "mall-data", str(ROOT / "charts/data-observability-demo")], text=True
    )
    cron = yaml.safe_load(rendered)
    assert cron["spec"]["suspend"] is True
    assert cron["spec"]["concurrencyPolicy"] == "Forbid"
    job = cron["spec"]["jobTemplate"]["spec"]
    assert job["backoffLimit"] == 0
    pod = job["template"]["spec"]
    assert pod["automountServiceAccountToken"] is False
    container = pod["containers"][0]
    assert container["args"] == ["--mode", "normal"]
    assert container["securityContext"]["readOnlyRootFilesystem"] is True
    env = {v["name"]: v for v in container["env"]}
    for key in ("MYSQL_PASSWORD", "OPENLINEAGE_TOKEN"):
        assert "secretKeyRef" in env[key]["valueFrom"]
        assert "value" not in env[key]
    chart = yaml.safe_load((ROOT / "charts/data-observability-demo/Chart.yaml").read_text())
    project = tomllib.loads((ROOT / "data-pipeline/pyproject.toml").read_text())
    assert chart["version"] == chart["appVersion"] == project["project"]["version"]
    assert container["image"].endswith(":" + chart["appVersion"])
    lock = tomllib.loads((ROOT / "data-pipeline/uv.lock").read_text())
    locked_project = next(p for p in lock["package"] if p["name"] == "mall-data-pipeline")
    assert locked_project["version"] == chart["appVersion"]
