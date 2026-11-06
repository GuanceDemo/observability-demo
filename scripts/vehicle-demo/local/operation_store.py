"""One cluster-wide operation slot with optimistic concurrency and a worker lease."""
import copy
import json
import time

from kube_api import ControlError, OWNER, STATE_NAME

LEASE_SECONDS = 180


class OperationStore:
    def __init__(self, api, operation_id=None, holder=None, attempt=0):
        self.api, self.operation_id, self.holder = api, operation_id, holder
        self.attempt = attempt
        self.document = None

    def read(self):
        doc = self.api.get('configmap', STATE_NAME, missing_ok=True)
        if not doc:
            raise ControlError('KUBE_EXECUTOR_NOT_CONFIGURED')
        if doc['metadata'].get('labels', {}).get('app.kubernetes.io/managed-by') != OWNER:
            raise ControlError('STATE_OWNERSHIP_MISMATCH')
        try:
            op = json.loads(doc.get('data', {}).get('operation', ''))
            lease = json.loads(doc.get('data', {}).get('lease', '{}'))
            if not isinstance(op, dict) or op.get('phase') not in {'idle', 'waiting', 'injecting', 'active', 'recovering', 'recovered', 'error'}:
                raise ValueError
        except (ValueError, TypeError):
            raise ControlError('CONTROL_STATE_INVALID') from None
        return doc, op, lease

    def load(self):
        self.document, op, _ = self.read()
        return op

    def write(self, doc, op=None, lease=None):
        doc = copy.deepcopy(doc)
        if op is not None:
            doc.setdefault('data', {})['operation'] = json.dumps(op, ensure_ascii=False)
        if lease is not None:
            doc.setdefault('data', {})['lease'] = json.dumps(lease)
        return self.api.replace_state(doc)

    def save(self, op):
        if not self.holder:
            # Local submission is a single CAS, never retry a stale preflight over another operation.
            if self.document is None:
                raise ControlError('CONTROL_STATE_INVALID')
            previous = json.loads(self.document['data']['operation'])
            self.document = self.write(self.document, op=op, lease={} if previous.get('id') != op.get('id') else None)
            return
        for _ in range(5):
            doc, current, lease = self.read()
            self.assert_owner(current, lease)
            merged = copy.deepcopy(op)
            # A manual recovery click may race a worker checkpoint.
            if current.get('recoverRequested'):
                merged['recoverRequested'] = True
            try:
                self.document = self.write(doc, op=merged, lease={'holder': self.holder, 'until': time.time() + LEASE_SECONDS})
                return
            except ControlError as error:
                if error.status != 409:
                    raise
        raise ControlError('KUBE_CONFLICT')

    def assert_owner(self, op, lease):
        if (op.get('id') != self.operation_id or op.get('workerAttempt', 0) != self.attempt
                or lease.get('holder') != self.holder
                or lease.get('until', 0) <= time.time()):
            raise ControlError('WORKER_LEASE_LOST')

    def check_lease(self):
        _, op, lease = self.read()
        self.assert_owner(op, lease)

    def acquire(self):
        doc, op, lease = self.read()
        if op.get('id') != self.operation_id or op.get('workerAttempt', 0) != self.attempt:
            return False
        if lease.get('holder') != self.holder and lease.get('until', 0) > time.time():
            return False
        try:
            self.document = self.write(doc, lease={'holder': self.holder, 'until': time.time() + LEASE_SECONDS})
            return True
        except ControlError as error:
            if error.status == 409:
                return False
            raise

    def release(self):
        doc, op, lease = self.read()
        if op.get('id') == self.operation_id and lease.get('holder') == self.holder:
            try:
                self.write(doc, lease={})
            except ControlError as error:
                if error.status != 409:
                    raise
