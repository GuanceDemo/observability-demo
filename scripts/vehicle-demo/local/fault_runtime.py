"""Vehicle fault/recovery state machine, independent of SSH and process lifetime."""
import copy
import json
import re
import time
import uuid

from kube_api import NAMESPACE
from emqx_executor import EmqxGate, GATE_MODE

SCENARIOS = {
    'spark_fail': {'ttl': 300, 'target': None},
    'flink_pause': {'ttl': 120, 'target': 'vehicle-flink-taskmanager'},
    'emqx_backlog': {'ttl': 60, 'target': None},
}
TERMINAL = {'recovered'}
SPARK_WAIT_SECONDS = 660


class OperationError(Exception):
    pass


class FaultRuntime:
    OperationError = OperationError

    def __init__(self, api, store, report_provider, start_worker=None):
        self.api, self.store = api, store
        self.report_provider, self.start_worker = report_provider, start_worker

    def kube(self, *args, **kwargs):
        return self.api.command(*args, **kwargs)

    def report(self):
        return self.report_provider()

    def save(self, op):
        self.store.save(op)

    def load(self):
        return self.store.load()

    def note(self, op, message):
        op.setdefault('history', []).append({'at': time.time(), 'message': message})
        op['history'] = op['history'][-24:]

    def get(self, kind, name):
        return json.loads(self.kube('get', kind, name, '-o', 'json'))

    def require_owned(self, resource):
        annotations = resource['metadata'].get('annotations', {})
        if annotations.get('meta.helm.sh/release-name') != 'vehicle-pipeline' or annotations.get('meta.helm.sh/release-namespace') != NAMESPACE:
            raise OperationError('RESOURCE_OWNERSHIP_MISMATCH')

    def patch_field(self, kind, name, uid, field, expected, value):
        current = self.get(kind, name)
        if current['metadata']['uid'] != uid:
            raise OperationError('RESOURCE_REPLACED')
        actual = current['spec'].get(field, False if field == 'suspend' else 1)
        if actual == value:
            return
        if actual != expected:
            raise OperationError('RESOURCE_CHANGED_EXTERNALLY')
        patch = [
            {'op': 'test', 'path': '/metadata/resourceVersion', 'value': current['metadata']['resourceVersion']},
            {'op': 'add', 'path': '/spec/' + field, 'value': value},
        ]
        self.kube('patch', kind, name, '--type=json', '-p', json.dumps(patch))

    def jobs_running(self):
        jobs = json.loads(self.kube('get', 'jobs', '-o', 'json'))['items']
        # New Jobs may be Pending before Kubernetes sets status.active.
        return any(not any(c.get('status') == 'True' and c.get('type') in ('Complete', 'Failed')
                           for c in job.get('status', {}).get('conditions', [])) for job in jobs
                   if job['metadata']['name'].startswith('vehicle-summary'))

    def create_summary(self, op, field, mode):
        name = op[field]
        # Deterministic operation-specific name makes retries after a lost API response idempotent.
        existing = self.kube('get', 'job', name, '--ignore-not-found', '-o', 'json').strip()
        if existing:
            if json.loads(existing)['metadata'].get('labels', {}).get('vehicle-local-operation') != op['id']:
                raise OperationError('JOB_OWNERSHIP_MISMATCH')
            return
        cron = self.get('cronjob', 'vehicle-summary')
        self.require_owned(cron)
        if cron['metadata']['uid'] != op['cronUid']:
            raise OperationError('RESOURCE_REPLACED')
        spec = copy.deepcopy(cron['spec']['jobTemplate']['spec'])
        containers = spec['template']['spec']['containers']
        if len(containers) != 1 or containers[0]['name'] != 'spark':
            raise OperationError('UNEXPECTED_SPARK_TEMPLATE')
        containers[0]['args'] = [mode]
        spec.update(backoffLimit=0, activeDeadlineSeconds=600, ttlSecondsAfterFinished=86400)
        resource = {'apiVersion': 'batch/v1', 'kind': 'Job',
                    'metadata': {'name': name, 'namespace': NAMESPACE,
                                 'labels': {'vehicle-local-operation': op['id']}}, 'spec': spec}
        self.kube('create', '-f', '-', body=json.dumps(resource))

    def job_result(self, name):
        raw = self.kube('get', 'job', name, '--ignore-not-found', '-o', 'json').strip()
        if not raw:
            return None
        job = json.loads(raw)
        done = any(c.get('status') == 'True' and c.get('type') in ('Complete', 'Failed')
                   for c in job.get('status', {}).get('conditions', []))
        if not done:
            return None
        logs = self.kube('logs', 'job/' + name, '--tail=2000')
        for line in reversed(logs.splitlines()):
            try:
                item = json.loads(line)
            except ValueError:
                continue
            if item.get('event') in ('vehicle_report_failed', 'vehicle_report_complete'):
                run_id = item.get('runId', '')
                if re.fullmatch(r'[a-f0-9-]{36}', run_id):
                    return {'runId': run_id, 'state': item.get('state', 'COMPLETE'), 'code': item.get('code')}
        raise OperationError('RUN_RESULT_UNAVAILABLE')

    def fresh(self, component):
        # Control serializes UTC timestamps as ISO strings.
        from datetime import datetime, timezone
        value = component.get('last_seen_at', '')
        try:
            normalized = value.replace('Z', '+00:00')
            # Python 3.6 has no datetime.fromisoformat.
            stamp = datetime.strptime(normalized[:19], '%Y-%m-%dT%H:%M:%S').replace(tzinfo=timezone.utc).timestamp()
            return 0 <= time.time() - stamp <= 90
        except (ValueError, TypeError):
            return False

    def component(self, data, name):
        return next((c for c in data.get('components', []) if c['component'] == name), {})

    def require_ready(self, data, allow_stale=False):
        batch = data.get('batch')
        if not batch or (batch.get('stale') and not allow_stale):
            raise OperationError('FRESH_SUCCESSFUL_REPORT_REQUIRED')
        for name in ('emqx', 'flink'):
            if not self.fresh(self.component(data, name)):
                raise OperationError('FRESH_COMPONENT_STATE_REQUIRED')
        if self.component(data, 'flink').get('payload', {}).get('engineState') != 'RUNNING':
            raise OperationError('UPSTREAM_ALREADY_UNHEALTHY')
        broker = self.component(data, 'emqx').get('payload', {})
        if broker.get('status') != 'connected' or broker.get('queuing', 0) > 0:
            raise OperationError('UPSTREAM_ALREADY_UNHEALTHY')
        return {'runId': batch['run_id'], 'lastEvent': batch['last_event_ms'], 'rows': batch['unique_rows'],
                'brokerDropped': broker.get('dropped', 0), 'brokerSuccess': broker.get('success', 0),
                'brokerInstance': broker.get('instanceKey')}

    def begin(self, request):
        scenario = request.get('scenario')
        if scenario not in SCENARIOS:
            raise OperationError('UNKNOWN_SCENARIO')
        previous = self.load()
        if previous.get('phase') not in TERMINAL | {'idle'}:
            if previous.get('requestId') == request.get('requestId'):
                return previous
            raise OperationError('OPERATION_ALREADY_ACTIVE')
        data = self.report()
        running = self.jobs_running()
        before = self.require_ready(data, allow_stale=scenario == 'spark_fail' and running)
        if scenario == 'flink_pause':
            evidence = self.component(data, 'flink').get('payload', {})
            run = next((j for j in data.get('jobs', []) if j['job_name'] == 'vehicle_clean_and_detect'), {})
            if (evidence.get('executionScope') != 'flink-attempt' or not evidence.get('executionReady')
                    or run.get('state') != 'RUNNING' or not run.get('run_id')):
                raise OperationError('FLINK_EXECUTION_NOT_READY')
        if running and scenario != 'spark_fail':
            raise OperationError('SPARK_BUSY_RETRY_AFTER_CURRENT_RUN')
        cron = self.get('cronjob', 'vehicle-summary')
        self.require_owned(cron)
        op_id = uuid.uuid4().hex
        op = {'id': op_id, 'requestId': request['requestId'], 'scenario': scenario, 'phase': 'injecting',
              'startedAt': time.time(), 'deadline': time.time() + SCENARIOS[scenario]['ttl'],
              'cronUid': cron['metadata']['uid'], 'originalSuspend': cron['spec'].get('suspend', False),
              'before': before,
              'failedJob': 'vehicle-summary-fault-' + op_id[:12],
              'recoveryJob': 'vehicle-summary-recover-' + op_id[:12], 'restored': False,
              'affectedRuns': [{'job': j['job_name'], 'runId': j['run_id'], 'state': j['state']}
                               for j in data.get('jobs', [])], 'history': []}
        if scenario == 'flink_pause':
            op['flinkAttemptTracking'] = True
        if scenario == 'emqx_backlog':
            op['emqxGateMode'] = GATE_MODE
        target = SCENARIOS[scenario]['target']
        if target:
            dep = self.get('deployment', target)
            self.require_owned(dep)
            replicas = dep['spec'].get('replicas', 1)
            if replicas != 1 or dep.get('status', {}).get('readyReplicas') != replicas:
                raise OperationError('TARGET_NOT_READY')
            op.update(target=target, targetUid=dep['metadata']['uid'], originalReplicas=replicas)
        if scenario == 'spark_fail':
            op.update(phase='waiting', waitDeadline=time.time() + SPARK_WAIT_SECONDS)
            op.pop('deadline')
            self.note(op, '请求已排队；等待当前汇总结束，故障计时尚未开始。')
        else:
            self.note(op, '已记录原配置；准备执行专用链路故障。')
        self.save(op)
        self.start_worker(op)
        return op

    def restore_resources(self, op):
        if op.get('emqxGateMode') == GATE_MODE and op.get('emqxTarget'):
            self.capture_emqx_queue(op, EmqxGate(self.api).call('status', op))
            EmqxGate(self.api).call('restore', op)
        if op.get('target'):
            # Previously persisted EMQX operations still restore their Kafka replica.
            self.patch_field('deployment', op['target'], op['targetUid'], 'replicas', 0, op['originalReplicas'])
        # Keep scheduled summaries suspended until the explicit recovery batch completes.
        op['resourcesResumed'] = True

    def restore_schedule(self, op):
        self.patch_field('cronjob', 'vehicle-summary', op['cronUid'], 'suspend', True, op['originalSuspend'])
        op['restored'] = True

    def capture_emqx_queue(self, op, result):
        evidence = op.setdefault('emqxEvidence', {'peakQueued': 0})
        queued = result['queued']
        evidence.update(lastQueued=queued, checkedAt=time.time())
        if result['gated'] and result.get('operation') == op['id'] and queued > 0:
            if not evidence.get('observedAt'):
                self.note(op, '已确认 EMQX 内部队列积压；Kafka 保持运行。')
                evidence['observedAt'] = time.time()
            evidence['peakQueued'] = max(evidence['peakQueued'], queued)

    def capture_flink_failure(self, op, data):
        if not op.get('flinkAttemptTracking') or op.get('failedRun'):
            return
        component = self.component(data, 'flink')
        failure = component.get('payload', {}).get('lastFailure') or {}
        before = next((r for r in op['affectedRuns'] if r['job'] == 'vehicle_clean_and_detect'), {})
        if (self.fresh(component) and failure.get('state') == 'FAIL'
                and failure.get('job') == 'vehicle_clean_and_detect'
                and failure.get('runId') == before.get('runId')
                and failure.get('atMs', 0) >= op['startedAt'] * 1000):
            op['failedRun'] = dict(failure)
            self.note(op, 'Flink 引擎已确认执行失败，失败运行已保留。')

    def recovery_step(self, op):
        if not op.get('resourcesResumed'):
            self.restore_resources(op)
            self.note(op, '已恢复处理资源，等待真实数据进度。')
        data = self.report()
        self.capture_flink_failure(op, data)
        broker = self.component(data, 'emqx')
        flink = self.component(data, 'flink')
        payload = broker.get('payload', {})
        healthy = (self.fresh(broker) and self.fresh(flink) and payload.get('status') == 'connected'
                   and payload.get('queuing', 0) == 0
                   and flink.get('payload', {}).get('engineState') == 'RUNNING')
        if payload.get('dropped', 0) > op['before']['brokerDropped']:
            raise OperationError('BROKER_DROP_INCREASED_REQUIRES_RECONCILIATION')
        if payload.get('instanceKey') != op['before'].get('brokerInstance'):
            raise OperationError('BROKER_INSTANCE_CHANGED_REQUIRES_RECONCILIATION')
        if not healthy:
            return
        if op['scenario'] == 'emqx_backlog' and payload.get('success', 0) <= op['before']['brokerSuccess']:
            return
        if op.get('emqxGateMode') == GATE_MODE and not op.get('emqxEvidence', {}).get('observedAt'):
            raise OperationError('EMQX_BACKLOG_NOT_OBSERVED')
        # A checkpoint after recovery makes the input visible to the real Spark reader.
        checkpoint_at = flink.get('payload', {}).get('lastCheckpointAt') or 0
        if checkpoint_at < op['recoverAt'] * 1000:
            return
        if op.get('flinkAttemptTracking'):
            failure = op.get('failedRun')
            execution = flink.get('payload', {})
            run = next((r for r in data.get('jobs', []) if r['job_name'] == 'vehicle_clean_and_detect'), {})
            if (not failure or not execution.get('executionReady')
                    or execution.get('lastFailure', {}).get('runId') != failure['runId']
                    or run.get('state') != 'RUNNING' or run.get('run_id') == failure['runId']
                    or execution.get('attemptStartedAt', 0) <= failure['atMs']):
                return
            op['flinkRecoveryRun'] = {'runId': run['run_id'], 'job': 'vehicle_clean_and_detect', 'state': 'RUNNING'}
        if not op.get('recoverySubmitted'):
            if op['scenario'] == 'spark_fail':
                existing = self.kube('get', 'job', op['failedJob'], '--ignore-not-found', '-o', 'json').strip()
                if existing and not self.job_result(op['failedJob']):
                    return
            if self.jobs_running():
                return
            self.create_summary(op, 'recoveryJob', 'normal')
            op['recoverySubmitted'] = True
            self.note(op, '已启动正常汇总，等待新批次提交。')
            return
        result = self.job_result(op['recoveryJob'])
        if not result:
            return
        op['recoveryRun'] = result
        if result['state'] != 'COMPLETE':
            raise OperationError('RECOVERY_SUMMARY_FAILED')
        batch = data.get('batch') or {}
        if batch.get('run_id') != result['runId']:
            return
        if batch.get('last_event_ms', 0) <= op['before']['lastEvent'] or batch.get('stale'):
            raise OperationError('NO_NEW_SOURCE_DATA')
        if data.get('lineagePending', 0):
            return
        self.restore_schedule(op)
        op.update(phase='recovered', recoveredAt=time.time(), after={
            'runId': batch['run_id'], 'lastEvent': batch['last_event_ms'], 'rows': batch['unique_rows']})
        op.pop('error', None)
        self.note(op, '新成功批次已提交，源时间推进；原调度已还原。')

    def step(self, op):
        if op['phase'] == 'waiting':
            if op.get('recoverRequested') or time.time() >= op['waitDeadline']:
                self.restore_schedule(op)
                op.update(phase='recovered', outcome='cancelled', cancelledAt=time.time())
                self.note(op, '等待已取消，未执行故障；原调度已还原。')
                return
            self.patch_field('cronjob', 'vehicle-summary', op['cronUid'], 'suspend', op['originalSuspend'], True)
            if self.jobs_running():
                return
            # The completed scheduled run becomes the rollback/recovery baseline.
            data = self.report()
            op['before'] = self.require_ready(data)
            op['affectedRuns'] = [{'job': j['job_name'], 'runId': j['run_id'], 'state': j['state']}
                                  for j in data.get('jobs', [])]
            op.update(phase='injecting', deadline=time.time() + SCENARIOS[op['scenario']]['ttl'])
            self.note(op, '当前汇总已结束，准备注入；开始故障保护计时。')
            # Persist this transition before a subsequent step performs the fault.
            return
        if op['phase'] in ('injecting', 'active') and (time.time() >= op['deadline'] or op.get('recoverRequested')):
            op.update(phase='recovering', recoverAt=time.time())
            self.note(op, '开始恢复（手动操作或保护期限到达）。')
        if op['phase'] == 'injecting':
            self.patch_field('cronjob', 'vehicle-summary', op['cronUid'], 'suspend', op['originalSuspend'], True)
            # A scheduled batch may have started between preflight and suspension.
            if self.jobs_running():
                if time.time() >= op['deadline']:
                    raise OperationError('SPARK_DID_NOT_BECOME_IDLE')
                return
            if op.get('target'):
                self.patch_field('deployment', op['target'], op['targetUid'], 'replicas', op['originalReplicas'], 0)
            if op.get('emqxGateMode') == GATE_MODE:
                if not op.get('emqxTarget'):
                    op['emqxTarget'] = EmqxGate(self.api).prepare(op)
                    # Persist exact Pod UID before the next step can mutate its producer.
                    return
                EmqxGate(self.api).call('inject', op)
            if op['scenario'] == 'spark_fail':
                self.create_summary(op, 'failedJob', 'schema-mismatch')
            op['phase'] = 'active'
            self.note(op, 'EMQX 内部发送已阻塞，等待确认队列积压。' if op.get('emqxGateMode') == GATE_MODE
                      else '故障动作已执行，运行状态以引擎和观测云记录为准。')
        if op['phase'] == 'active' and op.get('emqxGateMode') == GATE_MODE:
            self.capture_emqx_queue(op, EmqxGate(self.api).call('status', op))
        if op['phase'] == 'active' and op['scenario'] == 'spark_fail' and not op.get('failedRun'):
            result = self.job_result(op['failedJob'])
            if result:
                op['failedRun'] = result
                if result['state'] != 'FAIL' or result['code'] != 'UNRESOLVED_COLUMN.WITH_SUGGESTION':
                    raise OperationError('UNEXPECTED_FAILURE_RESULT')
                self.note(op, 'Spark SQL 因输入字段不匹配解析失败，上一成功报表保留。')
        if op['phase'] == 'active' and op.get('flinkAttemptTracking'):
            self.capture_flink_failure(op, self.report())
        if op['phase'] in ('injecting', 'active') and (time.time() >= op['deadline'] or op.get('recoverRequested')):
            op.update(phase='recovering', recoverAt=time.time())
            self.note(op, '开始恢复（手动操作或保护期限到达）。')
        if op['phase'] == 'recovering':
            if time.time() - op['recoverAt'] > 1200:
                if op.get('flinkAttemptTracking') and not op.get('failedRun'):
                    raise OperationError('FLINK_FAILURE_NOT_OBSERVED')
                raise OperationError('RECOVERY_DATA_TIMEOUT')
            self.recovery_step(op)
        if op['phase'] == 'error':
            # Always undo the disruption even when end-to-end data recovery is not proven.
            self.restore_resources(op)
            self.restore_schedule(op)
