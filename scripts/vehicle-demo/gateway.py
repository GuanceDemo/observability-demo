#!/usr/bin/env python3
"""Start the pinned native-input gateway against this deployment's AVD only."""
import asyncio
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent / 'latest-video'))
from config import VideoConfig
from discovery import wait_for_emulator


async def main():
    config = VideoConfig.from_env()
    runtime = Path(os.environ.get('XDG_RUNTIME_DIR', '/run/user/1002'))
    props = await wait_for_emulator(runtime / 'avd/running', grpc_port=config.grpc_port)
    executable = '/opt/mall-demo-webrtc/android-emulator-container-scripts/gateway/venv/bin/videobridge-gateway'
    os.execv(executable, [executable, f'--port={config.gateway_port}',
                          '--discovery_file=' + props['discovery.path']])


if __name__ == '__main__':
    asyncio.run(main())
