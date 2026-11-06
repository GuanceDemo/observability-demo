"""API control regressions with an in-memory Kubernetes resource store."""
import base64
import copy
import json
from pathlib import Path
import sys
import time
import unittest
from unittest.mock import Mock, patch
import zlib

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from api_control import APIControl, worker_manifest
from api_worker import run_step
from fault_runtime import FaultRuntime, OperationError
from kube_api import ControlError, LocalAPI, NAMESPACE, OWNER, ResourceAPI, SERVICE_ACCOUNT, STATE_NAME
from operation_store import OperationStore


def owned(name, spec):
    return {'metadata': {'name': name, 'uid': name + '-uid', 'resourceVersion': '1',
                         'annotations': {'meta.helm.sh/release-name': NAMESPACE,
                                         'meta.helm.sh/release-namespace': NAMESPACE}}, 'spec': spec}


class MemoryAPI(ResourceAPI):
    def __init__(self):
        super().__init__()
        self.doc = {'metadata': {'name': STATE_NAME, 'resourceVersion': '1',
                                 'labels': {'app.kubernetes.io/managed-by': OWNER}},
                    'data': {'operation': json.dumps({'phase': 'idle'}), 'lease': '{}'}}
        self.allowed = True
        self.writes = []
        self.jobs = {}
        self.resources = {
            ('deployment', 'vehicle-control'): owned('vehicle-control', {'template': {'spec': {
                'containers': [{'name': 'control', 'image': 'example/vehicle-control@sha256:fixed'}]}}}),
            ('cronjob', 'vehicle-summary'): owned('vehicle-summary', {'suspend': False}),
            ('serviceaccount', SERVICE_ACCOUNT): {'metadata': {'labels': {'app.kubernetes.io/managed-by': OWNER}}},
        }

    def get(self, kind, name, missing_ok=False):
        if kind == 'configmap':
            return copy.deepcopy(self.doc)
        if kind == 'job':
            return copy.deepcopy(self.jobs.get(name))
        return copy.deepcopy(self.resources[(kind, name)])

    def can(self, *args):
        return self.allowed

    def list(self, *args):
        return list(self.jobs.values())

    def request(self, path, method='GET', body=None, content_type=None, raw=False):
        self.writes.append((method, path, body))
        return {}

    def replace_state(self, body):
        if body['metadata']['resourceVersion'] != self.doc['metadata']['resourceVersion']:
            raise ControlError('KUBE_CONFLICT', 409)
        self.doc = copy.deepcopy(body)
        self.doc['metadata']['resourceVersion'] = str(int(self.doc['metadata']['resourceVersion']) + 1)
        self.writes.append(('state', copy.deepcopy(body)))
        return copy.deepcopy(self.doc)

    def create_job(self, body):
        self.jobs[body['metadata']['name']] = copy.deepcopy(body)
        self.writes.append(('job', body))
        return body

    def close(self):
        pass


