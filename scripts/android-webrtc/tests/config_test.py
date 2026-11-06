import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'latest-video'))
from config import VideoConfig


class ConfigTests(unittest.TestCase):
    def test_mall_defaults_are_unchanged(self):
        config = VideoConfig.from_env({})
        self.assertEqual((config.width, config.height, config.port, config.grpc_port), (720, 1600, 8091, 8554))
        self.assertTrue(config.idle_enabled)
        self.assertTrue(config.mall_controls)

    def test_vehicle_is_explicitly_isolated(self):
        config = VideoConfig.from_env({'VIDEO_WIDTH': '1280', 'VIDEO_HEIGHT': '720',
            'VIDEO_GRPC_PORT': '8556', 'VIDEO_GATEWAY_PORT': '8082', 'VIDEO_PORT': '8092',
            'ANDROID_SERIAL': 'emulator-5556', 'ANDROID_PACKAGE': 'com.guance.vehicledemo',
            'VIDEO_FPS': '15', 'VIDEO_IDLE_ENABLED': 'false', 'VIDEO_MALL_CONTROLS': 'false'})
        self.assertEqual(config.grpc_port, 8556)
        self.assertFalse(config.idle_enabled)
        self.assertFalse(config.mall_controls)

    def test_invalid_values_fail_closed(self):
        for value in ({'VIDEO_WIDTH': '721'}, {'VIDEO_FPS': '0'}, {'VIDEO_PORT': '80'},
                      {'ANDROID_SERIAL': 'device;cmd'}, {'VIDEO_IDLE_ENABLED': '0'},
                      {'ANDROID_PACKAGE': 'com.guance.vehicledemo'}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                VideoConfig.from_env(value)
