#!/usr/bin/env python3
"""Create MQTT identities through the loopback EMQX management API."""
import json
from pathlib import Path
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def request(path, data=None, token=None, method=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    req = Request('http://127.0.0.1:18083/api/v5/' + path,
                  data=json.dumps(data).encode() if data is not None else None,
                  headers=headers, method=method)
    with urlopen(req, timeout=5) as response:
        return json.load(response) if response.status != 204 else None


def main():
    credentials = json.loads(Path('/etc/vehicle-demo/credentials.json').read_text())
    for attempt in range(60):
        try:
            token = request('login', {'username': 'admin', 'password': credentials['admin']})['token']
            break
        except (URLError, OSError, TimeoutError):
            if attempt == 59:
                raise RuntimeError('EMQX login unavailable after 120 seconds') from None
            time.sleep(2)
    prefix = 'authentication/password_based%3Abuilt_in_database/users'
    for role in ('publisher', 'observer'):
        username = 'vehicle-' + role
        try:
            request(prefix + '/' + username, token=token)
        except HTTPError as error:
            if error.code != 404:
                raise RuntimeError(f'Cannot inspect MQTT identity: HTTP {error.code}') from None
            request(prefix, {'user_id': username, 'password': credentials[role],
                             'is_superuser': False}, token)
    print('Publisher and observer identities ready (no superuser permissions).')


if __name__ == '__main__':
    main()
