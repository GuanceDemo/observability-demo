#!/usr/bin/env python3
"""Prepare a private, portable kubeconfig; never modify RBAC or the default context."""
import argparse
import base64
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import ssl
import subprocess
import tempfile

REPO = Path(__file__).resolve().parents[2]


def command(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=45)
    if result.returncode:
        raise ValueError('Command failed: ' + args[0] + ' (credential output withheld)')
    return result.stdout


def private_write(path, text):
    fd, temp = tempfile.mkstemp(dir=path.parent, prefix='.kube-')
    try:
        os.chmod(temp, 0o600)
        with os.fdopen(fd, 'w') as stream:
            stream.write(text)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def certificate_expiration(auth):
    """Read the signed certificate date; importing a file does not renew it."""
    certificate = auth.get('client-certificate-data')
    if not certificate:
        return None
    result = subprocess.run(['openssl', 'x509', '-noout', '-enddate'],
                            input=base64.b64decode(certificate, validate=True),
                            capture_output=True, timeout=10)
    if result.returncode:
        raise ValueError('Cannot read client certificate expiration (certificate output withheld)')
    prefix, _, value = result.stdout.decode().strip().partition('=')
    if prefix != 'notAfter':
        raise ValueError('Client certificate expiration is missing')
    expiration = datetime.fromtimestamp(ssl.cert_time_to_seconds(value), timezone.utc)
    if expiration <= datetime.now(timezone.utc):
        raise ValueError('Client certificate has expired; obtain a newly issued certificate')
    return expiration.isoformat().replace('+00:00', 'Z')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--kubeconfig')
    source.add_argument('--ack-cluster')
    parser.add_argument('--context')
    parser.add_argument('--region', default='cn-shenzhen')
    parser.add_argument('--temporary-duration-minutes', type=int,
                        help='Explicit ACK temporary lifetime, 15..4320 minutes; otherwise 1440')
    args = parser.parse_args()
    if args.temporary_duration_minutes is not None:
        if not args.ack_cluster or not 15 <= args.temporary_duration_minutes <= 4320:
            parser.error('--temporary-duration-minutes requires --ack-cluster and must be 15..4320')
    root = REPO / '.local-work/vehicle-demo/kube'
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(root, 0o700)
    expiration = None
    with tempfile.TemporaryDirectory(prefix='vehicle-kube-') as temp:
        if args.ack_cluster:
            data = json.loads(command(['aliyun', 'cs', 'DescribeClusterUserKubeconfig', '--region', args.region,
                                       '--ClusterId', args.ack_cluster, '--PrivateIpAddress', 'false',
                                       '--TemporaryDurationMinutes', str(args.temporary_duration_minutes or 1440)]))
            input_path = Path(temp) / 'input'
            private_write(input_path, data['config'])
            expiration = data.get('expiration')
        else:
            if not args.context:
                parser.error('--context is required with --kubeconfig')
            input_path = Path(args.kubeconfig).expanduser().resolve()
        argv = ['kubectl', '--kubeconfig', str(input_path)]
        if args.context:
            argv += ['--context', args.context]
        data = json.loads(command(argv + ['config', 'view', '--raw', '--minify', '--flatten', '-o', 'json']))
        context = data['current-context']
        cluster = data['clusters'][0]['cluster']
        auth = data['users'][0]['user']
        if not cluster.get('server', '').startswith('https://') or cluster.get('insecure-skip-tls-verify'):
            raise ValueError('HTTPS and server certificate verification are required')
        if 'exec' in auth or 'auth-provider' in auth:
            raise ValueError('Docker needs portable certificate/token credentials; exec/auth-provider plugins are not bundled')
        if any(c in context for c in '\n\r$#"\' '):
            raise ValueError('Unsupported context name for Compose env file')
        expiration = certificate_expiration(auth) or expiration
        metadata_path = root / 'metadata.json'
        if args.ack_cluster and args.temporary_duration_minutes is None and metadata_path.exists():
            previous = json.loads(metadata_path.read_text()).get('expiration')
            if (previous and expiration and
                    datetime.fromisoformat(previous.replace('Z', '+00:00')) >
                    datetime.fromisoformat(expiration.replace('Z', '+00:00'))):
                raise ValueError('Default ACK refresh would shorten the installed certificate lifetime; '
                                 'renew the 30-day certificate using the README procedure, or explicitly '
                                 'select --temporary-duration-minutes for a shorter ACK credential')
        private_write(root / 'config', json.dumps(data, indent=2))
        private_write(root / 'compose.env', 'VEHICLE_KUBE_CONTEXT=' + context + '\n')
        private_write(metadata_path, json.dumps({'context': context, 'expiration': expiration,
                                                'ackCluster': args.ack_cluster, 'region': args.region,
                                                'credentialSource': 'ack-temporary' if args.ack_cluster else 'imported'}))
    print('Prepared .local-work/vehicle-demo/kube/config; default kubeconfig unchanged.')
    if expiration:
        print('Credential expires:', expiration)
        print('Renew using the same ACK command.' if args.ack_cluster else
              'Renew the certificate before importing again; reimporting does not extend its lifetime.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.TimeoutExpired) as error:
        raise SystemExit(str(error)) from None
