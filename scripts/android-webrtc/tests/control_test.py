import base64
import importlib.util
import json
import pathlib
import unittest

path = pathlib.Path(__file__).parents[1] / 'latest-video/control.py'
spec = importlib.util.spec_from_file_location('control', path)
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)

class ControlTest(unittest.TestCase):
    def test_command_allowlist(self):
        valid = {'id': 'a' * 32, 'action': 'inject', 'faultId': 'mobile_js_error'}
        self.assertEqual(control.validate_command(valid), valid)
        for value in [{**valid, 'shell': 'id'}, {**valid, 'faultId': 'x; id'}, {**valid, 'action': 'open_url'}, {**valid, 'id': '../x'}]:
            with self.assertRaises(ValueError): control.validate_command(value)

    def test_reassembled_ack_and_state(self):
        target = control.ApkControl()
        data = {'version': 1, 'requestId': 'a' * 32, 'status': 'completed', 'state': {'phase': 'armed'}}
        encoded = base64.b64encode(json.dumps(data).encode()).decode()
        batch = '12345678-1234-1234-1234-123456789abc'
        target.ingest(f'MALL_DEMO_CONTROL {batch} 1 2 {encoded[80:]}')
        self.assertIsNone(target.state)
        target.ingest(f'MALL_DEMO_CONTROL {batch} 0 2 {encoded[:80]}')
        self.assertEqual(target.state['phase'], 'armed')
        self.assertEqual(target.results['a' * 32], 'completed')
        target.ingest(f'MALL_DEMO_CONTROL {batch} 0 999 bad')
        self.assertEqual(target.state['phase'], 'armed')

if __name__ == '__main__': unittest.main()
