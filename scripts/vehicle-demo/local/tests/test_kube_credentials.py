"""Credential import must retain real expiration and avoid silent lifetime downgrades."""
import base64
from contextlib import redirect_stdout, redirect_stderr
from datetime import datetime, timedelta, timezone
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / 'configure-local-kube.py'
SPEC = importlib.util.spec_from_file_location('configure_local_kube', SCRIPT)
configure = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(configure)


class CredentialTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = tempfile.TemporaryDirectory()
        root = Path(cls.fixture.name)
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                        '-keyout', str(root / 'key'), '-out', str(root / 'cert'),
                        '-days', '30', '-subj', '/CN=fixture'],
                       capture_output=True, check=True)
        cls.auth = {'client-certificate-data': base64.b64encode((root / 'cert').read_bytes()).decode()}
        cls.config = {'current-context': 'demo-test',
                      'clusters': [{'cluster': {'server': 'https://cluster.test'}}],
                      'users': [{'user': cls.auth}]}

    @classmethod
    def tearDownClass(cls):
        cls.fixture.cleanup()

    def test_import_records_signed_expiration_and_private_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            output = io.StringIO()
            with patch.object(configure, 'REPO', Path(directory)), \
                    patch.object(configure, 'command', return_value=json.dumps(self.config)), \
                    patch('sys.argv', ['configure', '--kubeconfig', 'candidate', '--context', 'demo-test']), \
                    redirect_stdout(output):
                configure.main()
            root = Path(directory) / '.local-work/vehicle-demo/kube'
            meta = json.loads((root / 'metadata.json').read_text())
            expiry = datetime.fromisoformat(meta['expiration'].replace('Z', '+00:00'))
            remaining = (expiry - datetime.now(timezone.utc)).total_seconds()
            self.assertGreater(remaining, 29 * 86400)
            self.assertLessEqual(remaining, 30 * 86400)
            self.assertEqual(meta['credentialSource'], 'imported')
            for name in ('config', 'compose.env', 'metadata.json'):
                self.assertEqual((root / name).stat().st_mode & 0o777, 0o600)
            self.assertNotIn(self.auth['client-certificate-data'], output.getvalue())

    def test_default_ack_refresh_cannot_shorten_existing_certificate(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / '.local-work/vehicle-demo/kube'
            root.mkdir(parents=True)
            previous = (datetime.now(timezone.utc) + timedelta(days=31)).isoformat()
            original = {'config': 'original credential', 'compose.env': 'original context',
                        'metadata.json': json.dumps({'expiration': previous})}
            for name, value in original.items():
                (root / name).write_text(value)
            with patch.object(configure, 'REPO', Path(directory)), \
                    patch.object(configure, 'command', side_effect=[json.dumps({'config': 'candidate'}),
                                                                   json.dumps(self.config)]), \
                    patch('sys.argv', ['configure', '--ack-cluster', 'demo-cluster']):
                with self.assertRaisesRegex(ValueError, 'would shorten'):
                    configure.main()
            for name, value in original.items():
                self.assertEqual((root / name).read_text(), value)

    def test_ack_rejects_unsupported_30_day_duration_before_calling_api(self):
        with patch.object(configure, 'command') as command, \
                patch('sys.argv', ['configure', '--ack-cluster', 'demo',
                                   '--temporary-duration-minutes', '43200']), \
                redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as error:
                configure.main()
            self.assertEqual(error.exception.code, 2)
            command.assert_not_called()

    def test_expired_and_invalid_certificates_are_rejected(self):
        expired = subprocess.CompletedProcess([], 0, b'notAfter=Jan  1 00:00:00 2000 GMT\n', b'')
        with patch.object(configure.subprocess, 'run', return_value=expired):
            with self.assertRaisesRegex(ValueError, 'has expired'):
                configure.certificate_expiration(self.auth)
        with self.assertRaisesRegex(ValueError, 'Cannot read client certificate'):
            configure.certificate_expiration({'client-certificate-data': base64.b64encode(b'invalid').decode()})


if __name__ == '__main__':
    unittest.main()
