import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).parents[1] / (name + '.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


observer, live = module('observer'), module('live_report')
NOW = 1793548801000  # 2026-11-02 00:00:01 Asia/Shanghai


class LiveReceiptTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'receipts.sqlite'
        self.db = observer.connect_db(self.path)
        self.addCleanup(self.db.close)

    def record(self, sequence, received, event_at=None, mode='DRIVE', soc=80):
        event = dict(schemaVersion=1, eventId=f'demo-vehicle-001:{sequence}', vehicleId='demo-vehicle-001',
                     tripId='trip-1', sequence=sequence, eventTime=event_at or received,
                     speedKph=60 if mode == 'DRIVE' else 0, odometerKm=100,
                     batterySocPct=soc, batteryTempC=30, mode=mode)
        with self.db:
            observer.record(self.db, json.dumps(event), received)

    def test_unique_receipts_use_receipt_window_and_shanghai_midnight(self):
        self.record(1, NOW - 60000)  # lower minute bound is exclusive
        self.record(2, NOW - 1001)   # yesterday, but inside the last minute
        self.record(3, NOW - 1000)   # exactly today's midnight
        self.record(3, NOW - 1000)   # duplicate does not refresh receipt time/count
        self.record(4, NOW)
        self.record(5, NOW + 1000)   # future receipt is outside the snapshot window
        result = live.receipt_snapshot(self.path, True, NOW)
        self.assertEqual(result['totals']['receivedLastMinute'], 3)
        self.assertEqual(result['vehicles'][0]['receivedToday'], 2)
        self.assertEqual(result['totals']['seenToday'], 1)
        self.assertEqual(result['totals']['reporting'], 1)

    def test_late_old_event_does_not_replace_latest_source_state(self):
        self.record(10, NOW - 2000, mode='CHARGE', soc=82)
        self.record(9, NOW - 100, event_at=NOW - 4000, mode='PARK', soc=20)
        result = live.receipt_snapshot(self.path, True, NOW)
        vehicle = result['vehicles'][0]
        self.assertEqual(vehicle['lastReceivedAt'], NOW - 100)
        self.assertEqual((vehicle['sequence'], vehicle['mode'], vehicle['batterySocPct']), (10, 'CHARGE', 82))
        self.assertEqual(result['modes'], {'DRIVE': 0, 'PARK': 0, 'CHARGE': 1})

    def test_backlog_receipts_do_not_claim_current_driving_mode(self):
        self.record(1, NOW - 100, event_at=NOW - 120000)
        result = live.receipt_snapshot(self.path, True, NOW)
        self.assertEqual(result['totals']['reporting'], 1)
        self.assertFalse(result['vehicles'][0]['stateFresh'])
        self.assertEqual(sum(result['modes'].values()), 0)

    def test_silent_vehicle_retains_last_known_state(self):
        self.record(1, NOW - 61000, mode='PARK')
        result = live.receipt_snapshot(self.path, True, NOW)
        self.assertEqual(result['totals']['silent'], 1)
        self.assertEqual(result['totals']['receivedLastMinute'], 0)
        self.assertEqual(result['vehicles'][0]['mode'], 'PARK')
        self.assertFalse(result['vehicles'][0]['stateFresh'])

    def test_disconnected_observer_is_unknown_not_zero_or_silent(self):
        self.record(1, NOW - 1000)
        result = live.receipt_snapshot(self.path, False, NOW)
        self.assertIsNone(result['totals']['reporting'])
        self.assertIsNone(result['totals']['silent'])
        self.assertIsNone(result['totals']['receivedLastMinute'])
        self.assertEqual(result['vehicles'][0]['status'], 'unknown')

    def test_empty_database_is_waiting_and_missing_database_is_not_created(self):
        result = live.receipt_snapshot(self.path, True, NOW)
        self.assertEqual(result['vehicles'][0]['status'], 'waiting')
        self.assertEqual(result['totals']['seenToday'], 0)
        missing = self.path.parent / 'absent.sqlite'
        with self.assertRaises(sqlite3.OperationalError):
            live.receipt_snapshot(missing, True, NOW)
        self.assertFalse(missing.exists())

    def test_api_is_read_only_and_excludes_raw_payload(self):
        self.record(1, NOW)
        before = list(self.db.iterdump())
        connected = threading.Event()
        connected.set()
        http = live.start_live_server(self.path, connected, port=0)
        self.addCleanup(http.server_close)
        self.addCleanup(http.shutdown)
        origin = 'http://127.0.0.1:' + str(http.server_port)
        with urlopen(origin + '/api/live') as response:
            body = response.read().decode()
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
            self.assertNotIn('trip-1', body)
            self.assertNotIn('payload', body)
        for path, method, expected in [('/api/live', 'POST', 405), ('/api/live', 'DELETE', 405),
                                       ('/api/live?database=/etc/passwd', 'GET', 404)]:
            with self.assertRaises(HTTPError) as caught:
                urlopen(Request(origin + path, method=method))
            self.assertEqual(caught.exception.code, expected)
            caught.exception.close()
        self.assertEqual(list(self.db.iterdump()), before)


if __name__ == '__main__':
    unittest.main()
