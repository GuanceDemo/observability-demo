import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "restore", Path(__file__).resolve().parents[1] / "prepare-emqx-restore.py"
)
restore = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restore)


class OfflineRestoreTest(unittest.TestCase):
    def test_only_endpoint_changes_and_repeat_is_safe(self):
        source = (
            'vehicle_kafka { description="vehicle-pipeline:v1" '
            'bootstrap_hosts="172.19.0.1:19092" password="unchanged" }'
        )
        updated = restore.retarget(source)
        self.assertEqual(source.replace(restore.OLD, restore.NEW), updated)
        self.assertEqual(updated, restore.retarget(updated))

    def test_unknown_or_ambiguous_connector_is_refused(self):
        sources = ("unowned", "vehicle_kafka vehicle-pipeline:v1",
                   "vehicle_kafka vehicle-pipeline:v1 " + restore.OLD * 2)
        for source in sources:
            with self.assertRaises(ValueError):
                restore.retarget(source)


if __name__ == "__main__":
    unittest.main()
