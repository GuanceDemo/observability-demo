"""Reconcile only the pinned SeaweedFS mini vacuum plugin through loopback API."""

import argparse
import copy
import http.client
import json
import os
import time
from pathlib import Path

CONFIG_PATH = "/api/plugin/job-types/vacuum/config"
READY = Path("/tmp/vacuum-policy-ready")


def desired(current, interval, threshold):
    if not 60 <= interval <= 600 or interval % 60 or not 0.05 <= threshold <= 0.5:
        raise ValueError("invalid vacuum policy")
    if current.get("job_type") != "vacuum":
        raise ValueError("unexpected job type")
    result = copy.deepcopy(current)
    result["admin_runtime"].update(
        enabled=True,
        detection_interval_minutes=interval // 60,
        global_execution_concurrency=1,
        per_worker_execution_concurrency=1,
    )
    result["worker_config_values"]["garbage_threshold"] = {"double_value": threshold}
    return result


def api(method, payload=None):
    connection = http.client.HTTPConnection("127.0.0.1", 23646, timeout=5)
    try:
        connection.request(
            method,
            CONFIG_PATH,
            body=json.dumps(payload) if payload is not None else None,
            headers={"Content-Type": "application/json"},
        )
        response = connection.getresponse()
        body = response.read(65537)
        if response.status != 200 or len(body) > 65536:
            raise RuntimeError("vacuum config API failure")
        return json.loads(body)
    finally:
        connection.close()


def reconcile(interval, threshold, request=api):
    current = request("GET")
    target = desired(current, interval, threshold)
    if current == target:
        return False
    # Preserve all other plugin options; ask the native API to persist JSON + protobuf.
    target.pop("updated_at", None)
    target.pop("updated_by", None)
    request("PUT", target)
    actual = request("GET")
    if actual != desired(actual, interval, threshold):
        raise RuntimeError("vacuum policy readback mismatch")
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    interval = int(os.environ["VACUUM_INTERVAL_SECONDS"])
    threshold = float(os.environ["GARBAGE_THRESHOLD"])
    while True:
        try:
            changed = reconcile(interval, threshold)
            READY.write_text(str(time.time()))
            if changed or args.once:
                print(
                    json.dumps(
                        {
                            "status": "synced",
                            "intervalSeconds": interval,
                            "threshold": threshold,
                        }
                    ),
                    flush=True,
                )
            if args.once:
                return
        except (
            OSError,
            ValueError,
            RuntimeError,
            KeyError,
            TypeError,
            http.client.HTTPException,
        ) as e:
            print(
                json.dumps({"status": "failed", "errorType": type(e).__name__}),
                flush=True,
            )
            if args.once:
                raise SystemExit(1) from None
        time.sleep(30)


if __name__ == "__main__":
    main()
