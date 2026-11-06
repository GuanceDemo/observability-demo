#!/usr/bin/env python3
"""Local or Gateway-fronted workbench with scoped Kubernetes API fault control."""
import argparse
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
import re
import secrets
import threading
import time
from urllib.error import HTTPError
from urllib.parse import unquote, urlencode, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler

from api_control import APIControl
from kube_api import InClusterAPI, LocalAPI

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
STATIC = REPO / 'order-service/src/main/resources/static'
GAME_STATIC = REPO / 'game-service/src/main/resources/static'
PLAYER_STATIC = Path(os.environ.get('VEHICLE_PLAYER_ASSETS', REPO / '.local-work/vehicle-demo/player/web'))
CATALOG = [
    {'id': 'spark_fail', 'name': 'Spark · 输入字段不匹配', 'job': 'vehicle_summary', 'ttl': 300,
     'description': '模拟上游电量字段改名，汇总 SQL 因找不到原字段而失败。上一成功报表保留，恢复后按正确字段重新汇总。', 'expected': 'SQL 解析失败 → 新运行成功'},
    {'id': 'flink_pause', 'name': 'Flink · 执行失败与恢复', 'job': 'vehicle_clean_and_detect', 'ttl': 120,
     'description': '停止专用处理节点，触发真实执行异常并保留失败运行。恢复节点后从检查点重新执行，产生新的运行记录。', 'expected': '执行失败 FAIL → 新执行 RUNNING'},
    {'id': 'emqx_backlog', 'name': 'EMQX · 转发积压', 'job': 'emqx_telemetry_to_kafka', 'ttl': 60,
     'description': '暂时阻塞 EMQX 内部发送，消息继续接收并进入磁盘队列；Kafka 保持运行，恢复后补发并清空积压。', 'expected': '内部积压增长 → 恢复补发 · 作业保持运行'},
]


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def origin(value):
    parsed = urlsplit(value)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/'):
        raise argparse.ArgumentTypeError('Expected an HTTP(S) origin, without credentials or path')
    return value.rstrip('/')


def static_file(path):
    """Union of service-owned public assets, never a repository-wide file server."""
    if path == '/vehicle-demo/prototype.css':
        filename = HERE / 'web/prototype.css'
        return filename if filename.is_file() else None
    if path.startswith('/vehicle-demo/player/'):
        relative = path[len('/vehicle-demo/player/'):] or 'index.html'
        candidates = [(PLAYER_STATIC, relative)]
    elif path.startswith('/vehicle-demo/'):
        candidates = [(HERE / 'web', path[len('/vehicle-demo/'):])]
    else:
        candidates = [(root, path.lstrip('/')) for root in (STATIC, GAME_STATIC)]
    for root, relative in candidates:
        filename = (root / relative).resolve()
        if filename.is_relative_to(root.resolve()) and filename.is_file():
            return filename
    return None


