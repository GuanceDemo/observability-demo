"""Single capture in flight, one immutable latest picture shared by all peers."""
import asyncio
import time
from dataclasses import dataclass


@dataclass(frozen=True)
class Picture:
    revision: int
    captured_at: float
    capture_ms: float
    planes: tuple


class LatestSource:
    def __init__(self, capture, convert, clock=time.monotonic):
        self.capture = capture
        self.convert = convert
        self.clock = clock
        self.latest = None
        self.users = 0
        self.task = None
        self.changed = asyncio.Event()
        self.wake = asyncio.Event()
        self.active_until = 0
        self.errors = 0
        self.captures = 0
        self.revision = 0
        self.raw = None

    def activity(self):
        self.active_until = self.clock() + 3
        self.wake.set()

    def acquire(self):
        self.users += 1
        self.activity()
        if self.task is None:
            self.task = asyncio.create_task(self.run())

    async def release(self):
        self.users = max(0, self.users - 1)
        if self.users == 0:
            task, self.task = self.task, None
            self.latest = self.raw = None
            self.changed.clear()
            if task:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)

    async def run(self):
        while True:
            started = self.clock()
            self.wake.clear()
            try:
                raw = await self.capture()
                captured_at = self.clock()
                self.captures += 1
                if raw != self.raw:
                    planes = await self.convert(raw)
                    self.revision += 1
                    self.raw = raw
                    self.latest = Picture(self.revision, captured_at,
                                          (captured_at - started) * 1000, planes)
                    self.changed.set()
            except asyncio.CancelledError:
                raise
            except Exception:
                self.errors += 1
                # A stale still must not hide a disconnected capture service.
                self.latest = self.raw = None
                self.changed.clear()
                await asyncio.sleep(.25)
            interval = 1 / 30 if self.clock() < self.active_until else .1
            try:
                await asyncio.wait_for(self.wake.wait(), max(.001, interval - (self.clock() - started)))
            except asyncio.TimeoutError:
                pass

    async def picture(self):
        while self.latest is None:
            self.changed.clear()
            await self.changed.wait()
        return self.latest
