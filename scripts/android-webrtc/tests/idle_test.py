import asyncio
import sys
from pathlib import Path
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'latest-video'))
from idle import IdlePolicy, has_active_anr


class IdleTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.now = 0
        self.calls = []
        self.foreground = False
        self.anr = False
        async def command(action):
            if action == 'anr':
                return self.anr
            self.calls.append(action)
            return self.foreground
        self.policy = IdlePolicy(command, lambda: self.now)

    async def test_anr_defers_home_and_force_stop(self):
        self.anr = True
        self.now = 120
        await self.policy.tick()
        self.assertEqual(self.calls, [])
        self.anr = False
        await self.policy.tick()
        self.assertEqual(self.calls, ['home'])

    def test_anr_matches_only_the_demo_process(self):
        dump = ('ACTIVITY MANAGER RUNNING PROCESSES\n'
                '  *APP* UID 1 ProcessRecord{a 12:other.app/u0a1}\n'
                '    notResponding=true\n'
                '  *APP* UID 2 ProcessRecord{b 13:com.malldemomobile.safe/u0a2}\n'
                '    notResponding=false\n')
        self.assertFalse(has_active_anr(dump, 'com.malldemomobile.safe'))
        self.assertTrue(has_active_anr(dump.replace('notResponding=false', 'mNotResponding=true'), 'com.malldemomobile.safe'))
        with self.assertRaises(RuntimeError):
            has_active_anr('', 'com.malldemomobile.safe')

    async def test_home_then_full_grace_and_stop_once(self):
        self.now = 29.9
        await self.policy.tick()
        self.assertEqual(self.calls, [])
        self.now = 30
        await self.policy.tick()
        self.now = 44.9
        await self.policy.tick()
        self.assertEqual(self.calls, ['home'])
        self.now = 45
        await self.policy.tick()
        self.now = 90
        await self.policy.tick()
        self.assertEqual(self.calls, ['home', 'foreground', 'stop'])

    async def test_reentry_cancels_grace_and_rearms(self):
        self.now = 30
        await self.policy.tick()
        self.now = 40
        self.policy.activity()
        self.now = 45
        await self.policy.tick()
        self.assertEqual(self.calls, ['home'])
        self.now = 70
        await self.policy.tick()
        self.assertEqual(self.calls, ['home', 'home'])

    async def test_foreground_reopen_cancels_stop(self):
        self.now = 30
        await self.policy.tick()
        self.foreground = True
        self.now = 45
        await self.policy.tick()
        self.assertNotIn('stop', self.calls)
        self.assertIsNone(self.policy.home_at)

    async def test_input_during_foreground_check_cancels_stop(self):
        self.now = 30
        await self.policy.tick()
        async def command(action):
            self.policy.activity()
            return False
        self.policy.command = command
        self.now = 45
        await self.policy.tick()
        self.assertFalse(self.policy.closed)

    async def test_failed_home_does_not_start_grace(self):
        async def fail(action):
            raise RuntimeError('offline')
        self.policy.command = fail
        self.now = 30
        with self.assertRaises(RuntimeError):
            await self.policy.tick()
        self.assertIsNone(self.policy.home_at)


if __name__ == '__main__':
    unittest.main()
