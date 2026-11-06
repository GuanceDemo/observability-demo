import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('prepare_device', Path(__file__).parents[1] / 'prepare-device.py')
device = importlib.util.module_from_spec(spec)
spec.loader.exec_module(device)


class DeviceScopeTests(unittest.TestCase):
    def test_other_device_is_rejected_before_any_change(self):
        with patch.object(device, 'adb', return_value='MallDemo') as adb:
            with self.assertRaises(RuntimeError):
                device.prepare()
            self.assertEqual(1, adb.call_count)

    def test_restore_only_reenables_packages_owned_by_this_operation(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'before.json'
            package = device.OPTIONAL_PACKAGES[0]
            def response(*args):
                if args[1] == 'getprop':
                    return 'VehicleDemo_API36'
                if args[2] == 'list':
                    return 'package:' + package
                return 'ok'
            with patch.object(device, 'STATE', state), patch.object(device, 'adb', side_effect=response) as adb:
                device.prepare()
                device.prepare(restore=True)
                mutations = [call.args for call in adb.call_args_list if 'disable-user' in call.args or 'enable' in call.args]
                self.assertEqual([
                    ('shell', 'pm', 'disable-user', '--user', '0', package),
                    ('shell', 'pm', 'enable', '--user', '0', package),
                ], mutations)
