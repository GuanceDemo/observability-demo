#!/usr/bin/env python3
"""Add one authenticated protobuf-only OTLP route; preserve other Caddy routes.

Requires python3-bcrypt and the optional loopback 18090 SSH forward to DataKit.
"""
import json
import shutil
import subprocess
import time
from pathlib import Path
import bcrypt


def main():
    credentials = json.loads(Path("/etc/vehicle-demo/credentials.json").read_text())
    hashed = bcrypt.hashpw(credentials["publisher"].encode(), bcrypt.gensalt()).decode()
    path = Path("/etc/caddy/Caddyfile")
    original = path.read_text()
    start, end = "  # BEGIN VEHICLE APM", "  # END VEHICLE APM"
    block = '''{start}
  handle /vehicle-otel/v1/traces {{
    @otel method POST
    handle @otel {{
      basicauth {{
        vehicle-publisher {hashed}
      }}
      @protobuf header Content-Type application/x-protobuf
      handle @protobuf {{
        request_body {{
          max_size 1MB
        }}
        rewrite * /otel/v1/traces
        reverse_proxy 127.0.0.1:18090 {{
          header_up -Authorization
        }}
      }}
      respond 415
    }}
    respond 405
  }}
{end}
'''.format(start=start, end=end, hashed=hashed)
    if start in original:
        before, tail = original.split(start, 1)
        updated = before + block + tail.split(end, 1)[1].lstrip("\n")
    else:
        anchor = "  # BEGIN VEHICLE DEMO"
        if original.count(anchor) != 1:
            raise RuntimeError("ambiguous_vehicle_caddy_location")
        updated = original.replace(anchor, block + anchor)
    backup = Path("/etc/vehicle-demo/Caddyfile.before-apm-{}".format(time.time_ns()))
    shutil.copy2(path, backup)
    backup.chmod(0o600)
    path.write_text(updated)
    try:
        subprocess.run(["caddy", "validate", "--config", str(path)], check=True, capture_output=True)
        subprocess.run(["systemctl", "reload", "caddy"], check=True, capture_output=True)
    except subprocess.CalledProcessError as error:
        diagnostic = Path("/etc/vehicle-demo/caddy-apm-validation.err")
        diagnostic.write_bytes(error.stderr or b"")
        diagnostic.chmod(0o600)
        path.write_text(original)
        raise RuntimeError("caddy_apm_validation_failed_original_restored") from None
    print("Authenticated OTLP ingress active; all other routes preserved.")


if __name__ == "__main__":
    main()
