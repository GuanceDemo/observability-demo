#!/usr/bin/env python3
"""Expose only the aggregate GET route; report UI lives in the local workbench."""

import shutil
import subprocess
import time
from pathlib import Path

config = Path("/etc/caddy/Caddyfile")
original = config.read_text()
start, end = "  # BEGIN VEHICLE REPORT", "  # END VEHICLE REPORT"
block = """  # BEGIN VEHICLE REPORT
  @vehicleReport path /vehicle-demo/api/report
  handle @vehicleReport {
    @readOnly method GET
    handle @readOnly {
      rewrite * /api/report
      reverse_proxy 127.0.0.1:18089
    }
    respond 405
  }
  # END VEHICLE REPORT
"""
if start in original:
    before, tail = original.split(start, 1)
    after = tail.split(end, 1)[1]
    updated = before + block + after.lstrip("\n")
else:
    marker = "  # BEGIN VEHICLE DEMO"
    if original.count(marker) != 1:
        raise SystemExit("Expected one vehicle route block")
    updated = original.replace(marker, block + marker)
backup = Path("/etc/vehicle-demo/Caddyfile.before-report-" + str(int(time.time())))
shutil.copy2(config, backup)
backup.chmod(0o600)
config.write_text(updated)
if subprocess.run(
    ["caddy", "validate", "--config", str(config)], check=False, capture_output=True
).returncode:
    config.write_text(original)
    raise SystemExit("Caddy validation failed; original restored")
subprocess.run(["systemctl", "reload", "caddy"], check=True)
print("Aggregate GET route is active; no remote frontend assets are published.")
