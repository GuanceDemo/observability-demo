"""Verify the lake's effective maintenance policy and protected runtime boundary."""

import unittest
from pathlib import Path

from test_ack_chart import render

ROOT = Path(__file__).resolve().parents[4]


def named(docs, kind, name):
    return next(d for d in docs if d["kind"] == kind and d["metadata"]["name"] == name)


class LakeChartTests(unittest.TestCase):
    def test_plugin_policy_has_loopback_api_and_no_data_or_secret_access(self):
        docs = render(enabled=False)
        pod = named(docs, "Deployment", "vehicle-lake")["spec"]["template"]["spec"]
        self.assertFalse(pod["automountServiceAccountToken"])
        main, policy = pod["containers"]
        self.assertIn("-admin.ui=true", main["args"])
        env = {v["name"]: v["value"] for v in policy["env"]}
        self.assertEqual(env["VACUUM_INTERVAL_SECONDS"], "120")
        self.assertEqual(env["GARBAGE_THRESHOLD"], "0.1")
        self.assertTrue(policy["securityContext"]["readOnlyRootFilesystem"])
        self.assertIn("@sha256:", policy["image"])
        self.assertNotIn("S3_ACCESS_KEY", env)
        self.assertNotIn("/data", [v["mountPath"] for v in policy["volumeMounts"]])
        service = named(docs, "Service", "vehicle-lake")
        self.assertEqual([p["port"] for p in service["spec"]["ports"]], [8333])
        script = named(docs, "ConfigMap", "vehicle-lake-maintenance")["data"][
            "vacuum-policy.py"
        ]
        self.assertEqual(
            script,
            (
                ROOT / "vehicle-pipeline/deploy/chart/files/lake-vacuum-policy.py"
            ).read_text(),
        )

    def test_retention_opt_in_uses_bounded_non_root_no_token_job(self):
        self.assertFalse(
            any(
                d["kind"] == "CronJob"
                and d["metadata"]["name"] == "vehicle-lake-retention"
                for d in render(enabled=False)
            )
        )
        docs = render(enabled=False, **{"lake.retention.enabled": "true"})
        cron = named(docs, "CronJob", "vehicle-lake-retention")["spec"]
        self.assertEqual(cron["concurrencyPolicy"], "Forbid")
        self.assertEqual(cron["jobTemplate"]["spec"]["activeDeadlineSeconds"], 540)
        pod = cron["jobTemplate"]["spec"]["template"]["spec"]
        self.assertFalse(pod["automountServiceAccountToken"])
        self.assertTrue(pod["securityContext"]["runAsNonRoot"])
        container = pod["containers"][0]
        self.assertTrue(container["securityContext"]["readOnlyRootFilesystem"])
        self.assertIn("--execute", container["command"])
        env = {v["name"]: v for v in container["env"]}
        self.assertEqual(env["MAX_DELETE_OBJECTS"]["value"], "10000")
        self.assertEqual(env["RETAIN_PRIOR_UTC_DAYS"]["value"], "3")
        self.assertEqual(
            env["S3_SECRET_KEY"]["valueFrom"]["secretKeyRef"]["key"], "s3-writer-secret"
        )
        script = named(docs, "ConfigMap", "vehicle-lake-retention")["data"][
            "retention.py"
        ]
        self.assertEqual(
            script,
            (
                ROOT / "vehicle-pipeline/deploy/chart/files/lake-retention.py"
            ).read_text(),
        )

    def test_invalid_maintenance_settings_fail_before_rollout(self):
        for override in [
            {"metrics.image": "example.test/metrics:latest"},
            {"lake.vacuumIntervalSeconds": "90"},
            {"lake.garbageThreshold": "0"},
        ]:
            with self.subTest(override=override), self.assertRaises(ValueError):
                render(enabled=False, **override)


if __name__ == "__main__":
    unittest.main()