class APIBoundaryTests(unittest.TestCase):
    def test_explicit_context_required_before_credentials_or_network(self):
        with self.assertRaisesRegex(ControlError, 'KUBE_CONTEXT_REQUIRED'):
            LocalAPI('/missing', '')

    def test_status_is_read_only_and_reports_api_mode(self):
        api = MemoryAPI()
        result = APIControl('config', 'target', Mock(), api_factory=lambda *_: api).execute('status')
        self.assertEqual(result['operation']['phase'], 'idle')
        self.assertEqual(result['control']['mode'], 'kubernetes-api')
        self.assertEqual(api.writes, [])

    def test_denied_permissions_prevent_job_submission(self):
        api = MemoryAPI()
        api.allowed = False
        result = APIControl('config', 'target', Mock(), api_factory=lambda *_: api).execute('inject', {'scenario': 'spark_fail'})
        self.assertEqual(result, {'error': 'KUBE_FORBIDDEN'})
        self.assertEqual(api.writes, [])

    def test_missing_executor_never_creates_resources_on_status(self):
        api = MemoryAPI()
        api.resources[('serviceaccount', SERVICE_ACCOUNT)] = None
        result = APIControl('config', 'target', Mock(), api_factory=lambda *_: api).execute('status')
        self.assertEqual(result['error'], 'KUBE_EXECUTOR_NOT_CONFIGURED')
        self.assertEqual(api.writes, [])

    def test_unexpected_failure_does_not_expose_secret_text(self):
        factory = Mock(side_effect=ValueError('private-key-and-password'))
        result = APIControl('config', 'target', Mock(), api_factory=factory).execute('status')
        self.assertEqual(result, {'error': 'KUBE_CONTROL_UNAVAILABLE'})

    def test_worker_has_dedicated_identity_and_no_local_credentials(self):
        op = {'id': 'a' * 32}
        job = worker_manifest(op, 'example/control:owned')
        spec = job['spec']['template']['spec']
        self.assertEqual(spec['serviceAccountName'], SERVICE_ACCOUNT)
        self.assertEqual(job['metadata']['namespace'], NAMESPACE)
        self.assertNotIn('activeDeadlineSeconds', job['spec'])
        env = {item['name']: item.get('value') for item in spec['containers'][0]['env']}
        self.assertNotIn('KUBECONFIG', env)
        self.assertNotIn('VEHICLE_SSH_KEY', env)
        files = json.loads(zlib.decompress(base64.b64decode(env['VEHICLE_WORKER_SOURCE'])))
        self.assertEqual(set(files), {'api_worker.py', 'fault_runtime.py', 'kube_api.py', 'operation_store.py',
                                     'emqx_executor.py', 'emqx_gate.expr', 'emqx_rpc.sh'})
        for name, source in files.items():
            if name.endswith('.py'):
                compile(source, name, 'exec')

    def test_worker_submission_retry_is_idempotent(self):
        api = MemoryAPI()
        controller = APIControl('config', 'target', Mock())
        op = {'id': 'b' * 32}
        controller.start_worker(api, op, 'example/control:owned')
        controller.start_worker(api, op, 'example/control:owned')
        self.assertEqual(len(api.jobs), 1)
        self.assertEqual(len(api.writes), 1)

    def test_worker_keeps_pull_and_scheduling_without_inheriting_app_secrets(self):
        options = {'imagePullSecrets': [{'name': 'registry'}], 'nodeSelector': {'pool': 'vehicle'},
                   'volumes': [{'name': 'app-secret'}], 'serviceAccountName': 'admin'}
        spec = worker_manifest({'id': 'a' * 32}, 'example/control:owned', options)['spec']['template']['spec']
        self.assertEqual(spec['imagePullSecrets'], options['imagePullSecrets'])
        self.assertEqual(spec['nodeSelector'], options['nodeSelector'])
        self.assertEqual(spec['serviceAccountName'], SERVICE_ACCOUNT)
        self.assertEqual([v['name'] for v in spec['volumes']], ['tmp'])

    def test_log_permission_review_uses_subresource(self):
        api = ResourceAPI()
        with patch.object(api, 'request', return_value={'status': {'allowed': True}}) as request:
            self.assertTrue(api.can('', 'pods/log', 'get'))
        attrs = request.call_args.args[2]['spec']['resourceAttributes']
        self.assertEqual((attrs['resource'], attrs['subresource']), ('pods', 'log'))

    def test_unknown_deployment_is_rejected_before_http(self):
        api = ResourceAPI()
        with patch.object(api, 'request') as request:
            with self.assertRaisesRegex(ControlError, 'RESOURCE_NOT_ALLOWED'):
                api.patch('deployment', 'mall-service', [])
            request.assert_not_called()

    def test_foreign_namespace_job_rejected(self):
        job = worker_manifest({'id': 'c' * 32}, 'example/control:owned')
        job['metadata']['namespace'] = 'default'
        with self.assertRaisesRegex(ControlError, 'RESOURCE_NOT_ALLOWED'):
            ResourceAPI().create_job(job)


