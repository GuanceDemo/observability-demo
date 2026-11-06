"""Local API client: submits a bounded worker; never performs a fault itself."""
import base64
import copy
import hashlib
import json
from pathlib import Path
import time
import uuid
import zlib

from fault_runtime import FaultRuntime, OperationError
from emqx_executor import GATE_MODE
from kube_api import ControlError, LocalAPI, NAMESPACE, OWNER, SERVICE_ACCOUNT, STATE_NAME
from operation_store import OperationStore

WORKER_FILES = ('api_worker.py', 'fault_runtime.py', 'kube_api.py', 'operation_store.py',
                'emqx_executor.py', 'emqx_gate.expr', 'emqx_rpc.sh')
EMQX_WORKER_IMAGE = ('pubrepo.jiagouyun.com/demo/vehicle-fault-worker:0.1.0-internal-gate@sha256:'
                     'aab83e84fae13b2ede780a08b0f4840c588bab348335dec79aad341638c6ece4')


def worker_bundle():
    root = Path(__file__).resolve().parent
    payload = json.dumps({name: (root / name).read_text() for name in WORKER_FILES}).encode()
    return base64.b64encode(zlib.compress(payload)).decode(), hashlib.sha256(payload).hexdigest()


def worker_name(op):
    return 'vehicle-demo-control-' + op['id'][:12] + '-' + str(op.get('workerAttempt', 0))


def worker_manifest(op, image, pod_options=None):
    if op.get('emqxGateMode') == GATE_MODE:
        image = EMQX_WORKER_IMAGE
    payload, digest = worker_bundle()
    # Fixed source bundle only; neither kubeconfig nor browser-provided code is transferred.
    loader = ('import base64,json,os,pathlib,sys,zlib; '
              'p=pathlib.Path("/tmp/vehicle-worker"); p.mkdir(exist_ok=True); '
              'files=json.loads(zlib.decompress(base64.b64decode(os.environ.pop("VEHICLE_WORKER_SOURCE")))); '
              '[(p/name).write_text(source) for name,source in files.items()]; '
              'sys.path.insert(0,str(p)); import api_worker; api_worker.main()')
    labels = {'vehicle-local-operation': op['id'], 'app.kubernetes.io/managed-by': OWNER}
    job = {'apiVersion': 'batch/v1', 'kind': 'Job',
            'metadata': {'name': worker_name(op), 'namespace': NAMESPACE, 'labels': labels,
                         'annotations': {'vehicle-demo/source-sha256': digest}},
            'spec': {'backoffLimit': 2147483647, 'ttlSecondsAfterFinished': 86400,
                     'parallelism': 1, 'completions': 1,
                     'template': {'metadata': {'labels': labels}, 'spec': {
                         'serviceAccountName': SERVICE_ACCOUNT, 'automountServiceAccountToken': True,
                         'restartPolicy': 'OnFailure',
                         'securityContext': {'runAsNonRoot': True, 'runAsUser': 10001, 'runAsGroup': 10001,
                                             'seccompProfile': {'type': 'RuntimeDefault'}},
                         'containers': [{'name': 'control', 'image': image, 'command': ['python', '-c', loader],
                                         'env': [{'name': 'VEHICLE_WORKER_SOURCE', 'value': payload},
                                                 {'name': 'VEHICLE_OPERATION_ID', 'value': op['id']},
                                                 {'name': 'VEHICLE_WORKER_ATTEMPT', 'value': str(op.get('workerAttempt', 0))},
                                                 {'name': 'VEHICLE_WORKER_UID', 'valueFrom': {'fieldRef': {'fieldPath': 'metadata.uid'}}},
                                                 {'name': 'PYTHONDONTWRITEBYTECODE', 'value': '1'}],
                                         'securityContext': {'allowPrivilegeEscalation': False, 'readOnlyRootFilesystem': True,
                                                             'capabilities': {'drop': ['ALL']}},
                                         'resources': {'requests': {'cpu': '10m', 'memory': '32Mi'},
                                                       'limits': {'cpu': '100m', 'memory': '96Mi'}},
                                         'volumeMounts': [{'name': 'tmp', 'mountPath': '/tmp'}]}],
                         'volumes': [{'name': 'tmp', 'emptyDir': {'medium': 'Memory', 'sizeLimit': '16Mi'}}]}}}}
    for key in ('imagePullSecrets', 'nodeSelector', 'tolerations', 'affinity'):
        if key in (pod_options or {}):
            job['spec']['template']['spec'][key] = copy.deepcopy(pod_options[key])
    return job


