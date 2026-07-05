from __future__ import annotations

import asyncio
import os
import unittest

import dashboard.server as server


class StartupCatalogPrewarmTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self._old_task = server._CATALOG_PREWARM_TASK
        self._old_status = dict(server._CATALOG_PREWARM_STATUS)
        self._old_runner = server._run_catalog_prewarm_background
        self._old_env = {
            name: os.environ.get(name)
            for name in (
                "TRAILHEAD_CATALOG_PREWARM_ENABLED",
                "TRAILHEAD_CATALOG_PREWARM_MODE",
                "TRAILHEAD_BLOCKING_CATALOG_PREWARM",
            )
        }
        server._CATALOG_PREWARM_TASK = None
        server._CATALOG_PREWARM_STATUS.update({"state": "idle", "started_at": 0.0, "finished_at": 0.0, "error": ""})

    async def asyncTearDown(self):
        task = server._CATALOG_PREWARM_TASK
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        server._CATALOG_PREWARM_TASK = self._old_task
        server._CATALOG_PREWARM_STATUS.clear()
        server._CATALOG_PREWARM_STATUS.update(self._old_status)
        server._run_catalog_prewarm_background = self._old_runner
        for name, value in self._old_env.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    async def test_startup_schedules_catalog_prewarm_without_waiting(self):
        started = asyncio.Event()
        release = asyncio.Event()

        async def fake_runner():
            started.set()
            await release.wait()

        server._run_catalog_prewarm_background = fake_runner
        os.environ["TRAILHEAD_CATALOG_PREWARM_ENABLED"] = "1"
        os.environ["TRAILHEAD_CATALOG_PREWARM_MODE"] = "background"
        os.environ["TRAILHEAD_BLOCKING_CATALOG_PREWARM"] = "0"

        await server._prewarm_explore_catalog()

        task = server._CATALOG_PREWARM_TASK
        self.assertIsNotNone(task)
        await asyncio.wait_for(started.wait(), timeout=0.5)
        self.assertFalse(task.done())
        release.set()
        await task

    async def test_startup_can_block_when_configured(self):
        started = asyncio.Event()
        release = asyncio.Event()

        async def fake_runner():
            started.set()
            await release.wait()

        server._run_catalog_prewarm_background = fake_runner
        os.environ["TRAILHEAD_CATALOG_PREWARM_ENABLED"] = "1"
        os.environ["TRAILHEAD_CATALOG_PREWARM_MODE"] = "blocking"

        startup_task = asyncio.create_task(server._prewarm_explore_catalog())
        await asyncio.wait_for(started.wait(), timeout=0.5)
        self.assertFalse(startup_task.done())
        release.set()
        await startup_task


if __name__ == "__main__":
    unittest.main()
