#!/usr/bin/env python3
"""Smoke-test a local ACK image using dummy endpoints; never call Kubernetes."""
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True).strip()


def main():
    image = sys.argv[1] if len(sys.argv) > 1 else 'observability-demo-vehicle-workbench:ack-check'
    token = 'test-only-gateway-hop-token-0000000000'
    container = None
    with tempfile.TemporaryDirectory(prefix='vehicle-ack-smoke-') as directory:
        # The numeric non-root image user must be able to read this dummy config.
        Path(directory).chmod(0o755)
        config = Path(directory) / 'player-config.json'
        config.write_text(json.dumps({'endpoint': 'https://device.example.test/test-vehicle'}))
        config.chmod(0o644)
        try:
            container = docker('run', '-d', '--rm', '--read-only', '--cap-drop=ALL',
                               '--security-opt=no-new-privileges', '-p', '127.0.0.1::8767',
                               '-v', directory + ':/etc/vehicle-workbench:ro',
                               '-e', 'VEHICLE_GATEWAY_TOKEN=' + token,
                               '-e', 'VEHICLE_PUBLIC_ORIGIN=https://demo.example.test',
                               '-e', 'VEHICLE_REMOTE_ORIGIN=https://device.example.test',
                               '-e', 'VEHICLE_REPORT_URL=http://control.invalid:8080/api/report', image)
            address = docker('port', container, '8767/tcp')
            base = 'http://' + address

            def fetch(path, trusted=True):
                headers = {'X-Vehicle-Gateway-Token': token} if trusted else {}
                try:
                    response = urlopen(Request(base + path, headers=headers), timeout=3)
                except HTTPError as error:
                    response = error
                with response:
                    return response.status, response.read()

            for attempt in range(40):
                try:
                    if fetch('/healthz', False)[0] == 200:
                        break
                except (URLError, ConnectionError):
                    pass
                time.sleep(0.25)
            else:
                raise AssertionError('Image listener did not become ready')
            assert fetch('/api/vehicle/config', False)[0] == 403
            status, body = fetch('/api/vehicle/config')
            assert status == 200 and json.loads(body)['mode'] == 'cluster'
            assert token.encode() not in body
            for path in ['/vehicle-demo/workbench.html', '/vehicle-demo/controls.html',
                         '/vehicle-demo/workbench.js', '/vehicle-demo/player-connection.mjs',
                         '/vehicle-demo/prototype.css', '/vehicle-demo/controls.css']:
                status, body = fetch(path)
                assert status == 200 and body, path
            status, body = fetch('/api/vehicle/player')
            assert status == 200
            assert json.loads(body)['playerUrl'].startswith('/vehicle-demo/player/?url=')
            status, body = fetch('/vehicle-demo/player/')
            assert status == 200
            bundles = re.findall(r'src="(/vehicle-demo/player/assets/index-[A-Za-z0-9_-]{8,}\.js)"', body.decode())
            assert bundles, 'Pinned player bundle missing or outside Gateway allowlist'
            for path in bundles:
                status, script = fetch(path)
                assert status == 200 and len(script) > 1000
            assert fetch('/business.html')[0] == 404
            assert fetch('/vehicle-demo/../server.py')[0] == 404
            print('ACK image: non-root/read-only startup, hop boundary, config, pages and bundled player passed')
        finally:
            if container:
                docker('rm', '-f', container)


if __name__ == '__main__':
    main()
