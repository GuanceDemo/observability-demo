"""Read-only live view of validated, deduplicated MQTT receipts."""
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
from pathlib import Path
import sqlite3
import threading
import time

VEHICLE_ID = 'demo-vehicle-001'  # Same fixed identity accepted by observer.validate.
WINDOW_MS = 60000
SHANGHAI = timezone(timedelta(hours=8))


def receipt_snapshot(database, connected, now_ms=None):
    now = time.time_ns() // 1_000_000 if now_ms is None else now_ms
    day = datetime.fromtimestamp(now / 1000, SHANGHAI).replace(hour=0, minute=0, second=0, microsecond=0)
    day_start = int(day.timestamp() * 1000)
    # URI read-only plus query_only prevents a reporting request from writing or
    # creating the database. One transaction keeps counts and latest state coherent.
    db = sqlite3.connect(Path(database).resolve().as_uri() + '?mode=ro', uri=True, timeout=2)
    try:
        db.execute('PRAGMA query_only=ON')
        db.execute('BEGIN')
        minute = db.execute('SELECT COUNT(*) FROM receipts WHERE received_at>? AND received_at<=?',
                            (now - WINDOW_MS, now)).fetchone()[0]
        today = db.execute('SELECT COUNT(*) FROM receipts WHERE received_at>=? AND received_at<=?',
                           (day_start, now)).fetchone()[0]
        received = db.execute('SELECT MAX(received_at) FROM receipts WHERE received_at<=?', (now,)).fetchone()[0]
        # A delayed older event may be the most recently received; it must not
        # replace the newer source sequence's mode, battery or temperature.
        latest = db.execute('SELECT sequence,event_time,payload FROM receipts ORDER BY sequence DESC LIMIT 1').fetchone()
    finally:
        db.close()
    vehicle = {'vehicleId': VEHICLE_ID, 'lastReceivedAt': received, 'lastEventAt': None,
               'sequence': None, 'mode': None, 'batterySocPct': None, 'batteryTempC': None,
               'speedKph': None, 'stateFresh': False, 'receivedLastMinute': minute,
               'receivedToday': today, 'status': 'unknown' if not connected else 'waiting'}
    if latest:
        event = json.loads(latest[2])
        if (event.get('vehicleId') != VEHICLE_ID or event.get('mode') not in ('DRIVE', 'PARK', 'CHARGE')
                or event.get('sequence') != latest[0] or event.get('eventTime') != latest[1]):
            raise ValueError('INVALID_RECEIPT')
        for field, low, high in [('batterySocPct', 0, 100), ('batteryTempC', -40, 120), ('speedKph', 0, 120)]:
            value = event.get(field)
            if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
                raise ValueError('INVALID_RECEIPT')
            vehicle[field] = value
        vehicle.update(sequence=latest[0], lastEventAt=latest[1], mode=event['mode'],
                       stateFresh=bool(connected and minute and 0 <= now - latest[1] < WINDOW_MS))
        if connected:
            vehicle['status'] = 'reporting' if minute else 'silent'
    modes = {mode: int(vehicle['stateFresh'] and vehicle['mode'] == mode) if connected else None
             for mode in ('DRIVE', 'PARK', 'CHARGE')}
    return {'schemaVersion': 1, 'generatedAt': datetime.fromtimestamp(now / 1000, timezone.utc).isoformat(),
            'windowSeconds': 60, 'source': {'kind': 'mqtt-receipts', 'connected': bool(connected)},
            'totals': {'knownVehicles': 1, 'seenToday': int(today > 0) if connected else None,
                       'reporting': int(vehicle['status'] == 'reporting') if connected else None,
                       'silent': int(vehicle['status'] == 'silent') if connected else None,
                       'receivedLastMinute': minute if connected else None},
            'modes': modes, 'vehicles': [vehicle]}


def live_handler(database, connected):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def send(self, status, body):
            payload = json.dumps(body, allow_nan=False, separators=(',', ':')).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(payload)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            try:
                self.wfile.write(payload)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_GET(self):
            if self.path != '/api/live':
                self.send(404, {'error': 'NOT_FOUND'})
                return
            try:
                self.send(200, receipt_snapshot(database, connected.is_set()))
            except (sqlite3.Error, OSError, ValueError, TypeError, AttributeError):
                self.send(503, {'error': 'LIVE_REPORT_UNAVAILABLE'})

        def do_POST(self):
            self.send(405, {'error': 'METHOD_NOT_ALLOWED'})

        do_PUT = do_PATCH = do_DELETE = do_OPTIONS = do_HEAD = do_POST
    return Handler


def start_live_server(database, connected, port=8093):
    server = ThreadingHTTPServer(('127.0.0.1', port), live_handler(database, connected))
    threading.Thread(target=server.serve_forever, daemon=True, name='receipt-http').start()
    return server
