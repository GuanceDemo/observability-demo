#!/usr/bin/env python3
"""Verify compiled RN replay borders/clipping and optionally prepare Android raster checks.
Run the SDK's compileReleaseJavaWithJavac task first. --raster-output writes a DEX
that can be run with CLASSPATH=classes.dex app_process /system/bin ReplayBorderRasterCheck.
The DEX only draws off-screen bitmaps; it does not interact with application UI.
"""
import argparse
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--raster-output', type=Path)
args = parser.parse_args()
mobile = Path(__file__).resolve().parents[1]
fixtures = Path(__file__).resolve().parent / 'fixtures'
sdk_source = mobile / 'node_modules/@cloudcare/react-native-session-replay/android'
java = Path(os.environ['JAVA_HOME']) / 'bin'
cache = Path.home() / '.gradle/caches/modules-2/files-2.1'
aar = next((cache / 'com.cloudcare.ft.mobile.sdk.tracker.agent/ft-session-replay/0.1.8').rglob('*.aar'))
gson = next((cache / 'com.google.code.gson/gson/2.8.9').rglob('*.jar'))
classes = sdk_source / 'build/intermediates/javac/release/compileReleaseJavaWithJavac/classes'

def run(command):
    subprocess.run([str(part) for part in command], check=True)

with tempfile.TemporaryDirectory(prefix='replay-visuals-') as directory:
    output = Path(directory)
    with zipfile.ZipFile(aar) as archive:
        (output / 'replay.jar').write_bytes(archive.read('classes.jar'))
    classpath = os.pathsep.join(map(str, [classes, output / 'replay.jar', gson]))
    run([java / 'javac', '-cp', classpath, '-d', output,
         fixtures / 'ReplayBorderContractCheck.java', fixtures / 'ReplayClipReproduction.java'])
    for name in ['ReplayBorderContractCheck', 'ReplayClipReproduction']:
        run([java / 'java', '-cp', str(output) + os.pathsep + classpath, name])
    if args.raster_output:
        android = Path(os.environ['ANDROID_HOME'])
        android_jar = android / 'platforms/android-36/android.jar'
        raster_classes = output / 'raster'
        raster_classes.mkdir()
        utilities = sdk_source / 'src/main/java/com/ft/sdk/reactnative/sessionreplay/utils'
        run([java / 'javac', '-source', '8', '-target', '8', '-cp', android_jar,
             '-d', raster_classes, utilities / 'BorderSnapshotDrawable.java',
             utilities / 'ColorUtils.java', fixtures / 'ReplayBorderRasterCheck.java'])
        args.raster_output.mkdir(parents=True, exist_ok=True)
        run([android / 'build-tools/36.0.0/d8', '--lib', android_jar,
             '--output', args.raster_output, *raster_classes.rglob('*.class')])
        print('Run on Android:', args.raster_output / 'classes.dex')