class Gateway:
    def __init__(self, options):
        self.options = options
        self.cluster = getattr(options, 'mode', 'local') == 'cluster'
        self.public_origin = getattr(options, 'public_origin', '')
        self.gateway_token = os.environ.get('VEHICLE_GATEWAY_TOKEN', '')
        if self.cluster:
            if not self.public_origin.startswith('https://') or origin(self.public_origin) != self.public_origin:
                raise ValueError('PUBLIC_HTTPS_ORIGIN_REQUIRED')
            if not re.fullmatch(r'[A-Za-z0-9_-]{32,}', self.gateway_token):
                raise ValueError('GATEWAY_TOKEN_REQUIRED')
        self.report_url = getattr(options, 'report_url', '') or options.vehicle_origin + '/vehicle-demo/api/report'
        if self.cluster:
            report = urlsplit(self.report_url)
            if (not getattr(options, 'report_url', '') or report.scheme not in ('http', 'https')
                    or not report.hostname or report.username or report.password
                    or report.query or report.fragment or report.path != '/api/report'):
                raise ValueError('INTERNAL_REPORT_URL_REQUIRED')
        self.token = secrets.token_urlsafe(32)
        self.http = build_opener(NoRedirect())
        self.lock = threading.Lock()
        self.cached_status = None
        self.cached_at = 0
        self.api_control = APIControl(
            getattr(options, 'kubeconfig', '~/.kube/config'),
            getattr(options, 'kube_context', ''), self.report,
            api_factory=InClusterAPI if self.cluster else LocalAPI)

    def report(self):
        status, _, payload = self.fetch(self.report_url)
        if status != 200:
            raise ValueError('REPORT_UNAVAILABLE')
        return json.loads(payload)

    def fetch(self, url, method='GET', body=None, headers=None):
        request = Request(url, data=body, headers=headers or {}, method=method)
        try:
            response = self.http.open(request, timeout=12)
        except HTTPError as error:
            response = error
        with response:
            payload = response.read(32 * 1024 * 1024 + 1)
            if len(payload) > 32 * 1024 * 1024:
                raise ValueError('UPSTREAM_RESPONSE_TOO_LARGE')
            return response.status, response.headers, payload

    def player_url(self):
        config_path = getattr(self.options, 'player_config', '')
        try:
            payload = Path(config_path).read_text()
            if len(payload) > 4096:
                raise ValueError()
            config = json.loads(payload)
        except (OSError, ValueError):
            raise ValueError('PLAYER_CONFIG_UNAVAILABLE') from None
        endpoint = config.get('endpoint') if isinstance(config, dict) else None
        if not isinstance(endpoint, str):
            raise ValueError('PLAYER_CONFIG_INVALID')
        parsed = urlsplit(endpoint)
        if (parsed.scheme != 'https' or parsed.username or parsed.password
                or parsed.query or parsed.fragment
                or parsed.scheme + '://' + parsed.netloc != self.options.vehicle_origin
                or not re.fullmatch(r'/[a-zA-Z0-9/_-]+', parsed.path)):
            raise ValueError('PLAYER_CONFIG_INVALID')
        if not (PLAYER_STATIC / 'index.html').is_file():
            raise ValueError('PLAYER_ASSETS_MISSING')
        return '/vehicle-demo/player/?' + urlencode({
            'url': endpoint.rstrip('/'), 'embedded': '1',
            'latestVideo': '1', 'rtcTransport': 'relay'})

    def control(self, action, values=None):
        if not self.lock.acquire(timeout=1):
            return {'error': 'CONTROL_BUSY_RETRY'}
        try:
            if action == 'status' and self.cached_status and time.monotonic() - self.cached_at < 5:
                return self.cached_status
            output = self.api_control.execute(action, values)
            self.cached_status, self.cached_at = output, time.monotonic()
            return output
        finally:
            self.lock.release()


