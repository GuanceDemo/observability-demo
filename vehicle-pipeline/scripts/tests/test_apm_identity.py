import copy
import importlib.util
import json
import subprocess
import threading
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import urlopen

import pytest
import yaml

PATH = Path(__file__).parents[2] / "deploy/chart/files/apm-identity.py"
spec = importlib.util.spec_from_file_location("apm_identity", PATH)
identity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(identity)
AT = 1795424400000000


def pod(app="vehicle-flink-taskmanager", name=None, ip="10.1.2.3", **metadata):
    return {
        "metadata": {
            "namespace": "vehicle-pipeline", "name": name or app + "-abcdef-12345",
            "uid": "00000000-0000-4000-8000-000000000001",
            "labels": {"app": app}, "creationTimestamp": "2026-11-23T09:00:00Z",
            "ownerReferences": [{"controller": True, "kind": "Job" if app == "vehicle-summary"
                                 else "ReplicaSet", "name": app + "-abcdef"}], **metadata,
        },
        "spec": {"nodeName": "cn-shenzhen.10.187.217.80"},
        "status": {"phase": "Running", "podIP": ip},
    }


def test_actual_node_and_exact_instance_preserve_native_broker_identity():
    cache = identity.PodCache("vehicle-pipeline")
    flink, emqx = pod(), pod("vehicle-emqx", ip="10.1.2.4")
    cache.replace({"items": [flink, emqx]})
    value = cache.resolve("vehicle-flink-consumer", flink["metadata"]["name"], "10.1.2.3", AT)
    assert value == {"resource_identity": "kubernetes_pod", "host": "cn-shenzhen.10.187.217.80",
                     "pod_name": flink["metadata"]["name"], "pod_namespace": "vehicle-pipeline",
                     "pod_uid": flink["metadata"]["uid"], "pod_ip": "10.1.2.3"}
    assert cache.resolve("emqx", "emqx@vehicle-emqx", "10.1.2.4", AT)["pod_name"] == emqx["metadata"]["name"]
    for instance, ip in [("other-pod", "10.1.2.3"), (flink["metadata"]["name"], "10.1.2.4")]:
        assert cache.resolve("vehicle-flink-consumer", instance, ip, AT) == {"resource_identity": "unknown"}


def test_android_missing_stale_ambiguous_and_reused_ip_never_get_receiver_host():
    now = [0]
    cache = identity.PodCache("vehicle-pipeline", clock=lambda: now[0])
    assert cache.resolve(identity.ANDROID, "", "10.1.2.3", AT) == {"resource_identity": "not_applicable"}
    assert cache.resolve("emqx", "", "10.1.2.4", AT) == {"resource_identity": "unknown"}
    broker = pod("vehicle-emqx", ip="10.1.2.4")
    cache.replace({"items": [broker]})
    assert cache.ready()
    assert "host" not in cache.resolve("emqx", "", "10.1.2.4", AT - 1)
    cache.replace({"items": [broker, copy.deepcopy(broker)]})
    assert "host" not in cache.resolve("emqx", "", "10.1.2.4", AT)
    cache.replace({"items": [broker]})
    now[0] = 31
    assert not cache.ready()
    assert "host" not in cache.resolve("emqx", "", "10.1.2.4", AT)
    assert "host" not in cache.resolve("emqx", "", "not-an-ip", AT)


