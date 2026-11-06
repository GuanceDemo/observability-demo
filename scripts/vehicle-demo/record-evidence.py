#!/usr/bin/env python3
"""Append a redacted runtime checkpoint for controlled acceptance tests."""
import json
from pathlib import Path
import re
import sys
import time
from acceptance import app_state, snapshot
from observer import connect_db, summary
from watchdog import memory_available

if len(sys.argv) != 2 or not re.fullmatch(r'[a-z0-9-]{1,64}', sys.argv[1]):
    raise SystemExit('Usage: record-evidence.py <short-check-label>')
root = Path('/var/lib/vehicle-demo')
db = connect_db(root / 'receipts.sqlite')
latest = db.execute('SELECT payload FROM receipts ORDER BY sequence DESC LIMIT 1').fetchone()
item = {'check': sys.argv[1], 'at': time.time_ns() // 1_000_000,
        'app': app_state(), 'receipts': summary(db), 'runtime': snapshot(),
        'availableMiB': memory_available(), 'latest': json.loads(latest[0]) if latest else None}
with (root / 'acceptance-evidence.jsonl').open('a') as file:
    file.write(json.dumps(item, ensure_ascii=False) + '\n')
print(json.dumps({key: value for key, value in item.items() if key != 'runtime'}, ensure_ascii=False))
