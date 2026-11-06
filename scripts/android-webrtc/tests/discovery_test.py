import asyncio
import os
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'latest-video'))
from discovery import wait_for_emulator


class DiscoveryTests(unittest.IsolatedAsyncioTestCase):
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
