import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('runtime', Path(__file__).parents[1] / 'install-runtime.py')
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class BrokerPlacementTest(unittest.TestCase):
    def test_android_reinstall_cannot_restart_migrated_local_broker(self):
        with tempfile.TemporaryDirectory() as folder:
            config = Path(folder) / 'pipeline.json'
            config.write_text('{"broker_ip":"192.168.55.83"}')
            with patch.object(runtime, 'run') as run:
                runtime.ensure_local_broker(config)
                run.assert_not_called()
