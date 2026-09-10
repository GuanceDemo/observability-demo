#!/usr/bin/env python3
"""Loopback-only latest-frame video bridge; native Emulator input stays native."""
import asyncio
import fractions
import json
import logging
import os
import sys
import time
from pathlib import Path

import av
import grpc
from aiohttp import ClientSession, WSMsgType, web
from aiortc import (RTCConfiguration, RTCIceServer, RTCPeerConnection,
                    RTCSessionDescription, VideoStreamTrack)
from aiortc.sdp import candidate_from_sdp

from frames import LatestSource
from playout import PLAYOUT_URI, install

LABELS = ('mouse', 'keyboard', 'touch')
WIDTH, HEIGHT = 720, 1600
MAX_PEERS = 4


def ice_config(servers):
    return RTCConfiguration(iceServers=[RTCIceServer(**{key: value for key, value in server.items()
        if key in ('urls', 'username', 'credential')}) for server in servers])


async def add_candidate(pc, value):
    if not isinstance(value, dict):
        raise ValueError('candidate must be an object')
    if not value.get('candidate'):
        return
    candidate = candidate_from_sdp(value['candidate'].removeprefix('candidate:'))
    candidate.sdpMid = value.get('sdpMid')
    candidate.sdpMLineIndex = value.get('sdpMLineIndex')
    await pc.addIceCandidate(candidate)


class NativeControl:
    def __init__(self):
        self.task = None
        self.channels = {}
        self.ready = asyncio.Event()
        self.pc = None

    async def start(self):
        self.task = asyncio.create_task(self.run())
        await asyncio.wait_for(self.ready.wait(), 15)
        if self.task.done():
            raise RuntimeError('native control ended during setup')

    async def run(self):
        try:
            async with ClientSession() as session:
                async with session.ws_connect('http://127.0.0.1:8080/api/v1/emulator/ws-jsep',
                                              max_msg_size=65536, heartbeat=20) as ws:
                    async for message in ws:
                        if message.type != WSMsgType.TEXT:
                            continue
                        data = json.loads(message.data)
                        if 'start' in data and self.pc is None:
                            self.pc = RTCPeerConnection(ice_config(data['start'].get('iceServers', [])))

                            @self.pc.on('datachannel')
                            def channel(dc):
                                if dc.label not in LABELS:
                                    return
                                self.channels[dc.label] = dc

                                def update():
                                    if all(self.channels.get(key) and self.channels[key].readyState == 'open'
                                           for key in LABELS):
                                        self.ready.set()

                                dc.on('open', update)
                                update()

                        desc = data.get('sdp') if isinstance(data.get('sdp'), dict) else (
                            data if data.get('type') == 'offer' else None)
                        if desc and self.pc:
                            await self.pc.setRemoteDescription(RTCSessionDescription(**desc))
                            # Do not decode the old stream just to relay native control.
                            for transceiver in self.pc.getTransceivers():
                                transceiver.direction = 'inactive'
                            await self.pc.setLocalDescription(await self.pc.createAnswer())
                            await ws.send_json({'sdp': {'type': self.pc.localDescription.type,
                                                       'sdp': self.pc.localDescription.sdp}})
                        elif data.get('candidate') and self.pc:
                            candidate = data['candidate']
                            if isinstance(candidate, str):
                                candidate = {'candidate': candidate, 'sdpMid': '0', 'sdpMLineIndex': 0}
                            await add_candidate(self.pc, candidate)
        finally:
            self.ready.clear()
            if self.pc:
                await self.pc.close()

    def send(self, label, data):
        if not self.ready.is_set() or self.task.done():
            raise RuntimeError('native control unavailable')
        channel = self.channels[label]
        if channel.readyState != 'open' or channel.bufferedAmount > 65536:
            raise RuntimeError('native control congested')
        channel.send(data)

    async def close(self):
        if self.task:
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)


def convert_picture(raw):
    frame = av.VideoFrame(WIDTH, HEIGHT, 'rgb24')
    frame.planes[0].update(raw)
    frame = frame.reformat(format='yuv420p')
    return tuple(bytes(plane) for plane in frame.planes)


