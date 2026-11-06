"""Internal backlog: bounded/owned exec, real evidence and legacy restoration."""

import json
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from api_control import EMQX_WORKER_IMAGE, worker_manifest
from emqx_executor import EMQX_IMAGE, GATE_MODE, EmqxGate, command, exec_in_cluster
from fault_runtime import SCENARIOS, FaultRuntime
from kube_api import ControlError


def pod():
    return {
        "metadata": {
            "name": "vehicle-emqx-test-pod",
            "uid": "original",
            "labels": {"app": "vehicle-emqx"},
        },
        "spec": {
            "hostname": "vehicle-emqx",
            "containers": [{"name": "emqx", "image": EMQX_IMAGE}],
        },
        "status": {"conditions": [{"type": "Ready", "status": "True"}]},
    }


class GateTests(unittest.TestCase):
    def setUp(self):
        self.api = Mock(before_write=Mock())
        self.api.list.return_value = [pod()]
        self.api.can.return_value = True
        self.op = {
            "id": "a" * 32,
            "deadline": time.time() + 60,
            "emqxGateMode": GATE_MODE,
        }
        self.result = {
            "ok": True,
            "queued": 0,
            "gated": False,
            "window": 0,
            "operation": "",
            "deadline": 0,
            "producer": "<0.100.0>",
        }
        self.execute = Mock(
            side_effect=lambda *_: (
                "VEHICLE_EMQX_GATE=" + json.dumps(self.result) + "\nok\n"
            )
        )
        self.gate = EmqxGate(self.api, self.execute)
        self.op["emqxTarget"] = self.gate.prepare(self.op)

    def test_prepare_is_read_only_and_exact_pod_scoped(self):
        self.api.before_write.assert_not_called()
        self.api.can.assert_called_with("", "pods/exec", "get", "vehicle-emqx-test-pod")
        self.assertEqual(self.op["emqxTarget"]["uid"], "original")

    def test_inject_requires_actual_owned_gate_and_exact_deadline(self):
        with self.assertRaisesRegex(ControlError, "EMQX_GATE_CONTRACT_FAILED"):
            self.gate.call("inject", self.op)
        self.result.update(
            gated=True,
            window=-1,
            operation=self.op["id"],
            deadline=int(self.op["deadline"] * 1000),
        )
        self.assertTrue(self.gate.call("inject", self.op)["gated"])
        self.api.before_write.assert_called()
        self.result["deadline"] += 1000
        with self.assertRaises(ControlError):
            self.gate.call("inject", self.op)

    def test_replaced_or_unpinned_pod_rejected_before_exec(self):
        for change in ("uid", "image", "ready"):
            changed = pod()
            if change == "uid":
                changed["metadata"]["uid"] = "replacement"
            elif change == "image":
                changed["spec"]["containers"][0]["image"] = "emqx:latest"
            else:
                changed["status"]["conditions"] = []
            self.api.list.return_value = [changed]
            self.execute.reset_mock()
            with self.assertRaises(ControlError):
                self.gate.call("inject", self.op)
            self.execute.assert_not_called()

    def test_permission_and_lease_rejected_before_mutation(self):
        self.api.can.return_value = False
        self.execute.reset_mock()
        with self.assertRaisesRegex(ControlError, "EMQX_EXECUTOR_NOT_CONFIGURED"):
            self.gate.call("inject", self.op)
        self.execute.assert_not_called()
        self.api.can.return_value = True
        self.api.before_write.side_effect = ControlError("WORKER_LEASE_LOST")
        with self.assertRaisesRegex(ControlError, "WORKER_LEASE_LOST"):
            self.gate.call("inject", self.op)
        self.execute.assert_not_called()

    def test_no_arbitrary_operation_or_action_and_no_secret_error_output(self):
        for action, op in [
            ("anything", self.op),
            ("inject", dict(self.op, id='a";bad')),
        ]:
            with self.assertRaises(ControlError):
                command(action, op)
        self.execute.side_effect = None
        self.execute.return_value = "private-runtime-state-and-cookie"
        with self.assertRaisesRegex(ControlError, "^EMQX_GATE_CONTRACT_FAILED$"):
            self.gate.call("status", self.op)

    def test_restore_requires_open_window(self):
        self.result.update(gated=True, window=-1)
        with self.assertRaises(ControlError):
            self.gate.call("restore", self.op)

    def test_new_worker_uses_pinned_executor_without_app_credentials(self):
        spec = worker_manifest(self.op, "legacy-control")["spec"]["template"]["spec"]
        container = spec["containers"][0]
        self.assertEqual(container["image"], EMQX_WORKER_IMAGE)
        self.assertNotIn("envFrom", container)
        self.assertTrue(
            all("secretKeyRef" not in x.get("valueFrom", {}) for x in container["env"])
        )
        legacy = worker_manifest(
            {"id": "b" * 32, "scenario": "emqx_backlog"}, "legacy-control"
        )
        self.assertEqual(
            legacy["spec"]["template"]["spec"]["containers"][0]["image"],
            "legacy-control",
        )

    def test_native_queue_evidence_requires_this_gate(self):
        runtime = FaultRuntime(self.api, Mock(), Mock())
        runtime.capture_emqx_queue(
            self.op, {"queued": 10, "gated": False, "operation": ""}
        )
        self.assertNotIn("observedAt", self.op["emqxEvidence"])
        runtime.capture_emqx_queue(
            self.op, {"queued": 10, "gated": True, "operation": "b" * 32}
        )
        self.assertNotIn("observedAt", self.op["emqxEvidence"])
        runtime.capture_emqx_queue(
            self.op, {"queued": 10, "gated": True, "operation": self.op["id"]}
        )
        runtime.capture_emqx_queue(
            self.op, {"queued": 5, "gated": True, "operation": self.op["id"]}
        )
        self.assertEqual(self.op["emqxEvidence"]["peakQueued"], 10)
        self.assertEqual(len(self.op["history"]), 1)

    def test_new_injection_persists_target_before_gate_and_never_scales_kafka(self):
        runtime = FaultRuntime(self.api, Mock(), Mock())
        runtime.patch_field = Mock()
        runtime.jobs_running = Mock(return_value=False)
        op = dict(
            self.op,
            phase="injecting",
            scenario="emqx_backlog",
            cronUid="cron",
            originalSuspend=False,
        )
        op.pop("emqxTarget")
        with patch("fault_runtime.EmqxGate") as gate:
            gate.return_value.prepare.return_value = self.op["emqxTarget"]
            runtime.step(op)
            self.assertEqual(op["emqxTarget"], self.op["emqxTarget"])
            self.assertEqual(op["phase"], "injecting")
            gate.return_value.call.assert_not_called()
            gate.return_value.call.return_value = {
                "queued": 2,
                "gated": True,
                "operation": op["id"],
            }
            runtime.step(op)
            self.assertEqual(op["phase"], "active")
        self.assertTrue(
            all(c.args[0] == "cronjob" for c in runtime.patch_field.call_args_list)
        )
        self.assertIsNone(SCENARIOS["emqx_backlog"]["target"])

    def test_legacy_kafka_operations_still_restore_original_replicas(self):
        runtime = FaultRuntime(self.api, Mock(), Mock())
        runtime.patch_field = Mock()
        old = {
            "scenario": "emqx_backlog",
            "target": "vehicle-kafka",
            "targetUid": "old",
            "originalReplicas": 1,
        }
        with patch("fault_runtime.EmqxGate") as gate:
            runtime.restore_resources(old)
            gate.assert_not_called()
        runtime.patch_field.assert_called_once_with(
            "deployment", "vehicle-kafka", "old", "replicas", 0, 1
        )

    def test_expired_operation_restores_without_injecting(self):
        runtime = FaultRuntime(self.api, Mock(), Mock())
        runtime.recovery_step = Mock()
        op = dict(
            self.op,
            phase="injecting",
            scenario="emqx_backlog",
            deadline=time.time() - 1,
        )
        with patch("fault_runtime.EmqxGate") as gate:
            runtime.step(op)
            gate.assert_not_called()
        self.assertEqual(op["phase"], "recovering")
        runtime.recovery_step.assert_called_once()

    def test_unobserved_backlog_cannot_start_recovery_summary(self):
        import test_spark_queue

        fixture = test_spark_queue.SparkQueueTests()
        fixture.setUp()
        runtime, data = fixture.runtime, fixture.data
        runtime.jobs_running.return_value = False
        data["components"][0]["payload"]["success"] = 1
        data["components"][1]["payload"]["lastCheckpointAt"] = time.time() * 1000
        op = dict(
            self.op,
            scenario="emqx_backlog",
            resourcesResumed=True,
            recoverAt=time.time() - 1,
            recoveryJob="recovery",
            before={"brokerDropped": 0, "brokerInstance": "broker", "brokerSuccess": 0},
        )
        with self.assertRaisesRegex(
            runtime.OperationError, "EMQX_BACKLOG_NOT_OBSERVED"
        ):
            runtime.recovery_step(op)
        runtime.create_summary.assert_not_called()
        op["emqxEvidence"] = {"observedAt": time.time(), "peakQueued": 10}
        runtime.recovery_step(op)
        runtime.create_summary.assert_called_once_with(op, "recoveryJob", "normal")

    def test_executor_grant_is_one_exact_owned_pod_and_worker_only(self):
        import importlib.util

        spec = importlib.util.spec_from_file_location(
            "gate_bootstrap",
            Path(__file__).resolve().parents[1] / "bootstrap-access.py",
        )
        bootstrap = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(bootstrap)
        target = pod()
        target["metadata"]["ownerReferences"] = [
            {
                "kind": "ReplicaSet",
                "name": "owned-rs",
                "uid": "rs-uid",
                "controller": True,
            }
        ]
        deployment = {
            "metadata": {
                "uid": "deployment-uid",
                "annotations": {
                    "meta.helm.sh/release-name": "vehicle-pipeline",
                    "meta.helm.sh/release-namespace": "vehicle-pipeline",
                },
            }
        }
        rs = {
            "metadata": {
                "uid": "rs-uid",
                "ownerReferences": [{"kind": "Deployment", "uid": "deployment-uid"}],
            }
        }
        with patch.object(
            bootstrap,
            "kubectl",
            side_effect=[
                json.dumps(deployment),
                json.dumps({"items": [target]}),
                json.dumps(rs),
            ],
        ):
            objects = json.loads(bootstrap.emqx_executor_manifest())["items"]
        self.assertEqual(
            objects[0]["rules"],
            [
                {
                    "apiGroups": [""],
                    "resources": ["pods/exec"],
                    "resourceNames": [target["metadata"]["name"]],
                    "verbs": ["get"],
                }
            ],
        )
        self.assertEqual(
            objects[1]["subjects"],
            [
                {
                    "kind": "ServiceAccount",
                    "name": "vehicle-demo-fault-worker",
                    "namespace": "vehicle-pipeline",
                }
            ],
        )

    def test_websocket_channels_require_success_and_suppress_stderr(self):
        import websocket

        self.api.origin = "https://cluster:6443"
        self.api.path.return_value = "/api/v1/namespaces/vehicle-pipeline/pods/fixed"
        self.api.token_file.read_text.return_value = "private-test-token"
        sock = Mock()
        sock.getsubprotocol.return_value = "v4.channel.k8s.io"
        sock.recv.side_effect = [
            b"\x02private-error",
            b"\x01safe-output",
            b'\x03{"status":"Success"}',
        ]
        with patch.object(websocket, "create_connection", return_value=sock) as connect:
            self.assertEqual(
                exec_in_cluster(self.api, "fixed", ["fixed-command"]), "safe-output"
            )
        self.assertIs(connect.call_args.kwargs["sslopt"]["context"], self.api.tls)
        sock.close.assert_called_once()
        sock.recv.side_effect = [b'\x03{"status":"Failure","message":"private"}']
        with (
            patch.object(websocket, "create_connection", return_value=sock),
            self.assertRaisesRegex(ControlError, "^EMQX_EXEC_UNAVAILABLE$"),
        ):
            exec_in_cluster(self.api, "fixed", ["fixed-command"])


if __name__ == "__main__":
    unittest.main()
