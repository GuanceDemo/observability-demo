#!/usr/bin/env python3
"""Read public endpoint/key config on stdin; install a forwarding-only SSH identity."""

import ipaddress
import json
import os
import pwd
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

cfg = json.load(sys.stdin)
user = "vehicle-pipeline-tunnel"
for field in ["control_ip", "source_ip", "broker_ip" if cfg.get("broker_ip") else "kafka_ip"]:
    try:
        ipaddress.IPv4Address(cfg[field])
    except (ValueError, KeyError):
        raise SystemExit("Invalid endpoint") from None
if not re.fullmatch(r"ssh-ed25519 [A-Za-z0-9+/=]+(?: [A-Za-z0-9_-]+)?", cfg["public_key"]):
    raise SystemExit("Invalid public key")
try:
    entry = pwd.getpwnam(user)
except KeyError:
    subprocess.run(
        ["useradd", "--system", "--create-home", "--shell", "/bin/bash", user], check=True
    )
    entry = pwd.getpwnam(user)
folder = Path(entry.pw_dir) / ".ssh"
folder.mkdir(mode=0o700, exist_ok=True)
key = folder / "authorized_keys"
destinations = [(cfg["control_ip"], 8080)]
if cfg.get("broker_ip"):
    destinations.extend((cfg["broker_ip"], port) for port in (1883, 8083, 18083))
else:
    destinations.append((cfg["kafka_ip"], 9094))
key.write_text(
    'from="'
    + cfg["source_ip"]
    + '",no-agent-forwarding,no-X11-forwarding,no-pty,no-user-rc,command="/bin/false",'
    + ",".join(f'permitopen="{host}:{port}"' for host, port in destinations)
    + " "
    + cfg["public_key"]
    + "\n"
)
key.chmod(0o600)
os.chown(str(folder), entry.pw_uid, entry.pw_gid)
os.chown(str(key), entry.pw_uid, entry.pw_gid)
config = Path("/etc/ssh/sshd_config")
original = config.read_text()
start, end = "# BEGIN VEHICLE PIPELINE", "# END VEHICLE PIPELINE"
block = (
    start
    + "\nMatch User "
    + user
    + "\n  AllowTcpForwarding local\n  AllowAgentForwarding no\n  X11Forwarding no\n  PermitTTY no\n  ForceCommand /bin/false\nMatch all\n"
    + end
    + "\n"
)
if start in original:
    before, tail = original.split(start, 1)
    after = tail.split(end, 1)[1]
    updated = before + block + after.lstrip("\n")
else:
    updated = original + "\n" + block
backup = Path("/etc/ssh/sshd_config.before-vehicle-" + str(int(time.time())))
shutil.copy2(config, backup)
config.write_text(updated)
if subprocess.run(
    ["sshd", "-t"], check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE
).returncode:
    config.write_text(original)
    raise SystemExit("SSH validation failed; original restored")
subprocess.run(["systemctl", "reload", "sshd"], check=True)
print("Forward-only identity ready; source and exact destinations are restricted.")
