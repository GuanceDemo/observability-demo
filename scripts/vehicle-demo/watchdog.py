#!/usr/bin/env python3
"""Keep the dedicated activity visible; preserve App pause and offline state."""
import json
from pathlib import Path
import subprocess
import sqlite3
import time

ROOT = Path('/var/lib/vehicle-demo')
PIPELINE = Path('/etc/vehicle-demo/pipeline.json')
ADB = ['/home/cherry/android-sdk/platform-tools/adb', '-s', 'emulator-5556']
ACTIVITY = 'com.guance.vehicledemo/.MainActivity'
UNITS = ['vehicle-demo-video', 'vehicle-demo-gateway', 'vehicle-demo-emulator', 'vehicle-demo-observer']


def run(command):
    return subprocess.run(command, capture_output=True, text=True, timeout=15)


def memory_available():
    return int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines()
                    if line.startswith('MemAvailable:'))) // 1024


def heartbeat_at(output):
    timestamps = []
    for line in output.splitlines():
        try:
            event = json.loads(line[line.index('{'):])
            if event.get('event') == 'state' and event.get('version') == 1:
                timestamps.append(event['at'] / 1000)
        except (ValueError, KeyError, TypeError):
            pass
    return max(timestamps) if timestamps else None


def clock_reading(device_time, before_ms, after_ms):
    text = device_time.strip()
    if not text.isdecimal() or len(text) != 13 or not 0 <= after_ms - before_ms <= 2000:
        raise ValueError('Invalid or delayed Android clock sample')
    return {'offsetMs': (before_ms + after_ms) // 2 - int(text), 'roundTripMs': after_ms - before_ms}


def measure_clock():
    before = time.time_ns() // 1_000_000
    result = run(ADB + ['shell', 'date', '+%s%3N'])
    after = time.time_ns() // 1_000_000
    if result.returncode:
        raise ValueError('Android clock read failed')
    return clock_reading(result.stdout, before, after)


def refresh_clock():
    """Use Android's real network time; never rewrite telemetry receipt times."""
    result = {'at': time.time_ns() // 1_000_000, 'ok': False}
    try:
        result['before'] = measure_clock()
        priority = run(ADB + ['shell', 'cmd', 'device_config', 'put', 'system_time',
                             'time_detector_origin_priorities_override', 'network,telephony'])
        refresh = run(ADB + ['shell', 'cmd', 'network_time_update_service', 'force_refresh'])
        # time_detector applies the network suggestion asynchronously.
        time.sleep(.25)
        result['after'] = measure_clock()
        result['ok'] = priority.returncode == 0 and refresh.returncode == 0 and refresh.stdout.strip() == 'true' \
            and abs(result['after']['offsetMs']) <= 2500
    except (ValueError, OSError, subprocess.TimeoutExpired) as error:
        result['error'] = type(error).__name__
    return result


def remote_broker():
    try:
        return bool(json.loads(PIPELINE.read_text()).get('broker_ip'))
    except (OSError, ValueError):
        # A broken optional config must not stop host/Android capacity checks.
        return False


def local_broker_health():
    if remote_broker():
        return False, False
    result = run(['docker', 'inspect', '-f', '{{.State.OOMKilled}} {{.RestartCount}}', 'vehicle-emqx'])
    values = result.stdout.split()
    return values[:1] == ['true'], len(values) == 2 and int(values[1]) > 0


def stop_new_components(reason):
    (ROOT / 'capacity-stopped').write_text(json.dumps({'at': int(time.time()), 'reason': reason}))
    run(['systemctl', 'stop', *UNITS])
    if not remote_broker():
        run(['docker', 'compose', '-f', '/opt/vehicle-demo/compose.yaml', 'stop'])
    print('New vehicle components stopped: ' + reason, flush=True)


def main():
    ROOT.mkdir(exist_ok=True)
    db = sqlite3.connect(ROOT / 'runtime.sqlite')
    db.execute('CREATE TABLE IF NOT EXISTS health (at INTEGER PRIMARY KEY, available_mib INTEGER, emulator_oom INTEGER, broker_oom INTEGER)')
    db.execute('CREATE TABLE IF NOT EXISTS clock_health (at INTEGER PRIMARY KEY, payload TEXT NOT NULL)')
    born = time.time()
    low_count = 0
    recoveries = []
    next_clock_refresh = 0
    while True:
        if (ROOT / 'capacity-stopped').exists():
            time.sleep(10)
            continue
        available = memory_available()
        low_count = low_count + 1 if available < 2048 else 0
        (ROOT / 'capacity.json').write_text(json.dumps({'at': int(time.time()), 'availableMiB': available}))
        if low_count >= 3:
            stop_new_components('available-memory-below-2048MiB-for-30s')
            continue
        broker_oom, broker_restarted = local_broker_health()
        memory_events = Path('/sys/fs/cgroup/system.slice/vehicle-demo-emulator.service/memory.events')
        events = dict(line.split() for line in memory_events.read_text().splitlines()) if memory_events.exists() else {}
        emulator_oom = int(events.get('oom_kill', '0'))
        with db:
            db.execute('INSERT OR REPLACE INTO health VALUES (?,?,?,?)', (int(time.time()), available, emulator_oom, broker_oom))
            db.execute('DELETE FROM health WHERE at<?', (int(time.time()) - 14 * 86400,))
        failed_oom = any(run(['systemctl', 'show', unit, '--value', '-p', 'Result']).stdout.strip() == 'oom-kill'
                         for unit in UNITS)
        if broker_oom or emulator_oom or failed_oom or broker_restarted:
            stop_new_components('unexpected-broker-restart' if broker_restarted else 'new-component-oom')
            continue
        if (ROOT / 'maintenance').exists():
            time.sleep(10)
            continue
        if run(ADB + ['get-state']).stdout.strip() != 'device':
            time.sleep(10)
            continue
        if time.monotonic() >= next_clock_refresh:
            clock = refresh_clock()
            with db:
                db.execute('INSERT OR REPLACE INTO clock_health VALUES (?,?)', (clock['at'], json.dumps(clock)))
                db.execute('DELETE FROM clock_health WHERE at<?', (clock['at'] - 14 * 86400000,))
            next_clock_refresh = time.monotonic() + (900 if clock['ok'] else 60)
        for unit in ('vehicle-demo-gateway', 'vehicle-demo-video'):
            if run(['systemctl', 'is-active', unit]).stdout.strip() != 'active':
                run(['systemctl', 'start', unit])
        # Starting an existing Activity never changes the persisted sampling state.
        focused = run(ADB + ['shell', 'dumpsys', 'activity', 'activities']).stdout
        foreground = any('ResumedActivity' in line and ACTIVITY in line for line in focused.splitlines())
        # logcat -t counts global log lines before tag filtering. A small -t
        # silently loses our heartbeat on a busy Android image.
        output = run(ADB + ['logcat', '-d', '-s', 'VehicleTelemetry:I', '*:S']).stdout
        last_heartbeat = heartbeat_at(output)
        stalled = time.time() - born > 120 and (last_heartbeat is None or time.time() - last_heartbeat > 90)
        if not foreground or stalled:
            now = time.time()
            recoveries = [value for value in recoveries if now - value < 300]
            if len(recoveries) >= 5:
                print('Activity recovery throttled; inspect Android crash logs', flush=True)
            else:
                if stalled:
                    run(ADB + ['shell', 'am', 'force-stop', 'com.guance.vehicledemo'])
                run(ADB + ['shell', 'am', 'start', '-n', ACTIVITY])
                recoveries.append(now)
                born = now
        time.sleep(10)


if __name__ == '__main__':
    main()