class LatestTrack(VideoStreamTrack):
    def __init__(self, source):
        super().__init__()
        self.source = source
        self.started = time.monotonic()
        self.last = 0
        self.seen = source.revision
        self.sent = self.skipped = self.duplicates = 0
        self.queue_ms = self.copy_ms = 0

    async def recv(self):
        # Keep RTP cadence stable even for a static screen. Every encoding gets
        # its own mutable AVFrame; only immutable pixel planes are shared.
        await asyncio.sleep(max(0, 1 / 30 - (time.monotonic() - self.last)))
        picture = await asyncio.wait_for(self.source.picture(), 3)
        self.last = time.monotonic()
        if picture.revision == self.seen:
            self.duplicates += 1
        else:
            self.skipped += max(0, picture.revision - self.seen - 1)
            self.queue_ms = max(0, (self.last - picture.captured_at) * 1000)
        self.seen = picture.revision
        started = time.monotonic()
        frame = av.VideoFrame(WIDTH, HEIGHT, 'yuv420p')
        for plane, pixels in zip(frame.planes, picture.planes):
            plane.update(pixels)
        frame.pts = int((self.last - self.started) * 90000)
        frame.time_base = fractions.Fraction(1, 90000)
        self.copy_ms = (time.monotonic() - started) * 1000
        self.sent += 1
        return frame


def create_app(source, servers):
    peers = set()
    tracks = set()
    last_peer = {}
    app = web.Application(client_max_size=65536)

    async def handler(request):
        if request.query:
            raise web.HTTPBadRequest()
        if len(peers) >= MAX_PEERS:
            raise web.HTTPServiceUnavailable()
        ws = web.WebSocketResponse(max_msg_size=65536, heartbeat=20)
        if not ws.can_prepare(request).ok:
            raise web.HTTPBadRequest()
        pc = RTCPeerConnection(ice_config(servers))
        peers.add(pc)
        control = NativeControl()
        track = None
        source_acquired = False
        opened_at = time.monotonic()
        input_task = monitor = None
        queue = asyncio.Queue(maxsize=64)

        async def inputs():
            while True:
                label, data, queued_at = await queue.get()
                if time.monotonic() - queued_at > 1.5:
                    raise RuntimeError('input expired')
                control.send(label, data)
                source.activity()

        def attach(dc):
            @dc.on('message')
            def message(data):
                if not isinstance(data, bytes) or len(data) > 4096:
                    return
                try:
                    queue.put_nowait((dc.label, data, time.monotonic()))
                except asyncio.QueueFull:
                    # Dropping button-up silently could leave a pressed key.
                    input_task.cancel()

        async def health():
            born = time.monotonic()
            while not ws.closed:
                if pc.connectionState in ('failed', 'closed') or (input_task and input_task.done()):
                    await ws.close()
                    return
                if track and track.sent and time.monotonic() - track.last > 3:
                    await ws.close()
                    return
                if time.monotonic() - born > 20 and pc.connectionState != 'connected':
                    await ws.close()
                    return
                if control.task and control.task.done():
                    await ws.close()
                    return
                await asyncio.sleep(.5)

        try:
            await ws.prepare(request)
            await control.start()
            source.acquire()
            source_acquired = True
            track = LatestTrack(source)
            tracks.add(track)
            pc.addTrack(track)
            for label in LABELS:
                attach(pc.createDataChannel(label))
            input_task = asyncio.create_task(inputs())
            monitor = asyncio.create_task(health())
            await ws.send_json({'start': {'iceServers': servers}})
            await pc.setLocalDescription(await pc.createOffer())
            await ws.send_json({'sdp': {'type': pc.localDescription.type, 'sdp': pc.localDescription.sdp}})
            async for message in ws:
                if message.type != WSMsgType.TEXT:
                    continue
                data = json.loads(message.data)
                if not isinstance(data, dict):
                    raise ValueError('invalid signaling')
                if isinstance(data.get('sdp'), dict):
                    if data['sdp'].get('type') != 'answer' or pc.remoteDescription is not None:
                        raise ValueError('unexpected description')
                    await pc.setRemoteDescription(RTCSessionDescription(**data['sdp']))
                elif 'candidate' in data:
                    await add_candidate(pc, data['candidate'])
                elif data.get('bye'):
                    break
        except asyncio.CancelledError:
            raise
        except Exception as error:
            # SDP / ICE messages and gRPC exceptions can contain credentials.
            logging.warning('video peer ended (%s)', type(error).__name__)
        finally:
            last_peer.update({'state': pc.connectionState, 'sent': track.sent if track else 0,
                              'lifetimeMs': (time.monotonic() - opened_at) * 1000})
            for task in (input_task, monitor):
                if task:
                    task.cancel()
            await asyncio.gather(*(task for task in (input_task, monitor) if task), return_exceptions=True)
            if track:
                track.stop()
                tracks.discard(track)
            await pc.close()
            await control.close()
            if source_acquired:
                await source.release()
            peers.discard(pc)
            await ws.close()
        return ws

    async def status(request):
        return web.json_response({'sourceFrames': source.revision, 'captures': source.captures,
            'lastPeer': last_peer, 'captureErrors': source.errors, 'sourceCaptureMs': source.latest.capture_ms if source.latest else None,
            'peers': len(peers), 'playoutNegotiated': [bool(peer.remoteDescription and PLAYOUT_URI in peer.remoteDescription.sdp) for peer in peers], 'tracks': [{'sent': track.sent, 'skipped': track.skipped,
                'duplicates': track.duplicates, 'queueMs': track.queue_ms, 'copyMs': track.copy_ms}
                for track in tracks]}, headers={'Cache-Control': 'no-store'})

    async def shutdown(_app):
        await asyncio.gather(*(peer.close() for peer in tuple(peers)), return_exceptions=True)

    app.on_shutdown.append(shutdown)
    app.router.add_get('/api/v1/emulator/ws-jsep-latest', handler)
    app.router.add_get('/api/v1/emulator/latest-video-stats', status)
    return app


