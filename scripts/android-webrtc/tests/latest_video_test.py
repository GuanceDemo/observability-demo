import asyncio
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'latest-video'))
from frames import LatestSource


class SourceTests(unittest.IsolatedAsyncioTestCase):
    async def test_single_inflight_latest_wins_and_stops_when_idle(self):
        active = maximum = counter = 0

        async def capture():
            nonlocal active, maximum, counter
            active += 1
            maximum = max(maximum, active)
            await asyncio.sleep(.002)
            counter += 1
            active -= 1
            return bytes([counter])

        async def convert(raw):
            return (raw,)

        source = LatestSource(capture, convert)
        source.acquire()
        source.acquire()
        first = await asyncio.wait_for(source.picture(), .2)
        await asyncio.sleep(.12)
        latest = await source.picture()
        self.assertGreater(latest.revision, first.revision)
        self.assertEqual(first.planes, (b'\x01',))
        self.assertEqual(maximum, 1)
        await source.release()
        self.assertIsNotNone(source.task)
        await source.release()
        self.assertIsNone(source.task)
        self.assertIsNone(source.latest)
        stopped = counter
        await asyncio.sleep(.05)
        self.assertEqual(counter, stopped)

    async def test_recovers_same_image_after_capture_failure(self):
        calls = 0

        async def capture():
            nonlocal calls
            calls += 1
            if calls == 2:
                raise RuntimeError('temporary')
            return b'image'

        async def convert(raw):
            return (raw,)

        source = LatestSource(capture, convert)
        source.acquire()
        await source.picture()
        await asyncio.sleep(.4)
        self.assertEqual(source.errors, 1)
        self.assertEqual(source.latest.planes, (b'image',))
        self.assertEqual(source.revision, 2)
        await source.release()

    async def test_unchanged_picture_converted_once_and_activity_wakes_idle(self):
        conversions = 0

        async def capture():
            return b'image'

        async def convert(raw):
            nonlocal conversions
            conversions += 1
            return (raw,)

        source = LatestSource(capture, convert)
        source.acquire()
        await source.picture()
        source.active_until = 0
        await asyncio.sleep(.05)
        before = source.captures
        source.activity()
        await asyncio.sleep(.05)
        self.assertGreater(source.captures, before)
        self.assertEqual(conversions, 1)
        await source.release()


try:
    import av
    from aiortc.rtp import HeaderExtensions, HeaderExtensionsMap, unpack_header_extensions
    from aiortc.rtcrtpparameters import RTCRtpHeaderExtensionParameters, RTCRtpParameters
    from bridge import LatestTrack, convert_picture, WIDTH, HEIGHT, create_app
    from playout import PLAYOUT_URI, install
except ImportError:
    av = None


@unittest.skipUnless(av, 'run in pinned latest-video venv for media tests')
class MediaTests(unittest.IsolatedAsyncioTestCase):
    async def test_negotiated_playout_only(self):
        install()
        mapping = HeaderExtensionsMap()
        mapping.configure(RTCRtpParameters(headerExtensions=[]))
        profile, value = mapping.set(HeaderExtensions())
        self.assertEqual(unpack_header_extensions(profile, value), [])
        mapping.configure(RTCRtpParameters(headerExtensions=[RTCRtpHeaderExtensionParameters(id=7, uri=PLAYOUT_URI)]))
        profile, value = mapping.set(HeaderExtensions())
        self.assertEqual(unpack_header_extensions(profile, value), [(7, bytes(3))])
        mapping.configure(RTCRtpParameters(headerExtensions=[]))
        self.assertEqual(unpack_header_extensions(*mapping.set(HeaderExtensions())), [])

    async def test_each_encoder_gets_owned_frame_and_monotonic_pts(self):
        async def capture():
            return bytes([100, 150, 200]) * WIDTH * HEIGHT

        async def convert(raw):
            return convert_picture(raw)

        source = LatestSource(capture, convert)
        source.acquire()
        a, b = LatestTrack(source), LatestTrack(source)
        first = await a.recv()
        second = await a.recv()
        other = await b.recv()
        self.assertGreater(second.pts, first.pts)
        self.assertIsNot(first, second)
        self.assertIsNot(second, other)
        old = bytes(other.planes[0])
        first.planes[0].update(bytes(first.planes[0].buffer_size))
        self.assertEqual(bytes(other.planes[0]), old)
        self.assertEqual(source.revision, 1)
        a.stop()
        b.stop()
        await source.release()

    async def test_signaling_rejects_query_and_cleans_failed_startup(self):
        from aiohttp.test_utils import TestClient, TestServer
        from unittest.mock import AsyncMock, patch
        source = LatestSource(None, None)
        async with TestClient(TestServer(create_app(source, []))) as client:
            ordinary = await client.get('/api/v1/emulator/ws-jsep-latest')
            self.assertEqual(ordinary.status, 400)
            result = await client.get('/api/v1/emulator/ws-jsep-latest?command=oops')
            self.assertEqual(result.status, 400)
            with patch('bridge.NativeControl.start', new=AsyncMock(side_effect=RuntimeError('failed'))):
                socket = await client.ws_connect('/api/v1/emulator/ws-jsep-latest')
                await socket.receive()
                await socket.close()
            status = await (await client.get('/api/v1/emulator/latest-video-stats')).json()
            self.assertEqual(status['peers'], 0)
            self.assertEqual(source.users, 0)
            self.assertIsNone(source.task)


if __name__ == '__main__':
    unittest.main()
