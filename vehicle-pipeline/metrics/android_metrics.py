#!/usr/bin/env python3
"""Read the existing dedicated APK's aggregate diagnostics; never control the app."""

import json
import signal
import subprocess
import threading
import time
from pathlib import Path

from vehicle_metrics.flow import FlowProjection
from vehicle_metrics.points import android_sample, point, send, validate_workspace
from vehicle_metrics.presentation import StageProjection


def main():
    config = json.loads(Path("/etc/vehicle-demo/metrics-writer.json").read_text())
    validate_workspace(config.get("workspace"))
    if config["url"] != "https://openway.guance.com/v1/write/metric":
        raise ValueError("unexpected_metric_destination")
    stop = threading.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: stop.set())
    last_sent = None
    projection = StageProjection("android")
    flow = FlowProjection("android")
    while not stop.is_set():
        now = time.time()
        sample = None
        try:
            result = subprocess.run(
                [
                    "/home/cherry/android-sdk/platform-tools/adb",
                    "-s",
                    "emulator-5556",
                    "logcat",
                    "-d",
                    "-t",
                    "20000",
                    "-v",
                    "raw",
                    "-s",
                    "VehicleTelemetry:I",
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                timeout=5,
                check=True,
            )
            sample = android_sample(result.stdout, now)
            points = [point("collector", {"up": 1}, now, source="android")]
            if sample["time"] != last_sent:
                points.append(sample)
        except Exception as error:
            print(
                json.dumps({"event": "android_metric_unavailable", "code": type(error).__name__}),
                flush=True,
            )
            points = [point("collector", {"up": 0}, now, source="android")]
        projected = projection.build([sample] if sample else [], now)
        points.append(projected)
        points.extend(flow.build([sample] if sample else [], now))
        try:
            send(config["url"], points, config["token"])
            if sample:
                last_sent = sample["time"]
        except Exception as error:
            print(
                json.dumps(
                    {"event": "android_metric_delivery_failed", "code": type(error).__name__}
                ),
                flush=True,
            )
        stop.wait(10)


if __name__ == "__main__":
    main()
