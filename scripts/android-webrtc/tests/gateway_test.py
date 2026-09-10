"""Test patched gateway handlers without importing its gRPC runtime.
Usage: python3 gateway_test.py /path/to/patched/gateway_server.py
"""
import ast
import asyncio
from collections import deque
import json
import logging
from pathlib import Path
import re
import sys
import time
from types import SimpleNamespace
import unittest
import uuid

SOURCE = Path(sys.argv.pop(1)).read_text()

class Response:
    def __init__(self, *, status=200, body=None, **kwargs):
        self.status, self.body = status, body
        self.headers = kwargs.get('headers', {})

class GatewayTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.ns = dict(asyncio=asyncio, deque=deque, json=json, logging=logging,
                       re=re, time=time, uuid=uuid, EMULATOR_CHANNEL=True,
                       web=SimpleNamespace(Response=Response,
                           json_response=lambda body, status=200: Response(body=body, status=status)))
        tree = ast.parse(SOURCE)
        nodes = [node for node in tree.body if
                 isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in
                 ('handle_frame_snapshot', 'handle_interaction_ack', 'parse_interaction_ack_line')
                 or isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and
                     target.id.startswith(('FRAME_SNAPSHOT_', 'INTERACTION_')) for target in node.targets)]
        exec(compile(ast.Module(body=nodes, type_ignores=[]), '<actual patched gateway>', 'exec'), self.ns)

    async def call(self, handler, **query):
        return await self.ns[handler](SimpleNamespace(query=query))

    def add_ack(self, sequence):
        ack = dict(version=1, sequence=sequence, epoch=self.ns['INTERACTION_ACK_EPOCH'], action='tab.bag')
        self.ns['INTERACTION_ACK_HISTORY'].append(ack)
        self.ns['INTERACTION_ACK'] = ack
        self.ns['INTERACTION_ACK_SEQUENCE'] = sequence
        return ack

    async def test_fresh_snapshot_bypasses_completed_cache(self):
        self.ns.update(FRAME_SNAPSHOT_CACHE=b'old', FRAME_SNAPSHOT_CACHE_AT=time.monotonic())
        async def capture(): return b'new'
        self.ns['capture_frame_snapshot'] = capture
        self.assertEqual((await self.call('handle_frame_snapshot')).body, b'old')
        result = await self.call('handle_frame_snapshot', fresh='1')
        self.assertEqual(result.body, b'new')
        self.assertIn('no-store', result.headers['Cache-Control'])

    async def test_concurrent_fresh_requests_coalesce(self):
        gate = asyncio.Event()
        calls = 0
        async def capture():
            nonlocal calls
            calls += 1
            await gate.wait()
            return b'new'
        self.ns['capture_frame_snapshot'] = capture
        first = asyncio.create_task(self.call('handle_frame_snapshot', fresh='1'))
        second = asyncio.create_task(self.call('handle_frame_snapshot', fresh='1'))
        await asyncio.sleep(0)
        gate.set()
        self.assertEqual([r.body for r in await asyncio.gather(first, second)], [b'new', b'new'])
        self.assertEqual(calls, 1)

    async def test_snapshot_rejects_arbitrary_capture_parameters(self):
        for query in [dict(fresh='2'), dict(width='100'), dict(command='arbitrary')]:
            self.assertEqual((await self.call('handle_frame_snapshot', **query)).status, 400)

    async def test_cursor_exists_before_any_native_ack(self):
        cursor = (await self.call('handle_interaction_ack', cursor='1')).body
        self.assertEqual(cursor['version'], 2)
        self.assertEqual(cursor['sequence'], 0)
        self.assertRegex(cursor['epoch'], r'^[a-f0-9]{32}$')
        self.assertEqual((await self.call('handle_interaction_ack', after='0', epoch=cursor['epoch'])).status, 204)

    async def test_correlated_poll_returns_first_event_and_legacy_returns_latest(self):
        for sequence in range(1, 4): self.add_ack(sequence)
        first = await self.call('handle_interaction_ack', after='1', epoch=self.ns['INTERACTION_ACK_EPOCH'])
        self.assertEqual(first.body['sequence'], 2)
        latest = await self.call('handle_interaction_ack', after='1')
        self.assertEqual(latest.body['sequence'], 3)

    async def test_reset_future_and_overflow_cursors_fail_closed(self):
        for sequence in range(1, 70): self.add_ack(sequence)
        for query in [dict(after='68', epoch='stale'), dict(after='70'), dict(after='0')]:
            query.setdefault('epoch', self.ns['INTERACTION_ACK_EPOCH'])
            self.assertEqual((await self.call('handle_interaction_ack', **query)).status, 409)

    async def test_long_poll_wakes_for_new_event_and_rejects_invalid_queries(self):
        self.ns['INTERACTION_ACK_EVENT'] = asyncio.Event()
        poll = asyncio.create_task(self.call('handle_interaction_ack', after='0',
            epoch=self.ns['INTERACTION_ACK_EPOCH'], waitMs='100'))
        await asyncio.sleep(0)
        self.add_ack(1)
        self.ns['INTERACTION_ACK_EVENT'].set()
        self.assertEqual((await poll).body['sequence'], 1)
        for query in [dict(after='-1'), dict(waitMs='5001'), dict(cursor='bad'), dict(command='x')]:
            self.assertEqual((await self.call('handle_interaction_ack', **query)).status, 400)

    async def test_history_overflow_during_long_poll_is_not_a_success(self):
        self.ns['INTERACTION_ACK_EVENT'] = asyncio.Event()
        poll = asyncio.create_task(self.call('handle_interaction_ack', after='0',
            epoch=self.ns['INTERACTION_ACK_EPOCH'], waitMs='100'))
        await asyncio.sleep(0)
        for sequence in range(1, 70): self.add_ack(sequence)
        self.ns['INTERACTION_ACK_EVENT'].set()
        self.assertEqual((await poll).status, 409)

if __name__ == '__main__': unittest.main()
