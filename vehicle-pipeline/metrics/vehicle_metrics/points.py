"""Small standard-library metric contract shared with the Android host sampler."""

import json
import math
import os
import re
from urllib.request import Request, urlopen

PIPELINE = "vehicle-telemetry"
CLUSTER = "c0eba4a54613c4adfb108e850e1c7c7d5"


def validate_workspace(value):
    if not isinstance(value, str) or not re.fullmatch(r"wksp_[A-Za-z0-9]{16,}", value):
        raise ValueError("invalid_workspace")
    return value


def correlation_tags():
    return {
        "pipeline": PIPELINE,
        "cluster": os.getenv("PIPELINE_CLUSTER", CLUSTER),
        "topic": os.getenv("KAFKA_TOPIC", "vehicle.telemetry.raw.v1"),
        "consumer_group": os.getenv("KAFKA_GROUP", "vehicle-flink-clean-v1"),
    }


def number(value):
    if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
        raise ValueError("invalid_metric_value")
    return value


def point(component, fields, timestamp, **tags):
    if not fields:
        raise ValueError("empty_metric")
    return {
        "measurement": "vehicle_pipeline_" + component,
        "tags": {**correlation_tags(), "component": component, **tags},
        "fields": {k: number(v) for k, v in fields.items()},
        "time": int(timestamp * 1e9),
    }


def escape(value):
    value = str(value)
    if any(c in value for c in "\n\r\x00"):
        raise ValueError("invalid_metric_label")
    return value.replace("\\", "\\\\").replace(" ", "\\ ").replace(",", "\\,").replace("=", "\\=")


def encode(points):
    lines = []
    for p in points:
        tags = ",".join(escape(k) + "=" + escape(v) for k, v in sorted(p["tags"].items()))
        values = []
        for k, v in sorted(p["fields"].items()):
            # Only the presentation measurement has an explicit UNKNOWN sentinel.
            if not (
                p["measurement"] in {"vehicle_pipeline_stage", "vehicle_pipeline_flow"}
                and type(v) is int
                and v == -1
            ):
                number(v)
            values.append(escape(k) + "=" + (str(v) + "i" if type(v) is int else repr(v)))
        fields = ",".join(values)
        lines.append(escape(p["measurement"]) + "," + tags + " " + fields + " " + str(p["time"]))
    return ("\n".join(lines) + "\n").encode()


def send(url, points, token=None):
    headers = {"Content-Type": "text/plain; charset=utf-8"}
    if token:
        headers["X-Token"] = token
    req = Request(url, data=encode(points), headers=headers, method="POST")
    with urlopen(req, timeout=8) as response:
        body = response.read(65536)
        if body:
            result = json.loads(body)
            if result.get("error_code") not in (None, "", "dataway.cached"):
                raise ValueError("metric_ingestion_rejected")


def android_sample(lines, now):
    samples = []
    for line in lines.splitlines():
        try:
            item = json.loads(line)
            if item.get("version") == 1 and item.get("event") == "state":
                samples.append(item)
        except (ValueError, AttributeError):
            continue
    latest = max(samples, key=lambda x: x["at"])
    at = number(latest["at"]) / 1000
    if not 0 <= now - at <= 45:
        raise ValueError("android_sample_stale")
    fields = {
        key: number(latest[key]) for key in ("generated", "acknowledged", "dropped", "pending")
    }
    # pending is read separately by the existing app, so allow a one-sample race.
    if (
        abs(fields["generated"] - fields["acknowledged"] - fields["dropped"] - fields["pending"])
        > 1
    ):
        raise ValueError("android_counters_incoherent")
    return point("android", fields, at, vehicle="demo-vehicle-001", scope="device_lifetime")
