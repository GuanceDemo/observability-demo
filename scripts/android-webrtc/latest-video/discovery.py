"""Wait for a live emulator's authenticated local gRPC endpoint."""
import asyncio
import os
import time


async def wait_for_emulator(directory, timeout=180, interval=1, grpc_port=8554):
    deadline = time.monotonic() + timeout
    while True:
        for path in sorted(directory.glob('pid_*.ini')):
            try:
                pid = int(path.stem.removeprefix('pid_'))
                if pid <= 0:
                    continue
                os.kill(pid, 0)
                props = dict(line.split('=', 1) for line in path.read_text().splitlines()
                             if '=' in line)
                if props.get('grpc.port') == str(grpc_port) and props.get('grpc.token'):
                    props['discovery.path'] = str(path)
                    return props
            except (OSError, ValueError):
                # Startup can expose an incomplete file; stale process files are ignored.
                continue
        if time.monotonic() >= deadline:
            raise TimeoutError('Emulator gRPC discovery was not ready within timeout')
        await asyncio.sleep(interval)