def test_completed_spark_and_deleted_pod_lifetime_and_ownership():
    cache = identity.PodCache("vehicle-pipeline")
    spark = pod("vehicle-summary")
    spark["status"].update(phase="Succeeded", containerStatuses=[{
        "state": {"terminated": {"finishedAt": "2026-11-23T09:01:00Z"}}}])
    cache.replace({"items": [spark]})
    args = ("vehicle-spark-summary", spark["metadata"]["name"], "10.1.2.3")
    assert cache.resolve(*args, AT)["pod_uid"] == spark["metadata"]["uid"]
    assert "host" not in cache.resolve(*args, AT + 60_000_000)
    for mutate in [lambda p: p["metadata"].update(namespace="other"),
                   lambda p: p["spec"].update(nodeName=""),
                   lambda p: p["metadata"].update(ownerReferences=[]),
                   lambda p: p["metadata"].update(deletionTimestamp="2026-11-23T09:00:00Z")]:
        invalid = copy.deepcopy(spark)
        mutate(invalid)
        cache.replace({"items": [invalid]})
        assert "host" not in cache.resolve(*args, AT)
    with pytest.raises(ValueError):
        cache.replace({"items": [], "metadata": {"continue": "next-page"}})
    with pytest.raises(ValueError):
        cache.replace({"items": [spark] * 513})


def test_loopback_http_validation_and_expired_health():
    cache = identity.PodCache("vehicle-pipeline")
    server = identity.ThreadingHTTPServer(("127.0.0.1", 0), identity.handler(cache))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    query = f"service=emqx&instance=emqx@vehicle-emqx&ip=10.1.2.3&start={AT}"
    try:
        with pytest.raises(HTTPError) as error:
            urlopen(base + "/healthz", timeout=2)
        assert error.value.code == 503
        cache.replace({"items": [pod("vehicle-emqx")]})
        with urlopen(base + "/identity?" + query, timeout=2) as response:
            assert json.load(response)["resource_identity"] == "kubernetes_pod"
        for suffix in [query + "&x=1", query + "&service=emqx", query.replace(str(AT), "1"),
                       query.replace("emqx@vehicle-emqx", "bad%26instance"), "service=foreign"]:
            with pytest.raises(HTTPError) as error:
                urlopen(base + "/identity?" + suffix, timeout=2)
            assert error.value.code == 400
    finally:
        server.shutdown()
        server.server_close()


def render(identity_enabled, correlation=False):
    result = subprocess.check_output([
        "helm", "template", "vehicle-pipeline", str(PATH.parents[1]), "--namespace", "vehicle-pipeline",
        "--set", "apm.enabled=true", "--set", f"apm.resourceIdentityEnabled={str(identity_enabled).lower()}",
        "--set", f"apm.correlationEnabled={str(correlation).lower()}", "--set", "apm.cluster=test-cluster",
    ], text=True)
    return {x["kind"] + "/" + x["metadata"]["name"]: x for x in yaml.safe_load_all(result) if x}


def test_helm_scope_rbac_and_token_isolation_and_combined_pipeline():
    before, after = render(False), render(True)
    assert {k for k in before if before[k] != after[k]} == {"ConfigMap/vehicle-apm", "Deployment/vehicle-apm"}
    assert set(after) - set(before) == {f"{kind}/vehicle-apm-identity" for kind in
                                      ("ConfigMap", "ServiceAccount", "Role", "RoleBinding")}
    assert after["Role/vehicle-apm-identity"]["rules"] == [{"apiGroups": [""], "resources": ["pods"], "verbs": ["list"]}]
    pod_spec = after["Deployment/vehicle-apm"]["spec"]["template"]["spec"]
    assert pod_spec["automountServiceAccountToken"] is False
    datakit, resolver = pod_spec["containers"]
    assert "identity-api" not in {x["name"] for x in datakit["volumeMounts"]}
    assert {x["name"] for x in resolver["volumeMounts"]} == {"identity", "identity-api"}
    assert resolver["readinessProbe"]["timeoutSeconds"] == 5
    assert len([x for x in datakit["volumeMounts"] if x["name"] == "identity"]) == 4
    combined = render(True, True)
    script = combined["ConfigMap/vehicle-apm-identity"]["data"]["enrichment.p"]
    assert "drop_key(host)" in script and "18093/identity" in script and "18092/context" in script
    mounts = combined["Deployment/vehicle-apm"]["spec"]["template"]["spec"]["containers"][0]["volumeMounts"]
    assert len({m["mountPath"] for m in mounts}) == len(mounts)
