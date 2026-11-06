"""Cluster-side operation worker, independent of the browser and local Docker."""
import json
import os
import time
from urllib.request import urlopen

from fault_runtime import FaultRuntime, OperationError
from kube_api import ControlError, InClusterAPI, STATE_NAME
from operation_store import OperationStore


def report():
    with urlopen('http://vehicle-control:8080/api/report', timeout=12) as response:
        return json.load(response)


def check_permissions(api):
    checks = [('', 'configmaps', 'get', STATE_NAME), ('', 'configmaps', 'update', STATE_NAME),
              ('batch', 'cronjobs', 'get', 'vehicle-summary'), ('batch', 'cronjobs', 'patch', 'vehicle-summary'),
              ('apps', 'deployments', 'get', 'vehicle-flink-taskmanager'),
              ('apps', 'deployments', 'patch', 'vehicle-flink-taskmanager'),
              ('apps', 'deployments', 'get', 'vehicle-kafka'), ('apps', 'deployments', 'patch', 'vehicle-kafka'),
              ('batch', 'jobs', 'get', None), ('batch', 'jobs', 'list', None), ('batch', 'jobs', 'create', None),
              ('', 'pods', 'list', None), ('', 'pods/log', 'get', None)]
    if not all(api.can(*check) for check in checks):
        raise ControlError('KUBE_WORKER_FORBIDDEN')


def run_step(runtime, store, op):
    try:
        runtime.step(op)
    except Exception as error:
        code = str(error) if isinstance(error, (OperationError, ControlError)) else 'KUBE_CONTROL_UNAVAILABLE'
        if code == 'WORKER_LEASE_LOST':
            raise
        if op.get('error') != code:
            runtime.note(op, '控制异常：' + code + '；将尝试还原原配置。')
        op.update(phase='error', error=code)
        try:
            runtime.restore_resources(op)
            runtime.restore_schedule(op)
        except Exception:
            op['restored'] = False
    op['heartbeat'] = time.time()
    store.save(op)


def main():
    operation_id = os.environ['VEHICLE_OPERATION_ID']
    attempt = int(os.environ.get('VEHICLE_WORKER_ATTEMPT', '0'))
    api = InClusterAPI()
    store = OperationStore(api, operation_id, os.environ['VEHICLE_WORKER_UID'], attempt)
    runtime = FaultRuntime(api, store, report)
    api.before_write = store.check_lease
    try:
        while True:
            try:
                op = store.load()
                if (op.get('id') != operation_id or op.get('workerAttempt', 0) != attempt
                        or op.get('phase') == 'recovered'
                        or (op.get('phase') == 'error' and op.get('restored'))):
                    return
                if not store.acquire():
                    time.sleep(5)
                    continue
                # No runtime mutation until the worker's own identity is authorized.
                check_permissions(api)
                op = store.load()
                run_step(runtime, store, op)
            except ControlError as error:
                if str(error) == 'KUBE_WORKER_FORBIDDEN':
                    op.update(phase='error', error=str(error), restored=False)
                    store.save(op)
                # Network/authorization loss is retryable. The persisted operation
                # and original state survive Pod restart; no false recovery result.
            time.sleep(5)
    finally:
        store.release()


if __name__ == '__main__':
    main()
