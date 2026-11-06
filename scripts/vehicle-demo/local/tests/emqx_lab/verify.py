import json
import os
import subprocess
import time
import uuid
from pathlib import Path
from urllib.request import Request, urlopen

import paho.mqtt.client as mqtt

ROOT = Path(__file__).resolve().parents[2]
PREFIX = [
    "docker",
    "exec",
    "vehicle-emqx-gate-lab-emqx-1",
    "sh",
    "-c",
    (ROOT / "emqx_rpc.sh").read_text(),
    "gate",
]
expected_producer = ""


def gate(action, op="a" * 32, deadline=0, expect_ok=True, producer=None):
    expr = (
        (ROOT / "emqx_gate.expr")
        .read_text()
        .strip()
        .replace("__OP__", op)
        .replace("__ACTION__", action)
        .replace("__DEADLINE__", str(deadline))
        .replace("__PRODUCER__", expected_producer if producer is None else producer)
    )
    r = subprocess.run(
        PREFIX + [expr], text=True, capture_output=True, timeout=10, check=False
    )
    lines = [x for x in r.stdout.splitlines() if x.startswith("VEHICLE_EMQX_GATE=")]
    assert r.returncode == 0 and lines, (r.returncode, r.stderr)
    v = json.loads(lines[-1].partition("=")[2])
    assert v["ok"] == expect_ok, v
    return v


def api(path, value=None, token=None):
    with urlopen(
        Request(
            "http://127.0.0.1:18183/api/v5/" + path,
            data=None if value is None else json.dumps(value).encode(),
            headers={
                "Content-Type": "application/json",
                **({"Authorization": "Bearer " + token} if token else {}),
            },
        ),
        timeout=10,
    ) as r:
        return json.load(r)


token = api(
    "login", {"username": "admin", "password": os.environ["EMQX_LAB_PASSWORD"]}
)["token"]


def metrics():
    return api("actions/kafka_producer:vehicle_telemetry/metrics", token=token)[
        "metrics"
    ]


client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="isolated-gate-test")
client.connect("127.0.0.1", 19183)
client.loop_start()
received = []
sequence = 0
session = uuid.uuid4().hex
offset = (
    subprocess.check_output(
        [
            "docker",
            "exec",
            "vehicle-emqx-gate-lab-kafka-1",
            "/opt/kafka/bin/kafka-get-offsets.sh",
            "--bootstrap-server",
            "kafka:9092",
            "--topic",
            "vehicle.telemetry.raw.v1",
            "--time",
            "-1",
        ],
        text=True,
    )
    .strip()
    .rsplit(":", 1)[1]
)


def publish(n):
    global sequence
    for _ in range(n):
        sequence += 1
        payload = {
            "vehicleId": "demo-vehicle-001",
            "testId": sequence,
            "testSession": session,
        }
        p = client.publish(
            "vehicle/v1/demo-vehicle-001/telemetry", json.dumps(payload), qos=1
        )
        p.wait_for_publish(3)
        assert p.is_published()
        received.append(sequence)
        time.sleep(0.1)


initial = metrics()
expected_producer = gate("status")["producer"]
publish(5)
time.sleep(1)
proof = {"initial": initial, "baseline": metrics(), "rounds": []}
for mode in ("manual", "watchdog"):
    op = ("a" if mode == "manual" else "b") * 32
    deadline = int(time.time() * 1000) + 10000
    start = gate("inject", op, deadline)
    repeated = gate("inject", op, deadline)
    assert start["gated"] and repeated["deadline"] == deadline
    if mode == "manual":
        gate("restore", "c" * 32, expect_ok=False)
        gate("inject", op, int(time.time() * 1000) + 1000, expect_ok=False)
        time.sleep(2)
        assert gate("status")["gated"], "Rejected retry must not arm an early watchdog"
    publish(35)
    queued = metrics()
    assert queued["queuing"] >= 30 and queued["dropped"] == initial["dropped"], queued
    assert gate("status")["gated"]
    if mode == "manual":
        result = gate("restore", op)
    else:
        # No controller call is made to restore this operation.
        time.sleep(max(0, deadline / 1000 - time.time()) + 1)
        result = gate("status")
    assert not result["gated"], result
    for _ in range(30):
        end = metrics()
        if end["queuing"] == 0 and end["success"] >= initial["success"] + sequence:
            break
        time.sleep(0.2)
    assert (
        end["queuing"] == 0
        and end["dropped"] == initial["dropped"]
        and end["failed"] == initial["failed"]
    ), end
    assert end["success"] - initial["success"] == sequence, end
    proof["rounds"].append(
        {
            "mode": mode,
            "start": start,
            "queued": queued,
            "restored": result,
            "after": end,
        }
    )
gate("inject", "d" * 32, int(time.time() * 1000) + 61000, expect_ok=False)
gate(
    "inject",
    "d" * 32,
    int(time.time() * 1000) + 10000,
    expect_ok=False,
    producer="<0.0.0>",
)
assert not gate("status")["gated"]
client.disconnect()
client.loop_stop()
r = subprocess.run(
    [
        "docker",
        "exec",
        "vehicle-emqx-gate-lab-kafka-1",
        "/opt/kafka/bin/kafka-console-consumer.sh",
        "--bootstrap-server",
        "kafka:9092",
        "--topic",
        "vehicle.telemetry.raw.v1",
        "--partition",
        "0",
        "--offset",
        offset,
        "--max-messages",
        str(sequence),
        "--timeout-ms",
        "10000",
    ],
    capture_output=True,
    text=True,
    timeout=20,
    check=False,
)
messages = [json.loads(x) for x in r.stdout.splitlines() if x.startswith("{")]
assert all(x["testSession"] == session for x in messages)
actual = [x["testId"] for x in messages]
assert r.returncode == 0 and actual == received, (r.returncode, len(actual), sequence)
proof.update(
    published=sequence,
    consumed=len(actual),
    exactOrderedIds=True,
    session=session,
    kafkaStartOffset=offset,
)
Path(
    os.environ.get(
        "EMQX_LAB_PROOF", ".local-work/vehicle-demo/emqx-internal/lab-proof.json"
    )
).write_text(json.dumps(proof, indent=2))
print(
    json.dumps(
        {
            "published": sequence,
            "consumed": len(actual),
            "rounds": [
                {
                    "mode": x["mode"],
                    "queuePeakObserved": x["queued"]["queuing"],
                    "queueAfter": x["after"]["queuing"],
                    "dropped": x["after"]["dropped"],
                }
                for x in proof["rounds"]
            ],
        }
    )
)
