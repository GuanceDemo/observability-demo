"""Offline contracts; these tests never call Kubernetes or trigger real faults."""
import importlib.util
import json
from pathlib import Path
import threading
import tempfile
from urllib.parse import urlsplit, parse_qs
import time
import sys
from datetime import datetime, timezone
from email.message import Message
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def module(name):
    path = Path(__file__).resolve().parents[1] / (name + '.py')
    spec = importlib.util.spec_from_file_location('vehicle_local_' + name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fault_runtime import FaultRuntime

remote, server = FaultRuntime(MagicMock(), MagicMock(), MagicMock()), module('server')


class MutationBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.gateway = server.Gateway(SimpleNamespace(mall_origin='http://127.0.0.1:1', vehicle_origin='https://example.invalid'))
        self.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.handler(self.gateway))
        self.origin = 'http://127.0.0.1:' + str(self.http.server_port)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()

    def post(self, body, origin=None, token=None):
        request = Request(self.origin + '/api/vehicle/faults/inject', data=json.dumps(body).encode(),
                          headers={'Origin': origin or self.origin, 'Content-Type': 'application/json',
                                   'X-Vehicle-Token': self.gateway.token if token is None else token})
        try:
            with urlopen(request, timeout=3) as response:
                return response.status
        except HTTPError as error:
            code = error.code
            error.close()
            return code

    def test_cross_origin_and_missing_token_never_reach_control(self):
        body = {'scenario': 'spark_fail', 'requestId': 'a' * 32}
        with patch.object(self.gateway, 'control') as control:
            self.assertEqual(self.post(body, origin='https://untrusted.invalid'), 403)
            self.assertEqual(self.post(body, token=''), 403)
            control.assert_not_called()

    def test_browser_cannot_choose_command_or_resource(self):
        with patch.object(self.gateway, 'control') as control:
            self.assertEqual(self.post({'scenario': 'spark_fail', 'requestId': 'a' * 32, 'command': 'delete'}), 400)
            self.assertEqual(self.post({'scenario': 'unknown', 'requestId': 'a' * 32}), 400)
            control.assert_not_called()

    def test_valid_request_preserves_idempotency_key(self):
        body = {'scenario': 'spark_fail', 'requestId': 'a' * 32}
        with patch.object(self.gateway, 'control', return_value={'operation': {'phase': 'injecting'}}) as control:
            self.assertEqual(self.post(body), 202)
            control.assert_called_once_with('inject', body)

    def test_retired_scenario_cannot_reach_control_or_mutate_operation(self):
        body = {'scenario': 'spark_suspend', 'requestId': 'a' * 32}
        with patch.object(self.gateway, 'control') as control:
            self.assertEqual(self.post(body), 400)
            control.assert_not_called()
        with patch.object(remote, 'load') as load, patch.object(remote, 'save') as save:
            with self.assertRaisesRegex(remote.OperationError, 'UNKNOWN_SCENARIO'):
                remote.begin(body)
            load.assert_not_called()
            save.assert_not_called()

    def test_path_cannot_escape_static_root(self):
        with self.assertRaises(HTTPError) as caught:
            urlopen(self.origin + '/vehicle-demo/%2e%2e/remote.py', timeout=3)
        self.assertEqual(caught.exception.code, 404)
        caught.exception.close()

    def test_live_feed_uses_fixed_remote_get_and_rejects_writes(self):
        headers = Message()
        headers['Content-Type'] = 'application/json'
        with patch.object(self.gateway, 'fetch', return_value=(200, headers, b'{"schemaVersion":1}')) as fetch:
            with urlopen(self.origin + '/vehicle-demo/api/live', timeout=3) as response:
                self.assertEqual(json.load(response), {'schemaVersion': 1})
            self.assertEqual(fetch.call_args.args[0], 'https://example.invalid/vehicle-demo/api/live')
            fetch.reset_mock()
            with self.assertRaises(HTTPError) as caught:
                urlopen(Request(self.origin + '/vehicle-demo/api/live', data=b'{}', method='POST'), timeout=3)
            self.assertEqual(caught.exception.code, 405)
            caught.exception.close()
            fetch.assert_not_called()

    def test_only_prototype_stylesheet_is_public(self):
        self.assertEqual(server.static_file('/vehicle-demo/prototype.css'),
                         server.HERE / 'web/prototype.css')
        self.assertIsNone(server.static_file('/vehicle-demo/../../docs/vehicle-demo/prototype/app.js'))
        self.assertIsNone(server.static_file('/vehicle-demo/prototype/app.js'))

    def test_console_workspace_comes_from_server_configuration(self):
        with patch.dict(server.os.environ, {'GUANCE_WORKSPACE_ID': 'wksp_demo'}):
            with urlopen(self.origin + '/api/vehicle/config', timeout=3) as response:
                self.assertEqual(json.load(response)['guanceWorkspace'], 'wksp_demo')

    def test_game_documents_and_assets_are_served_from_game_source(self):
        paths = ['/game-hub.html', '/plants-game.html', '/webgl-replay-game.html',
                 '/assets/webgl-game-scene-icon.png', '/assets/game-runtime.js',
                 '/assets/game-hub.js', '/assets/pvz/asset-list.json']
        with patch.object(self.gateway, 'fetch') as upstream:
            for path in paths:
                with self.subTest(path=path), urlopen(self.origin + path + '?v=local', timeout=3) as response:
                    self.assertEqual(response.status, 200)
                    self.assertEqual(response.read(), (server.GAME_STATIC / path.lstrip('/')).read_bytes())
            upstream.assert_not_called()

    def test_shared_order_assets_and_local_scene_still_resolve(self):
        for path in ['/shop.html', '/assets/selfheal-i18n.js', '/vehicle-demo/workbench.html']:
            with self.subTest(path=path), urlopen(self.origin + path, timeout=3) as response:
                self.assertEqual(response.status, 200)
                self.assertGreater(len(response.read()), 100)
        for path in ['/../pom.xml', '/assets/../../pom.xml', '/vehicle-demo/../server.py']:
            self.assertIsNone(server.static_file(path))

    def test_shared_logout_and_visitor_header_reach_local_backend(self):
        response_headers = Message()
        response_headers['Content-Type'] = 'application/json'
        request = Request(self.origin + '/api/demo/auth/session', method='DELETE',
                          headers={'Origin': self.origin, 'X-Demo-Visitor-Id': 'visitor-test', 'Cookie': 'session=test'})
        with patch.object(self.gateway, 'fetch', return_value=(200, response_headers, b'{}')) as upstream:
            with urlopen(request, timeout=3) as response:
                self.assertEqual(response.status, 200)
            args = upstream.call_args.args
            self.assertEqual(args[:3], ('http://127.0.0.1:1/api/demo/auth/session', 'DELETE', None))
            self.assertEqual(args[3]['X-Demo-Visitor-Id'], 'visitor-test')
            self.assertEqual(args[3]['Cookie'], 'session=test')


class LocalPlayerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.web = self.root / 'web'
        self.web.mkdir()
        (self.web / 'index.html').write_text('<html>local player</html>')
        self.config = self.root / 'config.json'
        self.config.write_text(json.dumps({'endpoint': 'https://example.invalid/vehicle-route'}))
        self.gateway = server.Gateway(SimpleNamespace(mall_origin='http://127.0.0.1:1',
            vehicle_origin='https://example.invalid', player_config=str(self.config)))
        patcher = patch.object(server, 'PLAYER_STATIC', self.web)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_player_uses_local_bundle_without_requesting_retired_page(self):
        with patch.object(self.gateway, 'fetch') as fetch:
            url = urlsplit(self.gateway.player_url())
            self.assertEqual(url.path, '/vehicle-demo/player/')
            self.assertEqual(url.netloc, '')
            self.assertEqual(parse_qs(url.query)['url'], ['https://example.invalid/vehicle-route'])
            fetch.assert_not_called()

    def test_endpoint_cannot_redirect_to_a_different_origin_or_inject_a_query(self):
        for endpoint in ['http://example.invalid/route', 'https://other.invalid/route',
                         'https://user:pass@example.invalid/route', 'https://example.invalid/route?x=1',
                         'https://example.invalid/route#x', 'https://example.invalid/../../config']:
            with self.subTest(endpoint=endpoint):
                self.config.write_text(json.dumps({'endpoint': endpoint}))
                with self.assertRaisesRegex(ValueError, 'PLAYER_CONFIG_INVALID'):
                    self.gateway.player_url()

    def test_missing_config_or_bundle_fails_explicitly(self):
        self.config.unlink()
        with self.assertRaisesRegex(ValueError, 'PLAYER_CONFIG_UNAVAILABLE'):
            self.gateway.player_url()
        self.config.write_text(json.dumps({'endpoint': 'https://example.invalid/vehicle-route'}))
        (self.web / 'index.html').unlink()
        with self.assertRaisesRegex(ValueError, 'PLAYER_ASSETS_MISSING'):
            self.gateway.player_url()

    def test_assets_do_not_expose_adjacent_endpoint_config(self):
        self.assertEqual(server.static_file('/vehicle-demo/player/'), (self.web / 'index.html').resolve())
        self.assertIsNone(server.static_file('/vehicle-demo/player/../config.json'))
        (self.web / 'escape.json').symlink_to(self.config)
        self.assertIsNone(server.static_file('/vehicle-demo/player/escape.json'))


