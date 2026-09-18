"""One idle policy for the shared emulator, independent of browser lifetime."""
import asyncio
import logging
import os
import re
import time


class IdlePolicy:
    def __init__(self, command, clock=time.monotonic):
        self.command, self.clock = command, clock
        self.last_input = clock()
        self.home_at = None
        self.closed = False
        self.generation = 0

    def activity(self):
        self.last_input = self.clock()
        self.home_at = None
        self.closed = False
        self.generation += 1

    async def tick(self):
        now = self.clock()
        generation = self.generation
        if self.closed or now - self.last_input < 30:
            return
        # Preserve the OS ANR close path; force-stop would record USER_REQUESTED.
        if await self.command('anr'):
            self.home_at = None
            return
        if generation != self.generation:
            return
        if self.home_at is None:
            await self.command('home')
            if generation == self.generation:
                self.home_at = self.clock()
        elif now - self.home_at >= 15:
            # Reopening through another control surface also cancels shutdown.
            foreground = await self.command('foreground')
            if generation != self.generation:
                return
            if foreground:
                self.activity()
                return
            await self.command('stop')
            if generation == self.generation:
                self.closed = True


def has_active_anr(output, package):
    if 'ACTIVITY MANAGER RUNNING PROCESSES' not in output:
        raise RuntimeError('cannot establish ANR state')
    for block in re.split(r'(?m)^  \*APP\* ', output)[1:]:
        header = block.splitlines()[0]
        if re.search(r':' + re.escape(package) + r'/', header):
            return bool(re.search(r'\b(?:mNotResponding|notResponding)=true\b', block))
    return False


async def android_command(action):
    adb = os.environ.get('ANDROID_ADB', '/home/cherry/android-sdk/platform-tools/adb')
    serial = os.environ.get('ANDROID_SERIAL', 'emulator-5554')
    package = 'com.malldemomobile.safe'
    args = {'home': ['input', 'keyevent', 'KEYCODE_HOME'],
            'stop': ['am', 'force-stop', package],
            'anr': ['dumpsys', 'activity', 'processes'],
            'foreground': ['dumpsys', 'activity', 'activities']}[action]
    process = await asyncio.create_subprocess_exec(
        adb, '-s', serial, 'shell', *args,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
    try:
        output, _ = await asyncio.wait_for(process.communicate(), 3)
    except (asyncio.TimeoutError, asyncio.CancelledError):
        if process.returncode is None:
            process.kill()
        await process.wait()
        raise
    if process.returncode:
        raise RuntimeError('emulator idle command failed')
    if action == 'anr':
        return has_active_anr(output.decode(errors='replace'), package)
    if action == 'foreground':
        lines = output.decode(errors='replace').splitlines()
        resumed = [line for line in lines if 'mResumedActivity:' in line or 'topResumedActivity=' in line]
        if not resumed:
            raise RuntimeError('cannot establish foreground activity')
        return any(package + '/' in line for line in resumed)


async def run_policy(policy):
    while True:
        try:
            await policy.tick()
        except Exception:
            logging.warning('Emulator idle action unavailable; will retry')
        await asyncio.sleep(.5)
