#!/usr/bin/env python3
"""Root-only, idempotent broker bootstrap. Never prints credentials."""
import json
import os
from pathlib import Path
import secrets
import subprocess


def main():
    os.umask(0o077)
    root = Path('/etc/vehicle-demo')
    root.mkdir(mode=0o750, exist_ok=True)
    path = root / 'credentials.json'
    if not path.exists():
        existing_data = subprocess.run(['docker', 'volume', 'inspect', 'vehicle-demo_emqx-data'],
                                       capture_output=True)
        if existing_data.returncode == 0:
            raise SystemExit('Broker data exists but credentials are missing; restore the protected backup before proceeding')
        path.write_text(json.dumps({
            'admin': secrets.token_urlsafe(32),
            'publisher': secrets.token_urlsafe(32),
            'observer': secrets.token_urlsafe(32),
            'route': 'vehicle-' + secrets.token_hex(20),
        }) + '\n')
    credentials = json.loads(path.read_text())
    conf = '''node { name = "emqx@vehicle-emqx" cookie = "__COOKIE__" data_dir = "/opt/emqx/data" }
log.console.level = warning
durable_sessions { enable = true message_retention_period = "7d" }
durable_storage { n_sites = 1 messages { n_shards = 1 replication_factor = 1 } }
dashboard { listeners.http.bind = 18083 default_username = "admin" default_password = "__ADMIN__" }
listeners.tcp.default { bind = "0.0.0.0:1883" max_connections = 32 }
listeners.ws.default { bind = "0.0.0.0:8083" max_connections = 32 websocket.mqtt_path = "/mqtt" }
listeners.ssl.default.enable = false
listeners.wss.default.enable = false
authentication = [{ mechanism = password_based backend = built_in_database user_id_type = username
  password_hash_algorithm { name = sha256 salt_position = suffix } }]
authorization { no_match = deny deny_action = ignore
  sources = [{ type = file enable = true path = "/opt/emqx/etc/vehicle-acl.conf" }] }
'''
    # Stable node cookie across deployments, held only in the protected config.
    existing = root / 'emqx.conf'
    cookie_path = root / 'node-cookie'
    if not cookie_path.exists():
        cookie_path.write_text(secrets.token_hex(32))
    existing.write_text(conf.replace('__ADMIN__', credentials['admin'])
                       .replace('__COOKIE__', cookie_path.read_text()))
    (root / 'acl.conf').write_text('''{allow, {username, "vehicle-publisher"}, publish, ["vehicle/v1/demo-vehicle-001/telemetry", "vehicle/v1/demo-vehicle-001/status"]}.
{allow, {username, "vehicle-observer"}, subscribe, ["vehicle/v1/demo-vehicle-001/#"]}.
{deny, all}.
''')
    # Image UID 1000 must read the bind mounts; parent stays root-only on the host.
    for item in (existing, root / 'acl.conf'):
        item.chmod(0o644)
    print('Broker configuration prepared; existing credentials retained.')


if __name__ == '__main__':
    main()