async def main():
    install()
    upstream = Path('/opt/mall-demo-webrtc/android-emulator-container-scripts/gateway/src/videobridge_gateway/proto')
    sys.path.insert(0, str(upstream))
    import emulator_controller_pb2 as ec
    import emulator_controller_pb2_grpc as ec_grpc

    runtime = Path(os.environ.get('XDG_RUNTIME_DIR', '/run/user/1002'))
    running = next((runtime / 'avd/running').glob('pid_*.ini'))
    props = dict(line.split('=', 1) for line in running.read_text().splitlines() if '=' in line)
    channel = grpc.aio.insecure_channel('127.0.0.1:' + props['grpc.port'],
                                       options=[('grpc.max_receive_message_length', 8 * 1024 * 1024)])
    stub = ec_grpc.EmulatorControllerStub(channel)
    metadata = [('authorization', 'Bearer ' + props['grpc.token'])]

    async def capture():
        result = await stub.getScreenshot(ec.ImageFormat(format=ec.ImageFormat.RGB888,
            width=WIDTH, height=HEIGHT, display=0), metadata=metadata, timeout=2)
        if result.format.width != WIDTH or result.format.height != HEIGHT or len(result.image) != WIDTH * HEIGHT * 3:
            raise ValueError('unexpected display dimensions')
        return bytes(result.image)

    async def convert(raw):
        return await asyncio.to_thread(convert_picture, raw)

    source = LatestSource(capture, convert)
    servers = json.loads(Path('/etc/mall-demo-webrtc/turn.json').read_text())['iceServers']
    app = create_app(source, servers)

    async def close_channel(_app):
        await channel.close()

    app.on_cleanup.append(close_channel)
    return app


if __name__ == '__main__':
    logging.basicConfig(level=logging.WARNING)
    web.run_app(main(), host='127.0.0.1', port=8091, access_log=None, print=None)