class PersistentStateTests(unittest.TestCase):
    def setUp(self):
        self.api = MemoryAPI()
        self.op = {'id': 'd' * 32, 'phase': 'active', 'scenario': 'spark_fail', 'workerAttempt': 0}
        client = OperationStore(self.api)
        client.load()
        client.save(self.op)

    def test_concurrent_submission_cannot_overwrite_current_operation(self):
        first, second = OperationStore(self.api), OperationStore(self.api)
        first.load()
        second.load()
        first.save(dict(self.op, recoverRequested=True))
        with self.assertRaisesRegex(ControlError, 'KUBE_CONFLICT'):
            second.save(dict(self.op, id='e' * 32))

    def test_waiting_phase_and_deadline_survive_a_worker_restart(self):
        store = OperationStore(self.api)
        store.load()
        store.save(dict(self.op, phase='waiting', waitDeadline=12345))
        restarted = OperationStore(self.api)
        self.assertEqual(restarted.load()['phase'], 'waiting')
        self.assertEqual(restarted.load()['waitDeadline'], 12345)

    def test_only_one_worker_can_hold_lease(self):
        first = OperationStore(self.api, self.op['id'], 'pod-a')
        second = OperationStore(self.api, self.op['id'], 'pod-b')
        self.assertTrue(first.acquire())
        self.assertFalse(second.acquire())
        first.release()
        self.assertTrue(second.acquire())

    def test_worker_restart_resumes_persisted_original_state(self):
        first = OperationStore(self.api, self.op['id'], 'pod-a')
        self.assertTrue(first.acquire())
        first.save(dict(self.op, originalSuspend=True, originalReplicas=1))
        self.api.doc['data']['lease'] = json.dumps({'holder': 'pod-a', 'until': time.time() - 1})
        restarted = OperationStore(self.api, self.op['id'], 'pod-b')
        self.assertTrue(restarted.acquire())
        self.assertTrue(restarted.load()['originalSuspend'])
        self.assertEqual(restarted.load()['originalReplicas'], 1)

    def test_manual_recovery_is_preserved_when_worker_saves_stale_copy(self):
        worker = OperationStore(self.api, self.op['id'], 'pod-a')
        worker.acquire()
        stale = worker.load()
        client = OperationStore(self.api)
        current = client.load()
        client.save(dict(current, recoverRequested=True))
        worker.save(stale)
        self.assertTrue(client.load()['recoverRequested'])

    def test_old_worker_cannot_overwrite_new_recovery_attempt(self):
        worker = OperationStore(self.api, self.op['id'], 'pod-a')
        worker.acquire()
        stale = worker.load()
        client = OperationStore(self.api)
        current = client.load()
        client.save(dict(current, workerAttempt=1))
        with self.assertRaisesRegex(ControlError, 'WORKER_LEASE_LOST'):
            worker.save(stale)

    def test_expired_lease_prevents_actual_resource_mutation(self):
        worker = OperationStore(self.api, self.op['id'], 'pod-a')
        worker.acquire()
        self.api.doc['data']['lease'] = json.dumps({'holder': 'pod-a', 'until': 0})
        self.api.before_write = worker.check_lease
        count = len(self.api.writes)
        with self.assertRaisesRegex(ControlError, 'WORKER_LEASE_LOST'):
            self.api.patch('deployment', 'vehicle-kafka', [])
        self.assertEqual(len(self.api.writes), count)


class WorkerRecoveryTests(unittest.TestCase):
    def test_expired_pending_operation_skips_injection(self):
        runtime = FaultRuntime(Mock(), Mock(), Mock())
        op = {'phase': 'injecting', 'deadline': time.time() - 1, 'scenario': 'spark_fail'}
        with patch.object(runtime, 'patch_field') as patch_resource, patch.object(runtime, 'create_summary') as create, patch.object(runtime, 'recovery_step') as recover:
            runtime.step(op)
            self.assertEqual(op['phase'], 'recovering')
            patch_resource.assert_not_called()
            create.assert_not_called()
            recover.assert_called_once()

    def test_restore_error_stays_retryable_not_recovered(self):
        runtime, store = Mock(), Mock()
        runtime.step.side_effect = OperationError('RECOVERY_SUMMARY_FAILED')
        runtime.restore_resources.side_effect = ControlError('KUBE_NETWORK_UNAVAILABLE')
        op = {'phase': 'recovering'}
        run_step(runtime, store, op)
        self.assertEqual(op['phase'], 'error')
        self.assertFalse(op['restored'])
        store.save.assert_called_once()


if __name__ == '__main__':
    unittest.main()
