#!/usr/bin/env python3
"""Independent MQTT subscriber: commit receipts before ACK, retain seven days."""
import argparse
import json
import math
import os
from pathlib import Path
import sqlite3
import threading
import time


def validate(event):
    if not isinstance(event, dict) or event.get('schemaVersion') != 1:
        raise ValueError('schema')
    sequence = event.get('sequence')
    if type(sequence) is not int or sequence <= 0:
        raise ValueError('sequence')
    if event.get('vehicleId') != 'demo-vehicle-001' or event.get('eventId') != f'demo-vehicle-001:{sequence}':
        raise ValueError('identity')
    if not isinstance(event.get('tripId'), str) or not event['tripId']:
        raise ValueError('trip')
    if 'sampleMonotonicMs' in event or 'producerRunId' in event:
        if type(event.get('sampleMonotonicMs')) is not int or event['sampleMonotonicMs'] < 0:
            raise ValueError('monotonic-time')
        if not isinstance(event.get('producerRunId'), str) or not event['producerRunId']:
            raise ValueError('producer-run')
    for field, low, high in [('eventTime', 1, 1e14), ('speedKph', 0, 120),
                             ('odometerKm', 0, 1e9), ('batterySocPct', 0, 100),
                             ('batteryTempC', -40, 120)]:
        value = event.get(field)
        if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
            raise ValueError(field)
    if event.get('mode') not in ('DRIVE', 'PARK', 'CHARGE'):
        raise ValueError('mode')
    if event['mode'] != 'DRIVE' and event['speedKph'] != 0:
        raise ValueError('stationary-speed')
    return event


def connect_db(path):
    db = sqlite3.connect(path)
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('PRAGMA synchronous=FULL')
    db.executescript('''CREATE TABLE IF NOT EXISTS receipts (
      event_id TEXT PRIMARY KEY, sequence INTEGER UNIQUE, event_time INTEGER,
      received_at INTEGER, latency_ms INTEGER, payload TEXT);
      CREATE INDEX IF NOT EXISTS receipts_time ON receipts(received_at);
      CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS status (name TEXT PRIMARY KEY, payload TEXT, received_at INTEGER);
    ''')
    return db


def increment(db, key):
    db.execute('INSERT INTO counters VALUES (?,1) ON CONFLICT(name) DO UPDATE SET value=value+1', (key,))


def record(db, payload, now):
    try:
        event = validate(json.loads(payload))
    except (ValueError, TypeError, UnicodeDecodeError):
        increment(db, 'invalid')
        return False
    cursor = db.execute('INSERT OR IGNORE INTO receipts VALUES (?,?,?,?,?,?)',
                       (event['eventId'], event['sequence'], event['eventTime'], now,
                        now - event['eventTime'], json.dumps(event, separators=(',', ':'))))
    if cursor.rowcount == 0:
        previous = db.execute('SELECT payload FROM receipts WHERE event_id=?', (event['eventId'],)).fetchone()
        increment(db, 'duplicates' if previous and json.loads(previous[0]) == event else 'identity_conflicts')
    return True


def summary(db, since=0):
    count, first, last, start, end = db.execute('''SELECT COUNT(*), MIN(sequence), MAX(sequence),
      MIN(received_at),MAX(received_at) FROM receipts WHERE received_at>=?''', (since,)).fetchone()
    delays = sorted(row[0] for row in db.execute('SELECT latency_ms FROM receipts WHERE received_at>=? ORDER BY sequence DESC LIMIT 600', (since,)))
    gaps = db.execute('''WITH samples AS (
      SELECT sequence,event_time,json_extract(payload,'$.sampleMonotonicMs') AS monotonic,
      json_extract(payload,'$.producerRunId') AS run FROM receipts WHERE received_at>=?
    ), intervals AS (
      SELECT event_time-LAG(event_time) OVER (ORDER BY sequence) AS wall_gap,
      CASE WHEN run IS NOT NULL AND run=LAG(run) OVER (ORDER BY sequence)
        THEN monotonic-LAG(monotonic) OVER (ORDER BY sequence)
        ELSE event_time-LAG(event_time) OVER (ORDER BY sequence) END AS gap FROM samples
    ) SELECT COALESCE(SUM(gap>2500),0),MAX(CASE WHEN gap>2500 THEN gap END),
      COALESCE(SUM(wall_gap>2500),0) FROM intervals''', (since,)).fetchone()
    return {'unique': count, 'firstSequence': first, 'lastSequence': last,
            'missingSequences': (last - first + 1 - count) if count else 0,
            'firstReceivedAt': start, 'lastReceivedAt': end,
            'observedSeconds': (end - start) / 1000 if count else 0,
            'last600P95Ms': delays[max(0, math.ceil(.95 * len(delays)) - 1)] if delays else None,
            'samplingGapsOver2500Ms': gaps[0], 'maxSamplingGapMs': gaps[1],
            'wallClockGapsOver2500Ms': gaps[2],
            'counters': dict(db.execute('SELECT name,value FROM counters'))}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--database', default='/var/lib/vehicle-demo/receipts.sqlite')
    parser.add_argument('--summary', action='store_true')
    parser.add_argument('--since', type=int, default=0)
    args = parser.parse_args()
    os.umask(0o077)
    db = connect_db(args.database)
    if args.summary:
        print(json.dumps(summary(db, args.since)))
        return
    import paho.mqtt.client as mqtt
    from paho.mqtt.properties import Properties
    from paho.mqtt.packettypes import PacketTypes
    credential = json.loads(Path('/etc/vehicle-demo/credentials.json').read_text())
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id='vehicle-independent-observer',
                         protocol=mqtt.MQTTv5, manual_ack=True)
    client.username_pw_set('vehicle-observer', credential['observer'])
    client.reconnect_delay_set(1, 30)
    from live_report import start_live_server
    source_connected = threading.Event()
    # Optional read-only UI feed must not interrupt durable receipt ingestion.
    try:
        start_live_server(args.database, source_connected)
    except OSError:
        print('Live receipt HTTP listener unavailable', flush=True)

    def connected(client, _userdata, _flags, reason, _properties):
        source_connected.clear()
        if reason.is_failure:
            print('MQTT observer connection rejected', flush=True)
            return
        client.subscribe('vehicle/v1/demo-vehicle-001/#', qos=1)
        print('MQTT observer connected', flush=True)

    def subscribed(_client, _userdata, _mid, reasons, _properties):
        if reasons and all(not reason.is_failure for reason in reasons):
            source_connected.set()

    def disconnected(_client, _userdata, _flags, _reason, _properties):
        source_connected.clear()

    def received(client, _userdata, message):
        now = time.time_ns() // 1_000_000
        with db:
            if message.topic.endswith('/telemetry'):
                record(db, message.payload, now)
            elif message.topic.endswith('/status'):
                db.execute('INSERT OR REPLACE INTO status VALUES (?,?,?)', ('vehicle', message.payload.decode(), now))
            # Cleanup is bounded and covers telemetry only; counters remain durable.
            db.execute('DELETE FROM receipts WHERE received_at<?', (now - 7 * 86400000,))
        client.ack(message.mid, message.qos)

    client.on_connect = connected
    client.on_subscribe = subscribed
    client.on_disconnect = disconnected
    client.on_message = received
    properties = Properties(PacketTypes.CONNECT)
    properties.SessionExpiryInterval = 86400
    client.connect('127.0.0.1', 1883, 30, clean_start=False, properties=properties)
    client.loop_forever(retry_first_connection=True)


if __name__ == '__main__':
    main()
