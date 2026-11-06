"""Trusted deployment configuration, never derived from HTTP inputs."""
import os
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class VideoConfig:
    width: int = 720
    height: int = 1600
    fps: int = 30
    port: int = 8091
    gateway_port: int = 8080
    grpc_port: int = 8554
    serial: str = 'emulator-5554'
    package: str = 'com.malldemomobile.safe'
    idle_enabled: bool = True
    mall_controls: bool = True

    @classmethod
    def from_env(cls, env=None):
        env = os.environ if env is None else env
        values = {}
        for name in ('width', 'height', 'fps', 'port', 'gateway_port', 'grpc_port'):
            key = 'VIDEO_' + name.upper()
            if key in env:
                values[name] = int(env[key])
        for name, key in (('serial', 'ANDROID_SERIAL'), ('package', 'ANDROID_PACKAGE')):
            if key in env:
                values[name] = env[key]
        for name in ('idle_enabled', 'mall_controls'):
            key = 'VIDEO_' + name.upper()
            if key in env:
                if env[key] not in ('true', 'false'):
                    raise ValueError(f'{key} must be true or false')
                values[name] = env[key] == 'true'
        config = cls(**values)
        if any(value < 240 or value > 2560 or value % 2 for value in (config.width, config.height)):
            raise ValueError('video dimensions must be even, between 240 and 2560')
        if not 1 <= config.fps <= 30:
            raise ValueError('video fps must be between 1 and 30')
        if any(not 1024 <= value <= 65535 for value in (config.port, config.gateway_port, config.grpc_port)):
            raise ValueError('invalid internal port')
        if not re.fullmatch(r'emulator-[0-9]{4,5}', config.serial):
            raise ValueError('invalid emulator serial')
        if not re.fullmatch(r'[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+', config.package):
            raise ValueError('invalid Android package')
        if config.mall_controls and config.package != 'com.malldemomobile.safe':
            raise ValueError('mall controls must not target another application')
        return config
