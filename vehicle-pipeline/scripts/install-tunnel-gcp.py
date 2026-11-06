#!/usr/bin/env python3
"""Install the dedicated encrypted tunnel. Secrets arrive only via stdin."""

import ipaddress
import json
import subprocess
import sys
from pathlib import Path

config = json.load(sys.stdin)
for field in ["control_ip", "broker_ip" if config.get("broker_ip") else "kafka_ip"]:
    ipaddress.IPv4Address(config[field])
forwards = ["-L 127.0.0.1:18089:{}:8080".format(config["control_ip"])]
if config.get("broker_ip"):
    forwards.extend("-L 127.0.0.1:{0}:{1}:{0}".format(port, config["broker_ip"])
                    for port in (1883, 8083, 18083))
else:
    forwards.append("-L 172.19.0.1:19092:{}:9094".format(config["kafka_ip"]))
root = Path("/etc/vehicle-demo")
(root / "pipeline.json").write_text(json.dumps(config))
(root / "pipeline.json").chmod(0o600)
(root / "pipeline_known_hosts").write_text(config["known_host"] + "\n")
(root / "pipeline_known_hosts").chmod(0o600)
unit = """[Unit]
Description=Vehicle broker and aggregate report tunnel
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
ExecStart=/usr/bin/ssh -N -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=20 -o ServerAliveCountMax=3 -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/etc/vehicle-demo/pipeline_known_hosts -i /etc/vehicle-demo/pipeline_ed25519 {forwards} vehicle-pipeline-tunnel@120.79.13.13
Restart=always
RestartSec=5
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
MemoryMax=48M
[Install]
WantedBy=multi-user.target
""".format(forwards=" ".join(forwards))
Path("/etc/systemd/system/vehicle-pipeline-tunnel.service").write_text(unit)
subprocess.run(["systemctl", "daemon-reload"], check=True)
subprocess.run(["systemctl", "enable", "--now", "vehicle-pipeline-tunnel"], check=True)
print("Encrypted tunnel installed; restart it to apply changed forwards.")
