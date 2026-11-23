"""Resolve owned trace resources from a bounded, namespace-only Pod cache."""

import ipaddress
import json
import os
import re
import ssl
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlsplit
from urllib.request import Request, urlopen

SERVICES = {
    "emqx": "vehicle-emqx",
    "vehicle-flink-consumer": "vehicle-flink-taskmanager",
    "vehicle-spark-summary": "vehicle-summary",
}
ANDROID = "vehicle-android-producer"
NAME = re.compile(r"[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?\Z")
UID = re.compile(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\Z")
TOKEN_DIR = Path("/var/run/vehicle-identity")
MAX_PODS = 512
MAX_BODY = 2 * 1024 * 1024
TTL = 30


def epoch_us(value):
    return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1_000_000)


class PodCache:
    def __init__(self, namespace, clock=time.monotonic):
        if not NAME.fullmatch(namespace):
            raise ValueError("invalid_namespace")
        self.namespace = namespace
        self.clock = clock
        self.lock = threading.Lock()
        self.pods = ()
        self.refreshed = None

    def replace(self, document):
        items = document["items"]
        if not isinstance(items, list) or len(items) > MAX_PODS:
            raise ValueError("invalid_pod_list")
        if document.get("metadata", {}).get("continue"):
            raise ValueError("incomplete_pod_list")
        pods = []
        for item in items:
            meta, status, spec = item["metadata"], item.get("status", {}), item["spec"]
            app = meta.get("labels", {}).get("app")
            if app not in SERVICES.values() or meta.get("namespace") != self.namespace:
                continue
            name, uid, node = meta.get("name", ""), meta.get("uid", ""), spec.get("nodeName", "")
            owners = [x for x in meta.get("ownerReferences", []) if x.get("controller")]
            kind = "Job" if app == "vehicle-summary" else "ReplicaSet"
            if (not NAME.fullmatch(name) or not UID.fullmatch(uid) or not NAME.fullmatch(node)
                    or len(owners) != 1 or owners[0].get("kind") != kind
                    or not owners[0].get("name", "").startswith(app + "-")):
                continue
            try:
                ip = str(ipaddress.ip_address(status["podIP"]))
                created = epoch_us(meta["creationTimestamp"])
                ends = [epoch_us(meta["deletionTimestamp"])] if meta.get("deletionTimestamp") else []
                for container in status.get("containerStatuses", []):
                    terminated = container.get("state", {}).get("terminated", {})
                    if terminated.get("finishedAt"):
                        ends.append(epoch_us(terminated["finishedAt"]))
            except (KeyError, ValueError, TypeError):
                continue
            # Completed Spark Pods remain useful for the final exporter flush.
            if status.get("phase") not in {"Running", "Succeeded", "Failed"}:
                continue
            pods.append({"app": app, "name": name, "uid": uid, "node": node,
                         "ip": ip, "created": created, "end": min(ends) if ends else None})
        with self.lock:
            self.pods, self.refreshed = tuple(pods), self.clock()

    def ready(self):
        with self.lock:
            return self.refreshed is not None and self.clock() - self.refreshed <= TTL

    def resolve(self, service, instance, source_ip, start):
        if service == ANDROID:
            return {"resource_identity": "not_applicable"}
        unknown = {"resource_identity": "unknown"}
        try:
            source_ip = str(ipaddress.ip_address(source_ip))
        except ValueError:
            return unknown
        with self.lock:
            if self.refreshed is None or self.clock() - self.refreshed > TTL:
                return unknown
            matches = [p for p in self.pods if p["app"] == SERVICES[service]
                       and p["ip"] == source_ip and p["created"] <= start
                       and (p["end"] is None or start < p["end"])
                       and (service == "emqx" or p["name"] == instance)]
        if len(matches) != 1:
            return unknown
        pod = matches[0]
        return {"resource_identity": "kubernetes_pod", "host": pod["node"],
                "pod_name": pod["name"], "pod_namespace": self.namespace,
                "pod_uid": pod["uid"], "pod_ip": pod["ip"]}


def refresh(cache, stop):
    context = ssl.create_default_context(cafile=str(TOKEN_DIR / "ca.crt"))
    host = os.environ["KUBERNETES_SERVICE_HOST"]
    port = int(os.environ.get("KUBERNETES_SERVICE_PORT_HTTPS", "443"))
    if ":" in host:
        host = "[" + host + "]"
    url = f"https://{host}:{port}/api/v1/namespaces/{quote(cache.namespace)}/pods?limit={MAX_PODS}"
    while not stop.is_set():
        try:
            token = (TOKEN_DIR / "token").read_text().strip()
            request = Request(url, headers={"Authorization": "Bearer " + token})
            with urlopen(request, context=context, timeout=2) as response:
                body = response.read(MAX_BODY + 1)
            if len(body) > MAX_BODY:
                raise ValueError("oversized_pod_list")
            cache.replace(json.loads(body))
        except Exception:
            # Do not print Kubernetes bodies, projected tokens, or exception text.
            # Existing evidence expires; no fallback to the receiver hostname.
            pass
        stop.wait(5)


def handler(cache):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            path = urlsplit(self.path)
            if path.path == "/healthz" and not path.query:
                code, value = (200, {"ready": True}) if cache.ready() else (503, {"ready": False})
            else:
                try:
                    if len(self.path) > 1024 or path.path != "/identity":
                        raise ValueError("invalid_request")
                    query = parse_qs(path.query, keep_blank_values=True, strict_parsing=True)
                    if set(query) != {"service", "instance", "ip", "start"}:
                        raise ValueError("invalid_request")
                    if any(len(v) != 1 for v in query.values()):
                        raise ValueError("invalid_request")
                    service, instance, source, start = (query[k][0] for k in
                                                         ("service", "instance", "ip", "start"))
                    if service not in {*SERVICES, ANDROID} or len(instance) > 253 or len(source) > 45:
                        raise ValueError("invalid_request")
                    if not re.fullmatch(r"[a-zA-Z0-9@._-]*", instance):
                        raise ValueError("invalid_request")
                    if not start.isdecimal() or not 10**15 <= int(start) < 10**16:
                        raise ValueError("invalid_request")
                    code, value = 200, cache.resolve(service, instance, source, int(start))
                except (ValueError, KeyError):
                    code, value = 400, {"error": "invalid_request"}
            body = json.dumps(value, separators=(",", ":")).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args):
            pass

    return Handler


if __name__ == "__main__":
    cache = PodCache(os.environ["POD_NAMESPACE"])
    threading.Thread(target=refresh, args=(cache, threading.Event()), daemon=True).start()
    ThreadingHTTPServer(("127.0.0.1", 18093), handler(cache)).serve_forever()
