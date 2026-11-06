"""Evidence correlation and recovery gates, without calling a cluster."""
import copy
import unittest
from unittest.mock import Mock

import test_spark_queue


class FlinkFaultTests(unittest.TestCase):
    def setUp(self):
        test_spark_queue.SparkQueueTests.setUp(self)
        self.runtime.jobs_running.return_value = False
        self.runtime.restore_resources = Mock()
        self.runtime.restore_schedule = Mock()
        self.runtime.kube = Mock(return_value='')
        self.op = {'scenario': 'flink_pause', 'phase': 'active', 'flinkAttemptTracking': True,
                   'startedAt': self.now - 30, 'deadline': self.now + 90, 'history': [],
                   'recoverAt': self.now - 10, 'resourcesResumed': True,
                   'affectedRuns': [{'job': 'vehicle_clean_and_detect', 'runId': 'old-flink'}],
                   'before': {'brokerDropped': 0, 'brokerInstance': 'broker', 'lastEvent': 1000},
                   'recoveryJob': 'summary-recovery'}
        self.flink = self.data['components'][1]['payload']
        self.failure = {'runId': 'old-flink', 'job': 'vehicle_clean_and_detect', 'state': 'FAIL',
                        'atMs': (self.now - 20) * 1000, 'code': 'FLINK_TASKEXECUTOR_LOST'}
        self.flink.update(executionScope='flink-attempt', lastFailure=self.failure,
                          executionReady=True, lastCheckpointAt=self.now * 1000,
                          attemptStartedAt=(self.now - 5) * 1000)
        self.data['jobs'] = [{'job_name': 'vehicle_clean_and_detect', 'run_id': 'new-flink', 'state': 'RUNNING'}]

    def test_injection_requires_adapter_evidence_and_a_running_run(self):
        for missing in ('run', 'scope', 'ready'):
            original = copy.deepcopy(self.data)
            if missing == 'run':
                self.data['jobs'] = []
            elif missing == 'scope':
                self.flink.pop('executionScope')
            else:
                self.flink['executionReady'] = False
            with self.assertRaisesRegex(test_spark_queue.OperationError, 'FLINK_EXECUTION_NOT_READY'):
                self.runtime.begin({'scenario': 'flink_pause', 'requestId': 'a' * 32})
            self.runtime.patch_field.assert_not_called()
            self.runtime.start_worker.assert_not_called()
            self.data.clear()
            self.data.update(original)
            self.flink = self.data['components'][1]['payload']

    def test_capture_requires_matching_run_recent_failure_and_fresh_observation(self):
        for field, value in [('runId', 'unrelated'), ('atMs', (self.now - 60) * 1000),
                             ('state', 'RUNNING'), ('job', 'vehicle_summary')]:
            self.flink['lastFailure'] = {**self.failure, field: value}
            self.runtime.capture_flink_failure(self.op, self.data)
            self.assertNotIn('failedRun', self.op)
        self.flink['lastFailure'] = self.failure
        self.data['components'][1]['last_seen_at'] = '2000-01-01T00:00:00Z'
        self.runtime.capture_flink_failure(self.op, self.data)
        self.assertNotIn('failedRun', self.op)

    def test_capture_is_durable_and_never_overwritten_by_later_failure(self):
        self.runtime.step(self.op)
        self.assertEqual(self.op['failedRun'], self.failure)
        self.flink['lastFailure'] = {**self.failure, 'runId': 'other'}
        self.runtime.step(self.op)
        self.assertEqual(self.op['failedRun'], self.failure)
        self.assertEqual(len(self.op['history']), 1)

    def test_healthy_job_alone_cannot_claim_recovery(self):
        for mutate in ('missing-failure', 'old-run', 'no-checkpoint', 'not-ready'):
            op, original = copy.deepcopy(self.op), copy.deepcopy(self.data)
            if mutate == 'missing-failure':
                self.flink.pop('lastFailure')
            elif mutate == 'old-run':
                self.data['jobs'][0]['run_id'] = 'old-flink'
            elif mutate == 'no-checkpoint':
                self.flink['lastCheckpointAt'] = 1
            else:
                self.flink['executionReady'] = False
            self.runtime.recovery_step(op)
            self.runtime.create_summary.assert_not_called()
            self.assertNotIn('flinkRecoveryRun', op)
            self.data.clear()
            self.data.update(original)
            self.flink = self.data['components'][1]['payload']

    def test_recovery_keeps_distinct_flink_and_report_runs(self):
        self.op['phase'] = 'recovering'
        self.runtime.recovery_step(self.op)
        self.assertEqual(self.op['failedRun']['runId'], 'old-flink')
        self.assertEqual(self.op['flinkRecoveryRun']['runId'], 'new-flink')
        self.runtime.create_summary.assert_called_once_with(self.op, 'recoveryJob', 'normal')
        self.assertEqual(self.op['phase'], 'recovering')
        self.runtime.job_result.return_value = {'runId': 'new-spark', 'state': 'COMPLETE'}
        self.data['batch'].update(run_id='new-spark', last_event_ms=2000)
        self.runtime.recovery_step(self.op)
        self.assertEqual(self.op['phase'], 'recovered')
        self.assertEqual(self.op['recoveryRun']['runId'], 'new-spark')
        self.assertEqual(self.op['flinkRecoveryRun']['runId'], 'new-flink')

    def test_legacy_operation_can_restore_without_invented_failure(self):
        self.op.pop('flinkAttemptTracking')
        self.runtime.recovery_step(self.op)
        self.runtime.create_summary.assert_called_once()
        self.assertNotIn('failedRun', self.op)
        self.assertNotIn('flinkRecoveryRun', self.op)
