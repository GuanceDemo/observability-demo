import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
import subprocess
import tempfile

spec = importlib.util.spec_from_file_location('watchdog', Path(__file__).parents[1] / 'watchdog.py')
watchdog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(watchdog)


class HeartbeatTests(unittest.TestCase):
    def test_busy_or_malformed_logs_do_not_hide_valid_heartbeat(self):
        lines = ['noise'] * 2000
        lines.insert(20, 'I VehicleTelemetry: {"version":1,"event":"state","at":120000}')
        lines += ['broken {json', '{"event":"transport-error"}',
                  'I VehicleTelemetry: {"version":1,"event":"state","at":110000}']
        self.assertEqual(watchdog.heartbeat_at('\n'.join(lines)), 120)

    def test_missing_heartbeat_is_unknown_not_zero(self):
        self.assertIsNone(watchdog.heartbeat_at('{"event":"state","version":2,"at":1000}'))

    def test_clock_measurement_preserves_offset_and_uncertainty(self):
        result = watchdog.clock_reading('1793010000000\n', 1793010004500, 1793010004520)
        self.assertEqual(result, {'offsetMs': 4510, 'roundTripMs': 20})
        for value, end in [('1793010000000', 1793010008000), ('1793010000%3N', 1793010004520)]:
            with self.assertRaises(ValueError):
                watchdog.clock_reading(value, 1793010004500, end)

    def test_ntp_timeout_does_not_terminate_capacity_watchdog(self):
        with patch.object(watchdog, 'measure_clock', side_effect=subprocess.TimeoutExpired('adb', 15)):
            result = watchdog.refresh_clock()
        self.assertFalse(result['ok'])
        self.assertEqual(result['error'], 'TimeoutExpired')

    def test_remote_broker_cleanup_keeps_local_capacity_stop(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            pipeline = root / 'pipeline.json'
            pipeline.write_text('{"broker_ip":"192.168.55.83"}')
            with patch.object(watchdog, 'PIPELINE', pipeline), patch.object(watchdog, 'ROOT', root), \
                    patch.object(watchdog, 'run') as run:
                self.assertEqual((False, False), watchdog.local_broker_health())
                run.assert_not_called()
                watchdog.stop_new_components('test-capacity')
                run.assert_called_once_with(['systemctl', 'stop', *watchdog.UNITS])
                self.assertTrue((root / 'capacity-stopped').exists())


if __name__ == '__main__':
    unittest.main()
