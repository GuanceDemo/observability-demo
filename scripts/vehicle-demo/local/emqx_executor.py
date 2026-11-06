"""Fixed, version-pinned EMQX producer fault instrumentation. No broker API key."""

import json
import re
import time
from pathlib import Path
from urllib.parse import urlencode

from kube_api import ControlError

EMQX_IMAGE = (
    "pubrepo.jiagouyun.com/demo/vehicle-emqx:6.3.2@sha256:"
    "135116400e11b25224350b2e55c874f4e224d357b593fb554ca1b1f398c631ac"
)
GATE_MODE = "send-window-v1"


def command(action, operation):
    if action not in ("inject", "restore", "status") or not re.fullmatch(
        r"[a-f0-9]{32}", operation["id"]
    ):
        raise ControlError("EMQX_GATE_INVALID_REQUEST")
    root = Path(__file__).resolve().parent
    producer = operation.get("emqxTarget", {}).get("producer", "")
    if (producer and not re.fullmatch(r"<\d+\.\d+\.\d+>", producer)) or (
        action == "inject" and not producer
    ):
        raise ControlError("EMQX_GATE_INVALID_REQUEST")
    deadline = int(operation.get("deadline", 0) * 1000) if action == "inject" else 0
    source = (root / "emqx_gate.expr").read_text().strip()
    source = (
        source.replace("__OP__", operation["id"])
        .replace("__ACTION__", action)
        .replace("__DEADLINE__", str(deadline))
        .replace("__PRODUCER__", producer)
    )
    return ["sh", "-c", (root / "emqx_rpc.sh").read_text(), "vehicle-emqx-gate", source]


def exec_in_cluster(api, pod, argv):
    """Kubernetes v4 exec channels, verified TLS, bounded output, fresh SA token."""
    import websocket

    query = urlencode(
        [
            ("container", "emqx"),
            ("stdout", "true"),
            ("stderr", "true"),
            *[("command", part) for part in argv],
        ]
    )
    url = (
        api.origin.replace("https://", "wss://", 1)
        + api.path("pod", pod)
        + "/exec?"
        + query
    )
    connection = None
    output, total, status = [], 0, None
    try:
        connection = websocket.create_connection(
            url,
            timeout=5,
            subprotocols=["v4.channel.k8s.io"],
            header={"Authorization": "Bearer " + api.token_file.read_text().strip()},
            sslopt={"context": api.tls},
            suppress_origin=True,
        )
        if connection.getsubprotocol() != "v4.channel.k8s.io":
            raise ControlError("EMQX_EXEC_UNAVAILABLE")
        until = time.monotonic() + 12
        while time.monotonic() < until:
            message = connection.recv()
            if not message:
                break
            if isinstance(message, str):
                message = message.encode()
            total += len(message)
            if total > 32768:
                raise ControlError("EMQX_EXEC_UNAVAILABLE")
            if message[0] == 1:
                output.append(message[1:].decode())
            elif message[0] == 3:
                status = json.loads(message[1:])
                break
            # stderr is deliberately never exposed: RPC failures can include state.
        if not status or status.get("status") != "Success":
            raise ControlError("EMQX_EXEC_UNAVAILABLE")
        return "".join(output)
    except ControlError:
        raise
    except (websocket.WebSocketException, OSError, ValueError):
        raise ControlError("EMQX_EXEC_UNAVAILABLE") from None
    finally:
        if connection:
            connection.close()


class EmqxGate:
    def __init__(self, api, executor=exec_in_cluster):
        self.api, self.executor = api, executor

    def pod(self, saved=None):
        pods = self.api.list("pod", "app=vehicle-emqx")
        pods = [p for p in pods if not p["metadata"].get("deletionTimestamp")]
        if len(pods) != 1:
            raise ControlError("EMQX_TARGET_NOT_READY")
        pod = pods[0]
        meta, spec = pod["metadata"], pod["spec"]
        containers = spec.get("containers", [])
        if (
            not meta["name"].startswith("vehicle-emqx-")
            or meta.get("labels", {}).get("app") != "vehicle-emqx"
            or len(containers) != 1
            or containers[0].get("name") != "emqx"
            or containers[0].get("image") != EMQX_IMAGE
            or spec.get("hostname") != "vehicle-emqx"
            or not any(
                x.get("type") == "Ready" and x.get("status") == "True"
                for x in pod.get("status", {}).get("conditions", [])
            )
        ):
            raise ControlError("EMQX_TARGET_NOT_READY")
        target = {"name": meta["name"], "uid": meta["uid"], "image": EMQX_IMAGE}
        if saved is not None and {k: saved.get(k) for k in target} != target:
            raise ControlError("RESOURCE_REPLACED")
        if not self.api.can("", "pods/exec", "get", meta["name"]):
            raise ControlError("EMQX_EXECUTOR_NOT_CONFIGURED")
        return target

    def prepare(self, op):
        target = self.pod()
        probe = self.call("status", dict(op, emqxTarget=target))
        if probe["gated"] or probe["window"] != 0 or probe["queued"] != 0:
            raise ControlError("UPSTREAM_ALREADY_UNHEALTHY")
        return dict(target, producer=probe["producer"])

    def call(self, action, op):
        target = self.pod(op["emqxTarget"])
        if action != "status" and self.api.before_write:
            self.api.before_write()
        output = self.executor(self.api, target["name"], command(action, op))
        try:
            lines = [
                line
                for line in output.splitlines()
                if line.startswith("VEHICLE_EMQX_GATE=")
            ]
            result = json.loads(lines[-1].partition("=")[2])
            if (
                result.get("ok") is not True
                or type(result.get("queued")) is not int
                or result["queued"] < 0
                or type(result.get("gated")) is not bool
                or type(result.get("window")) is not int
                or result["window"] not in (-1, 0)
                or not re.fullmatch(r"<\d+\.\d+\.\d+>", result.get("producer", ""))
            ):
                raise ValueError()
            if action == "inject" and (
                not result["gated"]
                or result.get("operation") != op["id"]
                or result.get("deadline") != int(op["deadline"] * 1000)
            ):
                raise ValueError()
            if action == "restore" and result["gated"]:
                raise ValueError()
            return result
        except (ValueError, IndexError, KeyError, TypeError):
            raise ControlError("EMQX_GATE_CONTRACT_FAILED") from None
