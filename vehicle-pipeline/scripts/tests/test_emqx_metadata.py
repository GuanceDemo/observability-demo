import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "metadata", Path(__file__).resolve().parents[1] / "emqx-metadata.py"
)
metadata = importlib.util.module_from_spec(spec)
spec.loader.exec_module(metadata)


class BrokerLifecycleTest(unittest.TestCase):
    def test_regular_poll_preserves_run(self):
        first = metadata.lifecycle_state({}, {"matched": 10, "success": 10}, "emqx@vehicle-emqx", 500)
        later = metadata.lifecycle_state(first, {"matched": 20, "success": 19}, first["node"], 1000)
        self.assertEqual(first["epoch"], later["epoch"])

    def test_broker_restart_or_counter_reset_starts_run(self):
        first = metadata.lifecycle_state({}, {"matched": 10, "success": 10}, "emqx@vehicle-emqx", 500)
        restarted = metadata.lifecycle_state(first, {"matched": 12, "success": 12}, first["node"], 100)
        reset = metadata.lifecycle_state(first, {"matched": 0, "success": 0}, first["node"], 1000)
        self.assertNotEqual(first["epoch"], restarted["epoch"])
        self.assertNotEqual(first["epoch"], reset["epoch"])

    def test_migration_from_docker_snapshot_starts_run(self):
        old = {"started": "docker-start", "epoch": "old-run", "matched": 100, "success": 100}
        new = metadata.lifecycle_state(old, {"matched": 5, "success": 5}, "emqx@vehicle-emqx", 500)
        self.assertNotEqual(old["epoch"], new["epoch"])


if __name__ == "__main__":
    unittest.main()
