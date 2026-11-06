import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

folder = Path(__file__).parents[1]
sys.path.insert(0, str(folder))
spec = importlib.util.spec_from_file_location('acceptance', folder / 'acceptance.py')
acceptance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(acceptance)


class RemoteBrokerSnapshotTest(unittest.TestCase):
    def test_snapshot_uses_remote_epoch_without_local_container(self):
        with tempfile.TemporaryDirectory() as folder:
            pipeline, state = Path(folder) / 'pipeline.json', Path(folder) / 'state.json'
            pipeline.write_text('{"broker_ip":"192.168.55.83"}')
            state.write_text('{"node":"emqx@vehicle-emqx","epoch":"run-one"}')
            with patch.object(acceptance, 'output') as output:
                self.assertEqual('kubernetes:192.168.55.83:emqx@vehicle-emqx:run-one',
                                 acceptance.broker_identity(pipeline, state))
                output.assert_not_called()
            os.utime(state, (0, 0))
            with self.assertRaises(RuntimeError):
                acceptance.broker_identity(pipeline, state)
