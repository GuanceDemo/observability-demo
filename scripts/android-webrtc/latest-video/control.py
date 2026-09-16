"""Fixed APK demo commands and bounded, structured native acknowledgements."""
import asyncio
import base64
import json
import os
import re
import time
from collections import OrderedDict
from aiohttp import web

MARKER = 'MALL_DEMO_CONTROL '
ID = re.compile(r'^[a-f0-9]{32}$')
FAULT = re.compile(r'^[a-z0-9_-]{1,100}$')


def validate_command(value):
    if not isinstance(value, dict) or set(value) - {'id', 'action', 'faultId'}:
        raise ValueError('invalid_command')
    if not isinstance(value.get('id'), str) or not ID.fullmatch(value['id']):
        raise ValueError('invalid_request_id')
    if value.get('action') not in ('refresh', 'inject', 'recover'):
        raise ValueError('unsupported_command')
    fault = value.get('faultId', '')
    if not isinstance(fault, str) or (value['action'] == 'inject' and not FAULT.fullmatch(fault)):
        raise ValueError('invalid_fault_id')
    if value['action'] != 'inject' and fault:
        raise ValueError('unexpected_fault_id')
    return value


class ApkControl:
    def __init__(self, activity=lambda: None):
        self.activity = activity
        self.state = None
        self.sampled_at = 0
        self.results = OrderedDict()
        self.parts = {}
        self.lock = asyncio.Lock()
        self.process = None
        self.task = None
        self.event = asyncio.Event()
        self.adb = os.environ.get('ANDROID_ADB', '/home/cherry/android-sdk/platform-tools/adb')
        self.serial = os.environ.get('ANDROID_SERIAL', 'emulator-5554')
        self.package = 'com.malldemomobile.safe'

    def ingest(self, line):
        if MARKER not in line:
            return
        try:
            batch, index, count, encoded = line.split(MARKER, 1)[1].strip().split(' ')
            index, count = int(index), int(count)
            if not re.fullmatch(r'[a-f0-9-]{36}', batch) or not 0 <= index < count <= 20 or len(encoded) > 2000:
                return
            if len(self.parts) > 32:
                self.parts.clear()
            total, pieces = self.parts.setdefault(batch, (count, {}))
            if total != count:
                return
            pieces[index] = encoded
            if len(pieces) != count:
                return
            del self.parts[batch]
            data = json.loads(base64.b64decode(''.join(pieces[i] for i in range(count)), validate=True))
            if data.get('version') != 1 or not isinstance(data.get('state'), dict):
                return
            self.state = data['state']
            self.sampled_at = int(time.time() * 1000)
            request_id = data.get('requestId', '')
            if isinstance(request_id, str) and ID.fullmatch(request_id):
                self.results[request_id] = data.get('status', 'unknown')
                while len(self.results) > 128:
                    self.results.popitem(last=False)
            self.event.set()
        except (ValueError, TypeError, KeyError, AttributeError):
            return

    async def monitor(self):
        while True:
            try:
                self.process = await asyncio.create_subprocess_exec(
                    self.adb, '-s', self.serial, 'logcat', '-T', '1', '-v', 'raw',
                    'MallDemoControl:I', '*:S', stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.DEVNULL)
                while line := await self.process.stdout.readline():
                    self.ingest(line.decode('utf-8', errors='replace'))
                await self.process.wait()
            finally:
                if self.process and self.process.returncode is None:
                    self.process.kill()
                    await self.process.wait()
            await asyncio.sleep(1)

    async def status(self, request):
        if request.query:
            raise web.HTTPBadRequest()
        return web.json_response({'version': 1, 'state': self.state, 'sampledAt': self.sampled_at},
                                 headers={'Cache-Control': 'no-store'})

    async def command(self, request):
        # Same-origin player only, JSON prevents form-based cross-origin commands.
        if request.query or request.content_type != 'application/json':
            raise web.HTTPBadRequest()
        origin = request.headers.get('Origin')
        if origin and origin != 'https://' + request.host:
            raise web.HTTPForbidden()
        try:
            value = validate_command(await request.json())
        except (ValueError, TypeError):
            raise web.HTTPBadRequest()
        if self.lock.locked():
            raise web.HTTPConflict(text='command_busy')
        async with self.lock:
            request_id = value['id']
            if request_id in self.results:
                return web.json_response({'id': request_id, 'status': self.results[request_id]})
            self.activity()
            # Reserve the ID before execution: timeout/retry must never reinject.
            self.results[request_id] = 'unknown'
            args = [self.adb, '-s', self.serial, 'shell', 'am', 'start', '-n',
                    self.package + '/com.malldemomobile.MainActivity', '-a',
                    self.package + '.DEMO_CONTROL', '--es', 'requestId', request_id,
                    '--es', 'command', value['action']]
            if value.get('faultId'):
                args += ['--es', 'faultId', value['faultId']]
            process = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.DEVNULL,
                                                           stderr=asyncio.subprocess.DEVNULL)
            try:
                await asyncio.wait_for(process.wait(), 5)
                if process.returncode:
                    raise web.HTTPServiceUnavailable(text='apk_unavailable')
                deadline = time.monotonic() + 20
                while self.results[request_id] == 'unknown' and time.monotonic() < deadline:
                    self.event.clear()
                    try:
                        await asyncio.wait_for(self.event.wait(), max(.01, deadline - time.monotonic()))
                    except asyncio.TimeoutError:
                        break
                return web.json_response({'id': request_id, 'status': self.results[request_id]})
            finally:
                if process.returncode is None:
                    process.kill()
                    await process.wait()
                while len(self.results) > 128:
                    self.results.popitem(last=False)

    async def start(self, _app):
        self.task = asyncio.create_task(self.monitor())

    async def stop(self, _app):
        if self.task:
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)


def install_control(app, activity):
    control = ApkControl(activity)
    app.router.add_get('/api/v1/emulator/demo-control', control.status)
    app.router.add_post('/api/v1/emulator/demo-control', control.command)
    app.on_startup.append(control.start)
    app.on_cleanup.append(control.stop)
