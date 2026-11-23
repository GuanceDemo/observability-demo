import asyncio
import importlib.machinery
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'latest-video'))
from discovery import wait_for_emulator

launcher_path = Path(__file__).resolve().parents[1] / 'templates/mall-demo-gateway'
loader = importlib.machinery.SourceFileLoader('mall_gateway_launcher', str(launcher_path))
spec = importlib.util.spec_from_loader(loader.name, loader)
launcher = importlib.util.module_from_spec(spec)
loader.exec_module(launcher)


class DiscoveryTests(unittest.IsolatedAsyncioTestCase):
    async def test_gateway_selects_mall_after_live_vehicle_file(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / 'avd/running'
            directory.mkdir(parents=True)
            (directory / 'pid_10.ini').write_text('grpc.port=8556\ngrpc.token=vehicle-secret\n')
            mall = directory / 'pid_20.ini'
            mall.write_text('grpc.port=8554\ngrpc.token=mall-secret\n')
            with patch.dict(os.environ, {'XDG_RUNTIME_DIR': root}), \
                    patch('discovery.os.kill') as alive, \
                    patch.object(launcher.os, 'execv') as execute:
                await asyncio.wait_for(launcher.main(), timeout=.5)
            self.assertEqual([call.args for call in alive.call_args_list], [(10, 0), (20, 0)])
            executable, args = execute.call_args.args
            self.assertEqual(args, [executable, '--port=8080', '--discovery_file=' + str(mall)])
            self.assertNotIn('secret', ' '.join(args))

    async def test_gateway_does_not_start_with_only_vehicle_endpoint(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / 'avd/running'
            directory.mkdir(parents=True)
            (directory / f'pid_{os.getpid()}.ini').write_text('grpc.port=8556\ngrpc.token=vehicle-test\n')
            with patch.dict(os.environ, {'XDG_RUNTIME_DIR': root}), \
                    patch.object(launcher.os, 'execv') as execute:
                with self.assertRaises(TimeoutError):
                    await asyncio.wait_for(launcher.main(), timeout=.03)
            execute.assert_not_called()

    async def test_vehicle_never_selects_live_mall_endpoint(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            path = directory / f'pid_{os.getpid()}.ini'
            path.write_text('grpc.port=8554\ngrpc.token=mall-test\n')
            with self.assertRaises(TimeoutError):
                await wait_for_emulator(directory, timeout=.02, interval=.01, grpc_port=8556)
            path.write_text('grpc.port=8556\ngrpc.token=vehicle-test\n')
            result = await wait_for_emulator(directory, grpc_port=8556)
            self.assertEqual(result['grpc.port'], '8556')
            self.assertEqual(result['discovery.path'], str(path))

    async def test_waits_for_directory_and_complete_file(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / 'running'
            task = asyncio.create_task(wait_for_emulator(directory, timeout=1, interval=.01))
            await asyncio.sleep(.02)
            directory.mkdir()
            path = directory / f'pid_{os.getpid()}.ini'
            path.write_text('grpc.port=8554\n')
            await asyncio.sleep(.02)
            self.assertFalse(task.done())
            path.write_text('grpc.port=8554\ngrpc.token=test-token\n')
            self.assertEqual((await task)['grpc.port'], '8554')

    async def test_rejects_stale_and_wrong_port_files(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            (directory / 'pid_2147483647.ini').write_text('grpc.port=8554\ngrpc.token=test\n')
            (directory / f'pid_{os.getpid()}.ini').write_text('grpc.port=9999\ngrpc.token=test\n')
            with self.assertRaisesRegex(TimeoutError, 'discovery'):
                await wait_for_emulator(directory, timeout=.02, interval=.01)
