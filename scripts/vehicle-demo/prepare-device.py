#!/usr/bin/env python3
"""Disable unused bundled apps on the dedicated vehicle AVD, preserving data."""
import argparse
import json
from pathlib import Path
import subprocess

ADB = ['/home/cherry/android-sdk/platform-tools/adb', '-s', 'emulator-5556']
STATE = Path('/var/lib/vehicle-demo/device-apps-before.json')
OPTIONAL_PACKAGES = (
    'com.google.android.as',
    'com.google.android.googlequicksearchbox',
    'com.google.android.calendar',
    'com.google.android.apps.photos',
    'com.google.android.apps.messaging',
    'com.google.android.apps.wellbeing',
    'com.google.android.apps.youtube.music',
    'com.google.android.youtube',
)


def adb(*args):
    return subprocess.check_output(ADB + list(args), text=True, timeout=30).strip()


def prepare(restore=False):
    if adb('shell', 'getprop', 'ro.boot.qemu.avd_name') != 'VehicleDemo_API36':
        raise RuntimeError('Refusing to modify anything except VehicleDemo_API36 on port 5556')
    if not STATE.exists():
        if restore:
            raise RuntimeError('No saved vehicle package state to restore')
        enabled = set(adb('shell', 'pm', 'list', 'packages', '-e').splitlines())
        STATE.write_text(json.dumps([p for p in OPTIONAL_PACKAGES if 'package:' + p in enabled]))
        STATE.chmod(0o600)
    packages = json.loads(STATE.read_text())
    if not isinstance(packages, list) or any(p not in OPTIONAL_PACKAGES for p in packages):
        raise RuntimeError('Invalid saved vehicle package state')
    for package in packages:
        print(adb('shell', 'pm', 'enable' if restore else 'disable-user', '--user', '0', package))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--restore', action='store_true')
    prepare(parser.parse_args().restore)
