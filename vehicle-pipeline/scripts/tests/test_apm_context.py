import importlib.util
import threading
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import urlopen

import pytest

PATH = Path(__file__).parents[2] / "deploy/chart/files/apm-context.py"
spec = importlib.util.spec_from_file_location("apm_context", PATH)
context = importlib.util.module_from_spec(spec)
spec.loader.exec_module(context)
RUN = "00000000-0000-4000-8000-000000000001"
RUN2 = "00000000-0000-4000-8000-000000000002"
AT = 1794967500000


def row(start, end, run=RUN, observed=None):
    return {
        "job_name": "vehicle_clean_and_detect",
        "run_id": run,
        "started_at": start,
        "finished_at": end,
        "updated_at": observed if observed is not None else end,
    }


def test_observed_interval_boundaries_and_actual_run_id():
    cache = context.ContextCache("cluster")
    cache.replace([row(AT, AT + 1000)])
    assert cache.context("vehicle-flink-consumer", AT * 1000)["run_id"] == RUN
    assert "run_id" not in cache.context("vehicle-flink-consumer", (AT + 1000) * 1000)
    assert "run_id" not in cache.context("vehicle-flink-consumer", (AT - 1) * 1000)


def test_running_run_is_not_extrapolated_beyond_last_engine_observation():
    cache = context.ContextCache("cluster")
    cache.replace([row(AT, None, observed=AT + 1000)])
    assert cache.context("vehicle-flink-consumer", (AT + 500) * 1000)["run_id"] == RUN
    assert "run_id" not in cache.context("vehicle-flink-consumer", (AT + 1001) * 1000)


def test_overlapping_attempts_stale_and_missing_cache_are_unknown():
    now = [0]
    cache = context.ContextCache("cluster", clock=lambda: now[0])
    assert "run_id" not in cache.context("emqx", AT * 1000)
    cache.replace([row(AT, AT + 1000), row(AT, AT + 1000, run=RUN2)])
    assert "run_id" not in cache.context("vehicle-flink-consumer", AT * 1000)
    cache.replace([row(AT, AT + 1000)])
    now[0] = 31
    assert (
        cache.context("vehicle-flink-consumer", AT * 1000)["run_correlation"]
        == "unknown"
    )


def test_android_has_pipeline_context_without_a_fabricated_lineage_job():
    cache = context.ContextCache("cluster")
    value = cache.context("vehicle-android-producer", AT * 1000)
    assert value["pipeline"] == "vehicle-telemetry"
    assert value["topic"] == "vehicle.telemetry.raw.v1"
    assert value["run_correlation"] == "not_applicable"
    assert "job_name" not in value and "run_id" not in value
    with pytest.raises(ValueError):
        context.ContextCache("")


def test_http_is_bounded_and_does_not_expose_rows_or_credentials():
    cache = context.ContextCache("cluster")
    cache.replace([row(AT, AT + 1000)])
    server = context.ThreadingHTTPServer(("127.0.0.1", 0), context.handler(cache))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = "http://127.0.0.1:" + str(server.server_port)
    try:
        with urlopen(
            base + f"/context?service=vehicle-flink-consumer&start={AT * 1000}"
        ) as response:
            body = response.read().decode()
            assert RUN in body and "password" not in body and "started_at" not in body
        for query in (
            "service=foreign&start=1",
            "service=emqx&start=1",
            "service=emqx&start=1&x=2",
        ):
            with pytest.raises(HTTPError) as error:
                urlopen(base + "/context?" + query)
            assert error.value.code == 400
    finally:
        server.shutdown()
        server.server_close()


def test_chart_opt_in_does_not_modify_business_workloads():
    import subprocess

    import yaml

    chart = str(PATH.parents[1])

    def render(enabled):
        result = subprocess.check_output(
            [
                "helm",
                "template",
                "vehicle-pipeline",
                chart,
                "--set",
                "apm.enabled=true",
                "--set",
                f"apm.correlationEnabled={str(enabled).lower()}",
                "--set",
                "apm.cluster=test-cluster",
            ],
            text=True,
        )
        return {
            x["kind"] + "/" + x["metadata"]["name"]: x
            for x in yaml.safe_load_all(result)
            if x
        }

    before, after = render(False), render(True)
    changed = {k for k in before if before[k] != after[k]}
    assert changed == {"ConfigMap/vehicle-apm", "Deployment/vehicle-apm"}
    assert set(after) - set(before) == {"ConfigMap/vehicle-apm-correlation"}
    pod = after["Deployment/vehicle-apm"]["spec"]["template"]["spec"]
    assert pod["automountServiceAccountToken"] is False
    resolver = pod["containers"][1]
    assert resolver["env"][-1]["valueFrom"]["secretKeyRef"]["key"] == "mysql-reader"
