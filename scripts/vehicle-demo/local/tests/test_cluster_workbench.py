"""ACK HTTP boundary, without real Kubernetes access or fault injection."""
import json
import os
from pathlib import Path
import sys
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Gateway, ThreadingHTTPServer, handler
from kube_api import InClusterAPI

HOP = 'test-only-gateway-hop-token-0000000000'
PUBLIC = 'https://demo.example.test'


def options(**values):
    return SimpleNamespace(**dict(mode='cluster', public_origin=PUBLIC,
                                  report_url='http://vehicle-control:8080/api/report',
                                  vehicle_origin='https://device.example.test',
                                  mall_origin='http://unused', **values))


class ClusterBoundaryTests(unittest.TestCase):
    def setUp(self):
        with patch.dict(os.environ, {'VEHICLE_GATEWAY_TOKEN': HOP}):
            self.gateway = Gateway(options())
        self.http = ThreadingHTTPServer(('127.0.0.1', 0), handler(self.gateway))
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()

    def request(self, path, data=None, headers=None, method=None):
        request = Request('http://127.0.0.1:' + str(self.http.server_port) + path,
                          data=None if data is None else json.dumps(data).encode(),
                          headers={'X-Vehicle-Gateway-Token': HOP, **(headers or {})}, method=method)
        try:
            response = urlopen(request, timeout=3)
        except HTTPError as error:
            response = error
        with response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else {}

    def test_cluster_transport_and_configuration_without_user_login(self):
        self.assertIs(self.gateway.api_control.api_factory, InClusterAPI)
        status, config = self.request('/api/vehicle/config')
        self.assertEqual(status, 200)
        self.assertEqual(config['mode'], 'cluster')
        self.assertEqual(config['token'], self.gateway.token)
        self.assertNotIn(HOP, json.dumps(config))
        self.assertEqual(self.request('/healthz', headers={'X-Vehicle-Gateway-Token': ''})[0], 200)

    def test_hop_origin_and_csrf_are_all_required_for_mutation(self):
        data = {'scenario': 'emqx_backlog', 'requestId': 'a' * 32}
        good = {'Origin': PUBLIC, 'X-Vehicle-Token': self.gateway.token}
        with patch.object(self.gateway, 'control', return_value={'operation': {'phase': 'injecting'}}) as control:
            for bad in [{'X-Vehicle-Gateway-Token': ''}, {'X-Vehicle-Gateway-Token': 'forged'},
                        {'Origin': 'https://other.example.test'}, {'Origin': ''},
                        {'X-Vehicle-Token': ''}, {'Sec-Fetch-Site': 'cross-site'}]:
                self.assertEqual(self.request('/api/vehicle/faults/inject', data, {**good, **bad})[0], 403)
            control.assert_not_called()
            self.assertEqual(self.request('/api/vehicle/faults/inject', data, good)[0], 202)
            control.assert_called_once_with('inject', data)

    def test_no_local_shop_proxy_or_resource_selection_in_cluster_mode(self):
        with patch.object(self.gateway, 'fetch') as fetch, patch.object(self.gateway, 'control') as control:
            self.assertEqual(self.request('/api/demo/config')[0], 404)
            self.assertEqual(self.request('/api/demo/auth/session', {}, method='POST')[0], 405)
            self.assertEqual(self.request('/api/demo/auth/session', method='DELETE')[0], 405)
            good = {'Origin': PUBLIC, 'X-Vehicle-Token': self.gateway.token}
            self.assertEqual(self.request('/api/vehicle/faults/inject',
                                         {'scenario': 'spark_fail', 'requestId': 'a' * 32, 'namespace': 'default'}, good)[0], 400)
            fetch.assert_not_called()
            control.assert_not_called()

    def test_report_uses_fixed_internal_endpoint(self):
        with patch.object(self.gateway, 'fetch', return_value=(200, {}, b'{"batch":"ok"}')) as fetch:
            self.assertEqual(self.request('/vehicle-demo/api/report?url=https://other.test')[1], {'batch': 'ok'})
            fetch.assert_called_once_with('http://vehicle-control:8080/api/report')

    def test_bad_cluster_configuration_fails_before_serving(self):
        for field, value in [('public_origin', ''), ('public_origin', 'http://demo.example.test'),
                             ('report_url', ''), ('report_url', 'http://control/other')]:
            args = options()
            setattr(args, field, value)
            with self.subTest(field=field, value=value), patch.dict(os.environ, {'VEHICLE_GATEWAY_TOKEN': HOP}):
                with self.assertRaises(ValueError):
                    Gateway(args)
        with patch.dict(os.environ, {'VEHICLE_GATEWAY_TOKEN': ''}):
            with self.assertRaisesRegex(ValueError, 'GATEWAY_TOKEN_REQUIRED'):
                Gateway(options())


class ProjectedIdentityTests(unittest.TestCase):
    def test_each_request_observes_rotated_serviceaccount_token(self):
        import tempfile
        from unittest.mock import MagicMock
        with tempfile.TemporaryDirectory() as root:
            api = InClusterAPI.__new__(InClusterAPI)
            api.origin, api.tls = 'https://kubernetes.test', None
            api.token_file = Path(root) / 'token'
            response = MagicMock()
            response.__enter__.return_value.read.return_value = b'{}'
            with patch('kube_api.urlopen', return_value=response) as request:
                api.token_file.write_text('old-projected-token')
                api.request('/api/v1/namespaces/vehicle-pipeline/configmaps/vehicle-demo-fault-state')
                api.token_file.write_text('rotated-projected-token')
                api.request('/api/v1/namespaces/vehicle-pipeline/configmaps/vehicle-demo-fault-state')
                self.assertEqual([call.args[0].get_header('Authorization') for call in request.call_args_list],
                                 ['Bearer old-projected-token', 'Bearer rotated-projected-token'])
            api.close()


if __name__ == '__main__':
    unittest.main()