class RestorationTests(unittest.TestCase):
    def test_external_resource_change_is_not_overwritten(self):
        current = {'metadata': {'uid': 'original', 'resourceVersion': '7'}, 'spec': {'replicas': 2}}
        with patch.object(remote, 'get', return_value=current), patch.object(remote, 'kube') as kube:
            with self.assertRaisesRegex(remote.OperationError, 'RESOURCE_CHANGED_EXTERNALLY'):
                remote.patch_field('deployment', 'vehicle-kafka', 'original', 'replicas', 0, 1)
            kube.assert_not_called()

    def test_patch_uses_resource_version_precondition(self):
        current = {'metadata': {'uid': 'original', 'resourceVersion': '7'}, 'spec': {'replicas': 0}}
        with patch.object(remote, 'get', return_value=current), patch.object(remote, 'kube') as kube:
            remote.patch_field('deployment', 'vehicle-kafka', 'original', 'replicas', 0, 1)
            payload = json.loads(kube.call_args.args[-1])
            self.assertEqual(payload[0], {'op': 'test', 'path': '/metadata/resourceVersion', 'value': '7'})
            self.assertEqual(payload[1]['value'], 1)

    def test_original_suspended_schedule_stays_suspended(self):
        op = {'cronUid': 'cron', 'originalSuspend': True}
        with patch.object(remote, 'patch_field') as restore:
            remote.restore_schedule(op)
            restore.assert_called_once_with('cronjob', 'vehicle-summary', 'cron', 'suspend', True, True)

    def test_active_operation_rejects_new_injection_before_remote_io(self):
        previous = {'phase': 'active', 'requestId': 'first'}
        with patch.object(remote, 'load', return_value=previous), patch.object(remote, 'report') as report:
            self.assertEqual(remote.begin({'scenario': 'spark_fail', 'requestId': 'first'}), previous)
            with self.assertRaisesRegex(remote.OperationError, 'OPERATION_ALREADY_ACTIVE'):
                remote.begin({'scenario': 'spark_fail', 'requestId': 'second'})
            report.assert_not_called()

    def recovery_case(self, latest_event=101, pending=0):
        now = time.time()
        op = {'phase': 'recovering', 'scenario': 'spark_fail', 'resourcesResumed': True,
              'recoverAt': now - 10, 'before': {'lastEvent': 100, 'brokerDropped': 0, 'brokerInstance': 'same'},
              'recoverySubmitted': True, 'recoveryJob': 'vehicle-summary-recover-test'}
        data = {'batch': {'run_id': 'new', 'last_event_ms': latest_event, 'unique_rows': 2, 'stale': False},
                'lineagePending': pending, 'components': [
                    {'component': 'emqx', 'last_seen_at': datetime.now(timezone.utc).isoformat(),
                     'payload': {'status': 'connected', 'queuing': 0, 'dropped': 0, 'instanceKey': 'same'}},
                    {'component': 'flink', 'last_seen_at': datetime.now(timezone.utc).isoformat(),
                     'payload': {'engineState': 'RUNNING', 'lastCheckpointAt': now * 1000}}]}
        return op, data

    def test_successful_job_without_new_source_data_is_not_recovery(self):
        op, data = self.recovery_case(latest_event=100)
        with patch.object(remote, 'report', return_value=data), patch.object(remote, 'job_result', return_value={'runId': 'new', 'state': 'COMPLETE'}), patch.object(remote, 'restore_schedule') as restore:
            with self.assertRaisesRegex(remote.OperationError, 'NO_NEW_SOURCE_DATA'):
                remote.recovery_step(op)
            self.assertEqual(op['phase'], 'recovering')
            restore.assert_not_called()

    def test_pending_lineage_blocks_recovered_state(self):
        op, data = self.recovery_case(pending=1)
        with patch.object(remote, 'report', return_value=data), patch.object(remote, 'job_result', return_value={'runId': 'new', 'state': 'COMPLETE'}), patch.object(remote, 'restore_schedule') as restore:
            remote.recovery_step(op)
            self.assertEqual(op['phase'], 'recovering')
            restore.assert_not_called()

    def test_recovery_requires_actual_committed_run_and_newer_source(self):
        op, data = self.recovery_case()
        with patch.object(remote, 'report', return_value=data), patch.object(remote, 'job_result', return_value={'runId': 'new', 'state': 'COMPLETE'}), patch.object(remote, 'restore_schedule') as restore:
            remote.recovery_step(op)
            self.assertEqual(op['phase'], 'recovered')
            self.assertEqual(op['after']['runId'], data['batch']['run_id'])
            restore.assert_called_once()


if __name__ == '__main__':
    unittest.main()
