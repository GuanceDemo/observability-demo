#!/usr/bin/env python3
"""Keep vehicle transport/APK routes; the frontend is served by the local workbench."""
import json
from pathlib import Path
import shutil
import subprocess
import time

route = json.loads(Path('/etc/vehicle-demo/credentials.json').read_text())['route']
config = Path('/etc/caddy/Caddyfile')
original = config.read_text()
start, end = '  # BEGIN VEHICLE DEMO', '  # END VEHICLE DEMO'
block = f'''{start}
  handle /vehicle-mqtt {{
    rewrite * /mqtt
    reverse_proxy 127.0.0.1:8083
  }}
  handle /downloads/vehicle-demo.apk {{
    header Content-Disposition "attachment; filename=vehicle-demo.apk"
    root * /var/www
    file_server
  }}
  handle /vehicle-demo/api/live {{
    @liveReadOnly method GET
    handle @liveReadOnly {{
      rewrite * /api/live
      reverse_proxy 127.0.0.1:8093
    }}
    respond 405
  }}
  @vehicleFrontend {{
    path /vehicle-demo /vehicle-demo/*
    not path /vehicle-demo/api/report /vehicle-demo/api/live
  }}
  handle @vehicleFrontend {{
    respond "Vehicle frontend has moved to the local workbench." 410
  }}
  @vehicleLatest path /{route}/api/v1/emulator/ws-jsep-latest /{route}/api/v1/emulator/latest-video-stats /{route}/api/v1/emulator/activity
  handle @vehicleLatest {{
    uri strip_prefix /{route}
    reverse_proxy 127.0.0.1:8092
  }}
  @vehicleNative path /{route}/api/v1/emulator/ws-jsep /{route}/api/v1/emulator/ice
  handle @vehicleNative {{
    uri strip_prefix /{route}
    reverse_proxy 127.0.0.1:8082
  }}
{end}
'''
if start in original:
    before, tail = original.split(start, 1)
    _, after = tail.split(end, 1)
    updated = before + block + after.lstrip('\n')
else:
    marker = '  handle {\n'
    if original.count(marker) != 1:
        raise SystemExit('Expected exactly one existing fallback; refusing ambiguous Caddy edit')
    updated = original.replace(marker, block + '\n' + marker)
backup = Path(f'/etc/vehicle-demo/Caddyfile.before-{int(time.time())}')
shutil.copy2(config, backup)
backup.chmod(0o600)
config.write_text(updated)
checked = subprocess.run(['caddy', 'validate', '--config', str(config)], capture_output=True)
if checked.returncode:
    config.write_text(original)
    raise SystemExit('Caddy validation failed; original configuration restored')
subprocess.run(['systemctl', 'reload', 'caddy'], check=True)
print('Vehicle transport/APK routes active; remote frontend retired; other routes preserved.')
