#!/usr/bin/env python3
"""Run on the existing GCP management host; create only a dedicated viewer key."""

import importlib.util
import json
import os
from pathlib import Path


def main():
    os.umask(0o077)
    target = Path("/etc/vehicle-demo/metrics-reader.json")
    if target.exists():
        print("Existing metrics reader file retained")
        return
    spec = importlib.util.spec_from_file_location("broker", "/opt/vehicle-demo/bootstrap-users.py")
    broker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(broker)
    password = json.loads(Path("/etc/vehicle-demo/credentials.json").read_text())["admin"]
    token = broker.request("login", {"username": "admin", "password": password})["token"]
    keys = broker.request("api_key", token=token)
    if any(k["name"] == "vehicle-metrics" for k in keys):
        raise RuntimeError(
            "Reader key exists without its private local secret; do not rotate implicitly"
        )
    key = broker.request(
        "api_key",
        {
            "name": "vehicle-metrics",
            "role": "viewer",
            "enable": True,
            "expired_at": "infinity",
            "desc": "Read-only vehicle pipeline metrics",
        },
        token=token,
    )
    if key["role"] != "viewer":
        raise RuntimeError("Unexpected reader role")
    target.write_text(json.dumps({"api_key": key["api_key"], "api_secret": key["api_secret"]}))
    print("Dedicated EMQX viewer key created")


if __name__ == "__main__":
    main()