def handler(gateway):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            # Paths can carry session information; keep local logs free of request data.
            pass

        def trusted(self, mutation=False):
            if gateway.cluster:
                supplied_token = self.headers.get('X-Vehicle-Gateway-Token', '')
                if not hmac.compare_digest(supplied_token.encode(), gateway.gateway_token.encode()):
                    return False
                supplied_origin = self.headers.get('Origin')
                if supplied_origin and supplied_origin != gateway.public_origin:
                    return False
                if self.headers.get('Sec-Fetch-Site') == 'cross-site':
                    return False
                return not mutation or (supplied_origin == gateway.public_origin and hmac.compare_digest(
                    self.headers.get('X-Vehicle-Token', '').encode(), gateway.token.encode()))
            host = self.headers.get('Host', '')
            allowed = {'127.0.0.1:' + str(self.server.server_port), 'localhost:' + str(self.server.server_port)}
            if host not in allowed:
                return False
            supplied_origin = self.headers.get('Origin')
            if supplied_origin and supplied_origin != 'http://' + host:
                return False
            if self.headers.get('Sec-Fetch-Site') == 'cross-site':
                return False
            if mutation:
                return supplied_origin == 'http://' + host and hmac.compare_digest(
                    self.headers.get('X-Vehicle-Token', ''), gateway.token)
            return True

        def send(self, status, body, content_type='application/json; charset=utf-8', extra=None):
            if not isinstance(body, bytes):
                body = json.dumps(body, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            for name, value in extra or []:
                self.send_header(name, value)
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(body)

        def proxy(self, base, body=None):
            headers = {}
            if base == gateway.options.mall_origin:
                for key in ('Cookie', 'Content-Type', 'X-Demo-Language', 'Authorization',
                            'X-Demo-Visitor-Id', 'X-Demo-Session', 'X-Demo-User',
                            'traceparent', 'tracestate', 'X-Datadog-Trace-Id',
                            'X-Datadog-Parent-Id', 'X-Datadog-Sampling-Priority',
                            'X-Datadog-Origin', 'X-Datadog-Tags'):
                    if self.headers.get(key):
                        headers[key] = self.headers[key]
            status, response_headers, payload = gateway.fetch(base + self.path, self.command, body, headers)
            extra = [('Set-Cookie', value) for value in response_headers.get_all('Set-Cookie', [])]
            self.send(status, payload, response_headers.get('Content-Type', 'application/octet-stream'), extra)

        def get(self):
            if self.path == '/healthz':
                self.send(200, {'status': 'ok'})
                return
            if not self.trusted():
                self.send(403, {'error': 'GATEWAY_OR_ORIGIN_REQUIRED' if gateway.cluster else 'LOCAL_ORIGIN_REQUIRED'})
                return
            path = unquote(urlsplit(self.path).path)
            if gateway.cluster and not path.startswith(('/api/vehicle/', '/vehicle-demo/')):
                self.send(404, {'error': 'NOT_FOUND'})
                return
            if path == '/':
                self.send(302, b'', extra=[('Location', '/business.html?scene=vehicle-telemetry&view=web')])
            elif path == '/api/vehicle/config':
                self.send(200, {'token': gateway.token, 'catalog': CATALOG,
                               'guanceWorkspace': os.environ.get('GUANCE_WORKSPACE_ID', ''),
                               'vehicleOrigin': gateway.options.vehicle_origin,
                               'mode': 'cluster' if gateway.cluster else 'local-remote-pipeline',
                               'controlMode': 'kubernetes-api'})
            elif path == '/api/vehicle/player':
                try:
                    self.send(200, {'playerUrl': gateway.player_url()})
                except ValueError as error:
                    known = {'PLAYER_CONFIG_UNAVAILABLE', 'PLAYER_CONFIG_INVALID', 'PLAYER_ASSETS_MISSING'}
                    self.send(503, {'error': str(error) if str(error) in known else 'PLAYER_CONFIG_INVALID'})
            elif path == '/api/vehicle/faults':
                data = gateway.control('status')
                self.send(502 if data.get('error') else 200, data)
            elif path == '/vehicle-demo/api/report':
                status, headers, payload = gateway.fetch(gateway.report_url)
                self.send(status, payload, headers.get('Content-Type', 'application/json'))
            elif path == '/vehicle-demo/api/live':
                self.proxy(gateway.options.vehicle_origin)
            elif path.startswith('/api/') or path.startswith('/rum-proxy'):
                self.proxy(gateway.options.mall_origin)
            else:
                filename = static_file(path)
                if filename is None:
                    self.send(404, {'error': 'NOT_FOUND'})
                    return
                payload = filename.read_bytes()
                if filename == STATIC / 'business.html':
                    payload = payload.replace(b'<head>', b'<head>\n<script>window.VEHICLE_LOCAL_ENABLED=true;</script>', 1)
                self.send(200, payload, mimetypes.guess_type(str(filename))[0] or 'application/octet-stream')

        def do_GET(self):
            try:
                self.get()
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception:
                self.send(502, {'error': 'UPSTREAM_UNAVAILABLE'})

        do_HEAD = do_GET

        def do_DELETE(self):
            if gateway.cluster:
                self.send(405, {'error': 'METHOD_NOT_ALLOWED'})
                return
            if not self.trusted():
                self.send(403, {'error': 'GATEWAY_OR_ORIGIN_REQUIRED' if gateway.cluster else 'LOCAL_ORIGIN_REQUIRED'})
                return
            if urlsplit(self.path).path != '/api/demo/auth/session':
                self.send(405, {'error': 'METHOD_NOT_ALLOWED'})
                return
            try:
                self.proxy(gateway.options.mall_origin)
            except Exception:
                self.send(502, {'error': 'UPSTREAM_UNAVAILABLE'})

        def do_POST(self):
            path = urlsplit(self.path).path
            is_vehicle = path.startswith('/api/vehicle/')
            if gateway.cluster and not is_vehicle:
                self.send(405, {'error': 'METHOD_NOT_ALLOWED'})
                return
            if not self.trusted(mutation=is_vehicle):
                self.send(403, {'error': 'GATEWAY_OR_ORIGIN_REQUIRED' if gateway.cluster else 'LOCAL_ORIGIN_REQUIRED'})
                return
            if path == '/vehicle-demo/api/live':
                self.send(405, {'error': 'METHOD_NOT_ALLOWED'})
                return
            try:
                size = int(self.headers.get('Content-Length', '0'))
                limit = 4096 if is_vehicle else 8 * 1024 * 1024
                if not 0 <= size <= limit or (is_vehicle and size == 0):
                    self.send(413, {'error': 'INVALID_BODY_SIZE'})
                    return
                raw = self.rfile.read(size)
                if not is_vehicle:
                    if not path.startswith(('/api/', '/rum-proxy')):
                        self.send(404, {'error': 'NOT_FOUND'})
                        return
                    self.proxy(gateway.options.mall_origin, raw)
                    return
                data = json.loads(raw)
                if not isinstance(data, dict):
                    raise ValueError()
                if path == '/api/vehicle/faults/inject':
                    if set(data) != {'scenario', 'requestId'} or data['scenario'] not in {c['id'] for c in CATALOG} or not re.fullmatch(r'[a-f0-9-]{32,36}', str(data['requestId'])):
                        raise ValueError()
                    result = gateway.control('inject', data)
                elif path == '/api/vehicle/faults/recover':
                    if set(data) != {'operationId'} or not re.fullmatch(r'[a-f0-9]{32}', str(data['operationId'])):
                        raise ValueError()
                    result = gateway.control('recover', data)
                else:
                    self.send(404, {'error': 'NOT_FOUND'})
                    return
                self.send(409 if result.get('error') else 202, result)
            except (ValueError, TypeError):
                self.send(400, {'error': 'INVALID_REQUEST'})
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception:
                self.send(502, {'error': 'UPSTREAM_UNAVAILABLE'})

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8767)
    parser.add_argument('--mode', choices=['local', 'cluster'], default=os.environ.get('VEHICLE_MODE', 'local'))
    parser.add_argument('--public-origin', type=lambda value: origin(value) if value else '', default=os.environ.get('VEHICLE_PUBLIC_ORIGIN', ''))
    parser.add_argument('--report-url', default=os.environ.get('VEHICLE_REPORT_URL', ''))
    parser.add_argument('--bind', choices=['127.0.0.1', '0.0.0.0'], default='127.0.0.1',
                        help='Container listener; local mode must publish on loopback only')
    parser.add_argument('--mall-origin', type=origin, default=os.environ.get('VEHICLE_MALL_ORIGIN', 'http://127.0.0.1:18080'))
    parser.add_argument('--vehicle-origin', type=origin, default=os.environ.get('VEHICLE_REMOTE_ORIGIN', 'https://35.241.68.75.nip.io'))
    parser.add_argument('--player-config', default=os.environ.get('VEHICLE_PLAYER_CONFIG', str(REPO / '.local-work/vehicle-demo/player/config.json')))
    parser.add_argument('--kubeconfig', default=os.environ.get('VEHICLE_KUBECONFIG', '~/.kube/config'))
    parser.add_argument('--kube-context', default=os.environ.get('VEHICLE_KUBE_CONTEXT', ''))
    options = parser.parse_args()
    server = ThreadingHTTPServer((options.bind, options.port), handler(Gateway(options)))
    print('Vehicle workbench ready: mode=' + options.mode + ', port=' + str(options.port), flush=True)
    print('No remote resources are changed on startup. Faults run only on explicit authenticated button requests.', flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
