import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("configure_apm", Path(__file__).parents[1] / "configure-apm.py")
apm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(apm)

class ApmTest(unittest.TestCase):
    def resources(self):
        return ({"description": apm.OWNER, "parameters": {"message": {"value": "${payload}"}, "buffer": {"mode": "disk"}}},
                {"description": apm.OWNER, "sql": 'SELECT payload, payload.vehicleId AS vehicleId FROM "vehicle/v1/demo-vehicle-001/telemetry"'},
                {"traces": {"enable": False, "filter": {}}, "exporter": {"headers": {}, "endpoint": "http://old:4317"}, "metrics": {"enable": False}})

    def test_only_metadata_mapping_changes_and_is_idempotent(self):
        old = self.resources()
        untouched = copy.deepcopy(old)
        new = apm.plans(*old, "http://vehicle-apm:4317")
        self.assertEqual(old, untouched)
        self.assertEqual(old[0]["parameters"]["message"], new[0]["parameters"]["message"])
        self.assertEqual(old[0]["parameters"]["buffer"], new[0]["parameters"]["buffer"])
        self.assertEqual(old[2]["metrics"], new[2]["metrics"])
        self.assertEqual(new, apm.plans(*new, "http://vehicle-apm:4317"))
        self.assertEqual([apm.HEADER], new[0]["parameters"]["kafka_ext_headers"])

    def test_foreign_ownership_mapping_and_undrained_queue_rejected(self):
        old = self.resources()
        old[0]["description"] = "foreign"
        with self.assertRaises(ValueError): apm.plans(*old, "http://vehicle-apm:4317")
        old = self.resources()
        old[0]["parameters"]["kafka_ext_headers"] = [{"kafka_ext_header_key": "traceparent", "kafka_ext_header_value": "foreign"}]
        with self.assertRaises(ValueError): apm.plans(*old, "http://vehicle-apm:4317")
        for metrics in ({}, {"queuing": 1, "inflight": 0}, {"queuing": 0, "inflight": 1}):
            self.assertFalse(apm.drained(metrics))
        self.assertTrue(apm.drained({"queuing": 0, "inflight": 0}))

    def test_existing_otel_metrics_destination_is_not_retargeted(self):
        old = self.resources()
        old[2]["metrics"]["enable"] = True
        with self.assertRaisesRegex(ValueError, "destination_in_use"):
            apm.plans(*old, "http://vehicle-apm:4317")

if __name__ == "__main__": unittest.main()
