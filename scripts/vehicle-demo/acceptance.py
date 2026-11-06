#!/usr/bin/env python3
"""Start and assess an actual unattended window; never infer elapsed time."""
import argparse
import json
from pathlib import Path
import sqlite3
import subprocess
import time
from observer import connect_db, summary

ROOT = Path('/var/lib/vehicle-demo')
ADB = ['/home/cherry/android-sdk/platform-tools/adb', '-s', 'emulator-5556']
UNITS = ['vehicle-demo-emulator', 'vehicle-demo-gateway', 'vehicle-demo-video',
         'vehicle-demo-observer', 'vehicle-demo-watchdog']


def output(command):
    return subprocess.check_output(command, text=True, timeout=15).strip()


def app_state():
    lines = output(ADB + ['logcat', '-d', '-s', 'VehicleTelemetry:I', '*:S']).splitlines()
    for line in reversed(lines):
        try:
            value = json.loads(line[line.index('{'):])
            if value.get('event') == 'state' and value.get('version') == 1:
                return value
        except (ValueError, KeyError):
            pass
    raise RuntimeError('No structured application heartbeat')


def broker_identity(pipeline=Path('/etc/vehicle-demo/pipeline.json'),
                    state_path=ROOT / 'pipeline-metadata-state.json'):
    if pipeline.exists():
        config = json.loads(pipeline.read_text())
        if config.get('broker_ip'):
            if not state_path.exists() or time.time() - state_path.stat().st_mtime > 60:
                raise RuntimeError('EMQX runtime observation is stale')
            state = json.loads(state_path.read_text())
            return f"kubernetes:{config['broker_ip']}:{state['node']}:{state['epoch']}"
    return 'docker:' + output(['docker', 'inspect', '-f', '{{.State.StartedAt}}', 'vehicle-emqx'])


def snapshot():
    return {'units': {unit: output(['systemctl', 'show', unit, '-p', 'MainPID', '-p', 'NRestarts']) for unit in UNITS},
            'appPid': output(ADB + ['shell', 'pidof', 'com.guance.vehicledemo']),
            'brokerInstance': broker_identity()}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['begin', 'status'])
    args = parser.parse_args()
    now = time.time_ns() // 1_000_000
    path = ROOT / 'soak.json'
    app = app_state()
    db = connect_db(ROOT / 'receipts.sqlite')
    if args.action == 'begin':
        if path.exists():
            raise SystemExit('An acceptance window already exists; archive it before explicitly starting another')
        for unit in UNITS:
            if output(['systemctl', 'is-active', unit]) != 'active':
                raise SystemExit('All vehicle services must be active')
        if not app['running'] or app['offline'] or app['connection'] != '已连接' or app['pending'] > 2 or app['dropped']:
            raise SystemExit('Start requires running, connected, drained, zero-drop telemetry')
        recent = summary(db, now - 60000)
        if recent['unique'] < 50 or recent['last600P95Ms'] > 3000 or now - app['at'] > 30000:
            raise SystemExit('At least 50 healthy receipts in the last minute and a fresh heartbeat are required')
        baseline = {'startedAt': now, 'minimumDurationSeconds': 86400, 'app': app,
                    'receipts': recent, 'runtime': snapshot()}
        with path.open('x') as file:
            json.dump(baseline, file, indent=2)
        print(json.dumps({'status': 'running', 'startedAt': now, 'earliestFinishAt': now + 86400000}))
        return
    baseline = json.loads(path.read_text())
    data = summary(db, baseline['startedAt'])
    with sqlite3.connect(ROOT / 'runtime.sqlite') as health:
        minimum, oom, samples, last_health = health.execute('SELECT MIN(available_mib),MAX(emulator_oom+broker_oom),COUNT(*),MAX(at) FROM health WHERE at>=?',
                                                           (baseline['startedAt'] // 1000,)).fetchone()
        health_gap = health.execute('SELECT MAX(gap) FROM (SELECT at-LAG(at) OVER (ORDER BY at) AS gap FROM health WHERE at>=?)',
                                    (baseline['startedAt'] // 1000,)).fetchone()[0]
    checks = {
        'elapsed24Hours': now - baseline['startedAt'] >= 86400000 and data['observedSeconds'] >= 86400,
        'continuousSamples': data['unique'] > 0 and data['missingSequences'] == 0 and data['samplingGapsOver2500Ms'] == 0,
        'freshReceipts': data['lastReceivedAt'] is not None and now - data['lastReceivedAt'] <= 5000,
        'steadyLatencyWithin3s': data['last600P95Ms'] is not None and data['last600P95Ms'] <= 3000,
        'noInvalidOrConflictingMessages': all(data['counters'].get(key, 0) == baseline['receipts']['counters'].get(key, 0)
                                             for key in ['invalid', 'identity_conflicts']),
        'appHealthy': now - app['at'] < 30000 and app['running'] and not app['offline'] and app['pending'] <= 2
                      and app['connection'] == '已连接' and app['dropped'] == baseline['app']['dropped'],
        'runtimeUnchanged': snapshot() == baseline['runtime'],
        'capacityHealthy': minimum is not None and minimum >= 2048 and oom == 0 and samples > 0,
        'healthCoverage': last_health is not None and now // 1000 - last_health <= 30
                          and (health_gap is None or health_gap <= 60)
                          and samples >= max(1, (now - baseline['startedAt']) // 30000),
        'noCapacityStop': not (ROOT / 'capacity-stopped').exists(),
    }
    failures = [name for name, passed in checks.items() if not passed and name != 'elapsed24Hours']
    result = {'status': 'failed' if failures else 'passed' if checks['elapsed24Hours'] else 'running',
              'startedAt': baseline['startedAt'], 'checkedAt': now,
              'elapsedSeconds': (now - baseline['startedAt']) / 1000,
              'checks': checks, 'receipts': data, 'minimumAvailableMiB': minimum,
              'healthSamples': samples, 'maxHealthGapSeconds': health_gap, 'failures': failures}
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
