import importlib.util
from pathlib import Path
import json
import unittest

spec = importlib.util.spec_from_file_location('observer', Path(__file__).parents[1] / 'observer.py')
observer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(observer)


class ReceiptTests(unittest.TestCase):
    def setUp(self):
        self.db = observer.connect_db(':memory:')
        self.event = dict(schemaVersion=1, eventId='demo-vehicle-001:1', vehicleId='demo-vehicle-001',
                          tripId='trip-1', sequence=1, eventTime=1000, speedKph=0,
                          odometerKm=10, batterySocPct=80, batteryTempC=30, mode='PARK')

    def tearDown(self):
        self.db.close()

    def test_retry_is_counted_once_and_conflict_detected(self):
        observer.record(self.db, json.dumps(self.event), 1100)
        observer.record(self.db, json.dumps(self.event), 1200)
        self.event['batterySocPct'] = 50
        observer.record(self.db, json.dumps(self.event), 1300)
        result = observer.summary(self.db)
        self.assertEqual(result['unique'], 1)
        self.assertEqual(result['counters'], {'duplicates': 1, 'identity_conflicts': 1})
        self.assertEqual(result['last600P95Ms'], 100)

    def test_invalid_or_incoherent_events_are_not_receipts(self):
        for bad in [dict(self.event, speedKph=5), dict(self.event, batteryTempC=float('nan')),
                    dict(self.event, eventId='other:1'), dict(self.event, sequence=True)]:
            self.assertFalse(observer.record(self.db, json.dumps(bad), 1100))
        self.assertEqual(observer.summary(self.db)['unique'], 0)

    def test_monotonic_cadence_distinguishes_clock_correction_from_missing_sample(self):
        for sequence, wall, monotonic in [(1, 1000, 1000), (2, 6000, 2000), (3, 10000, 6000)]:
            event = dict(self.event, eventId=f'demo-vehicle-001:{sequence}', sequence=sequence,
                         eventTime=wall, sampleMonotonicMs=monotonic, producerRunId='run-1')
            observer.record(self.db, json.dumps(event), wall + 100)
        result = observer.summary(self.db)
        self.assertEqual(result['wallClockGapsOver2500Ms'], 2)
        self.assertEqual(result['samplingGapsOver2500Ms'], 1)
        self.assertEqual(result['maxSamplingGapMs'], 4000)

    def test_monotonic_time_cannot_cross_processes_or_omit_run_identity(self):
        self.assertFalse(observer.record(self.db, json.dumps(dict(self.event, sampleMonotonicMs=1000)), 1100))
        for sequence, wall, monotonic, run in [(1, 1000, 9000, 'old'), (2, 8000, 1000, 'new')]:
            event = dict(self.event, eventId=f'demo-vehicle-001:{sequence}', sequence=sequence,
                         eventTime=wall, sampleMonotonicMs=monotonic, producerRunId=run)
            observer.record(self.db, json.dumps(event), wall + 100)
        self.assertEqual(observer.summary(self.db)['maxSamplingGapMs'], 7000)


if __name__ == '__main__':
    unittest.main()
