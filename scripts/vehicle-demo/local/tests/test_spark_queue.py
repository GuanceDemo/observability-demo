"""Offline scheduling regressions; never submit Jobs or change cluster state."""
import copy
import json
from datetime import datetime, timezone
from pathlib import Path
import sys
import time
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fault_runtime import FaultRuntime, OperationError, SPARK_WAIT_SECONDS


class SparkQueueTests(unittest.TestCase):
    def setUp(self):
        self.now = time.time()
        self.data = {'batch': {'run_id': 'old', 'last_event_ms': 1000, 'unique_rows': 10, 'stale': False},
                     'components': [{'component': name, 'last_seen_at': datetime.fromtimestamp(self.now, timezone.utc).isoformat(),
                                     'payload': payload} for name, payload in [
                                         ('emqx', {'status': 'connected', 'instanceKey': 'broker', 'dropped': 0}),
                                         ('flink', {'engineState': 'RUNNING'})]], 'jobs': []}
        self.store = Mock()
        self.store.load.return_value = {'phase': 'idle'}
        self.runtime = FaultRuntime(Mock(), self.store, Mock(return_value=self.data), Mock())
        self.runtime.jobs_running = Mock(return_value=True)
        self.runtime.get = Mock(return_value={'metadata': {'uid': 'cron', 'annotations': {
            'meta.helm.sh/release-name': 'vehicle-pipeline', 'meta.helm.sh/release-namespace': 'vehicle-pipeline'}},
            'spec': {'suspend': False}})
        self.runtime.patch_field = Mock()
        self.runtime.create_summary = Mock()
        self.runtime.job_result = Mock(return_value=None)

    def begin(self):
        return self.runtime.begin({'scenario': 'spark_fail', 'requestId': 'a' * 32})

    def test_busy_stale_success_can_queue_but_never_without_a_baseline(self):
        self.data['batch']['stale'] = True
        op = self.begin()
        self.assertEqual(op['phase'], 'waiting')
        self.assertNotIn('deadline', op)
        self.assertAlmostEqual(op['waitDeadline'], self.now + SPARK_WAIT_SECONDS, delta=1)
        self.runtime.start_worker.assert_called_once_with(op)
        self.runtime.create_summary.assert_not_called()
        self.runtime.patch_field.assert_not_called()
        self.data['batch'] = None
        with self.assertRaisesRegex(OperationError, 'FRESH_SUCCESSFUL_REPORT_REQUIRED'):
            self.begin()

    def test_stale_without_active_summary_and_other_busy_scenarios_still_reject(self):
        self.data['batch']['stale'] = True
        self.runtime.jobs_running.return_value = False
        with self.assertRaisesRegex(OperationError, 'FRESH_SUCCESSFUL_REPORT_REQUIRED'):
            self.begin()
        self.data['batch']['stale'] = False
        self.runtime.jobs_running.return_value = True
        with self.assertRaisesRegex(OperationError, 'SPARK_BUSY_RETRY_AFTER_CURRENT_RUN'):
            self.runtime.begin({'scenario': 'emqx_backlog', 'requestId': 'b' * 32})

    def test_busy_wait_preserves_deadline_and_retry_is_idempotent(self):
        op = self.begin()
        self.store.load.return_value = copy.deepcopy(op)
        self.assertEqual(self.begin(), op)
        self.runtime.start_worker.assert_called_once()
        with self.assertRaisesRegex(OperationError, 'OPERATION_ALREADY_ACTIVE'):
            self.runtime.begin({'scenario': 'spark_fail', 'requestId': 'b' * 32})
        self.runtime.step(op)
        self.assertEqual(op['phase'], 'waiting')
        self.assertNotIn('deadline', op)
        self.runtime.patch_field.assert_called_once_with('cronjob', 'vehicle-summary', 'cron', 'suspend', False, True)
        self.runtime.create_summary.assert_not_called()

    def test_idle_revalidates_and_refreshes_baseline_before_fault_timer_starts(self):
        op = self.begin()
        self.runtime.jobs_running.return_value = False
        self.data['batch'].update(run_id='new', last_event_ms=2000, unique_rows=20)
        with patch('fault_runtime.time.time', return_value=self.now + 30):
            self.runtime.step(op)
        self.assertEqual(op['phase'], 'injecting')
        self.assertEqual(op['before']['runId'], 'new')
        self.assertEqual(op['before']['lastEvent'], 2000)
        self.assertEqual(op['deadline'], self.now + 330)
        self.runtime.create_summary.assert_not_called()
        # A restarted worker consumes the persisted transition; it cannot extend TTL.
        resumed = copy.deepcopy(op)
        self.runtime.step(resumed)
        self.assertEqual(resumed['phase'], 'active')
        self.assertEqual(resumed['deadline'], op['deadline'])
        self.runtime.create_summary.assert_called_once_with(resumed, 'failedJob', 'schema-mismatch')

    def test_unhealthy_completion_does_not_inject(self):
        op = self.begin()
        self.runtime.jobs_running.return_value = False
        self.data['batch']['stale'] = True
        with self.assertRaisesRegex(OperationError, 'FRESH_SUCCESSFUL_REPORT_REQUIRED'):
            self.runtime.step(op)
        self.runtime.create_summary.assert_not_called()

    def test_only_real_schema_failure_counts_as_expected_fault(self):
        for code in ('UNRESOLVED_COLUMN.WITH_SUGGESTION', 'REPORT_INJECTED_FAILURE', 'SQLException'):
            op = self.begin()
            op.update(phase='active', deadline=self.now + 300)
            self.runtime.job_result.return_value = {'runId': 'actual-run', 'state': 'FAIL', 'code': code}
            if code.startswith('UNRESOLVED_COLUMN'):
                self.runtime.step(op)
                self.assertEqual(op['failedRun']['runId'], 'actual-run')
            else:
                with self.assertRaisesRegex(OperationError, 'UNEXPECTED_FAILURE_RESULT'):
                    self.runtime.step(op)

    def test_cancel_or_expiry_only_restores_schedule(self):
        for cancelled in (True, False):
            with self.subTest(cancelled=cancelled):
                op = self.begin()
                op.update(recoverRequested=cancelled, waitDeadline=self.now - 1 if not cancelled else self.now + 660)
                with patch.object(self.runtime, 'recovery_step') as recovery:
                    self.runtime.step(op)
                self.assertEqual((op['phase'], op['outcome']), ('recovered', 'cancelled'))
                self.assertTrue(op['restored'])
                recovery.assert_not_called()
        self.runtime.create_summary.assert_not_called()
        self.assertTrue(all(call.args[-2:] == (True, False) for call in self.runtime.patch_field.call_args_list))

    def test_waiting_error_can_restore_and_retry_without_a_fault_deadline(self):
        op = self.begin()
        op.update(phase='error', error='FRESH_SUCCESSFUL_REPORT_REQUIRED')
        self.runtime.step(op)
        self.assertTrue(op['restored'])
        self.assertEqual(op['error'], 'FRESH_SUCCESSFUL_REPORT_REQUIRED')
        op.update(phase='recovering', recoverAt=self.now)
        with patch.object(self.runtime, 'recovery_step') as recovery:
            self.runtime.step(op)
        recovery.assert_called_once_with(op)

    def test_pending_job_blocks_injection_until_terminal_condition(self):
        runtime = FaultRuntime(Mock(), Mock(), Mock())
        job = {'metadata': {'name': 'vehicle-summary-scheduled'}, 'status': {}}
        with patch.object(runtime, 'kube', side_effect=lambda *args: json.dumps({'items': [job]})):
            self.assertTrue(runtime.jobs_running())
            for state in ('Complete', 'Failed'):
                job['status'] = {'conditions': [{'type': state, 'status': 'True'}]}
                self.assertFalse(runtime.jobs_running())


if __name__ == '__main__':
    unittest.main()