class APIControl:
    def __init__(self, kubeconfig, context, report_provider, api_factory=LocalAPI):
        self.kubeconfig, self.context = kubeconfig, context
        self.report_provider, self.api_factory = report_provider, api_factory

    def preflight(self, api):
        control = api.get('deployment', 'vehicle-control')
        FaultRuntime(None, None, None).require_owned(control)
        FaultRuntime(None, None, None).require_owned(api.get('cronjob', 'vehicle-summary'))
        account = api.get('serviceaccount', SERVICE_ACCOUNT, missing_ok=True)
        if not account or account['metadata'].get('labels', {}).get('app.kubernetes.io/managed-by') != OWNER:
            raise ControlError('KUBE_EXECUTOR_NOT_CONFIGURED')
        for group, resource, verb, name in [
                ('', 'configmaps', 'get', STATE_NAME), ('', 'configmaps', 'update', STATE_NAME),
                ('batch', 'jobs', 'get', None), ('batch', 'jobs', 'list', None), ('batch', 'jobs', 'create', None)]:
            if not api.can(group, resource, verb, name):
                raise ControlError('KUBE_FORBIDDEN')
        pod_options = control['spec']['template']['spec']
        containers = pod_options['containers']
        image = next((item['image'] for item in containers if item['name'] == 'control'), None)
        if not image:
            raise ControlError('UNEXPECTED_CONTROL_TEMPLATE')
        return image, pod_options

    def start_worker(self, api, op, image, pod_options=None):
        name = worker_name(op)
        current = api.get('job', name, missing_ok=True)
        if current:
            if (current['metadata'].get('labels', {}).get('vehicle-local-operation') != op['id']
                    or current['spec']['template']['spec'].get('serviceAccountName') != SERVICE_ACCOUNT):
                raise ControlError('JOB_OWNERSHIP_MISMATCH')
            return
        try:
            api.create_job(worker_manifest(op, image, pod_options))
        except ControlError as error:
            # Reconcile an ambiguous submission on the next identical request. Never
            # mark a possibly running operation restored merely because its POST timed out.
            if error.status == 409:
                return self.start_worker(api, op, image, pod_options)
            raise

    def execute(self, action, values=None):
        api = None
        try:
            api = self.api_factory(self.kubeconfig, self.context)
            image, pod_options = self.preflight(api)
            store = OperationStore(api)
            op = store.load()
            if action == 'status':
                return {'operation': op, 'control': {'mode': 'kubernetes-api', 'namespace': NAMESPACE}}
            if action == 'inject':
                runtime = FaultRuntime(api, store, self.report_provider,
                                       lambda value: self.start_worker(api, value, image, pod_options))
                op = runtime.begin(values or {})
                # Same requestId can retry a worker Job submission after a lost response.
                self.start_worker(api, op, image, pod_options)
            elif action == 'recover':
                if op.get('phase') in ('idle', 'recovered'):
                    return {'operation': op}
                if op.get('id') != (values or {}).get('operationId'):
                    raise OperationError('OPERATION_ID_MISMATCH')
                if op['phase'] == 'error':
                    op.update(phase='recovering', recoverAt=time.time(), resourcesResumed=False,
                              recoverySubmitted=False, workerAttempt=op.get('workerAttempt', 0) + 1,
                              recoveryJob='vehicle-summary-recover-' + uuid.uuid4().hex[:12])
                op['recoverRequested'] = True
                store.save(op)
                self.start_worker(api, op, image, pod_options)
            else:
                raise OperationError('UNKNOWN_ACTION')
            return {'operation': op}
        except (ControlError, OperationError) as error:
            return {'error': str(error)}
        except Exception:
            return {'error': 'KUBE_CONTROL_UNAVAILABLE'}
        finally:
            if api is not None:
                api.close()
