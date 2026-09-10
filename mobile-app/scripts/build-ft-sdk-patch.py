#!/usr/bin/env python3
"""Build paired, opt-in SDK/Replay patches from hash-pinned official artifacts."""
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / 'build/sdk-patch'
GROUP = 'com/cloudcare/ft/mobile/sdk/tracker/agent'
SDK_VERSION = '1.7.5-jankfix02'
REPLAY_VERSION = '0.1.8-jankfix02'
SDK_SOURCE = 'com/ft/sdk/FTViewPermanentIdResolver.java'
REPLAY_PREFIX = 'com/ft/sdk/sessionreplay/internal/recorder/'
HASHES = {
    'ft-sdk-1.7.5.aar': '9a15ed97e6ca9c0b0b5934964540a73ab58535b399a27cbe90af3204c959de3f',
    'ft-sdk-1.7.5-sources.jar': '394e2c432035cf31b81ae57c0d956bdc39cbae294e038a962fd8b0fe3e297f5b',
    'ft-session-replay-0.1.8.aar': '0f8ca91382b2006bbbaf02c3d481adae76d89769513f757b078f7e9227c7faa7',
    'ft-session-replay-0.1.8-sources.jar': '0c15ef88c64ac435e5aa1b11c98a421b899a250cd776d8826b32843f86d155fa',
}


def download(module, version, suffix):
    name = f'{module}-{version}{suffix}'
    target = WORK / name
    if not target.exists():
        url = f'https://mvnrepo.guance.com/repository/maven-releases/{GROUP}/{module}/{version}/{name}'
        with urllib.request.urlopen(url, timeout=60) as response:
            target.write_bytes(response.read())
    if name in HASHES and hashlib.sha256(target.read_bytes()).hexdigest() != HASHES[name]:
        raise RuntimeError('SDK checksum mismatch: ' + name)
    return target


def replace_entries(data, replacements):
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(data)) as old, zipfile.ZipFile(output, 'w') as new:
        for info in old.infolist():
            new.writestr(info, replacements.get(info.filename, old.read(info.filename)))
        for name in sorted(replacements.keys() - set(old.namelist())):
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            new.writestr(info, replacements[name])
    return output.getvalue()


def build(module, version, patched_version, sources_list, expected_classes, patch, javac, classpath, temp):
    aar = download(module, version, '.aar')
    sources = download(module, version, '-sources.jar')
    pom = download(module, version, '.pom')
    work = temp / module
    work.mkdir()
    with zipfile.ZipFile(sources) as z:
        for name in sources_list:
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(z.read(name))
    subprocess.run(['patch', '--batch', '-p1', '-i', str(ROOT / 'sdk-patches/ft-sdk-1.7.5' / patch)], cwd=work, check=True)
    with zipfile.ZipFile(aar) as z:
        original = z.read('classes.jar')
    original_jar = work / 'original.jar'
    original_jar.write_bytes(original)
    classes = work / 'classes'
    classes.mkdir()
    subprocess.run([javac, '--release', '8', '-cp', os.pathsep.join([*classpath, str(original_jar)]), '-d', str(classes), *[str(work / name) for name in sources_list]], check=True)
    generated = {p.relative_to(classes).as_posix(): p.read_bytes() for p in classes.rglob('*.class')}
    if set(generated) != set(expected_classes):
        raise RuntimeError('Unexpected generated classes: ' + repr(list(generated)))
    patched_classes = replace_entries(original, generated)
    with zipfile.ZipFile(io.BytesIO(original)) as before, zipfile.ZipFile(io.BytesIO(patched_classes)) as after:
        changed = {n for n in after.namelist() if n not in before.namelist() or before.read(n) != after.read(n)}
        if changed != set(expected_classes) or set(before.namelist()) - set(after.namelist()):
            raise RuntimeError('Unexpected SDK changes: ' + repr(changed))
    repo = WORK / 'maven' / GROUP / module / patched_version
    repo.mkdir(parents=True, exist_ok=True)
    output = repo / f'{module}-{patched_version}.aar'
    output.write_bytes(replace_entries(aar.read_bytes(), {'classes.jar': patched_classes}))
    (repo / f'{module}-{patched_version}-sources.jar').write_bytes(replace_entries(sources.read_bytes(), {name: (work / name).read_bytes() for name in sources_list}))
    ns = {'m': 'http://maven.apache.org/POM/4.0.0'}
    ET.register_namespace('', ns['m'])
    tree = ET.parse(pom)
    tree.getroot().find('m:version', ns).text = patched_version
    tree.write(repo / f'{module}-{patched_version}.pom', encoding='utf-8', xml_declaration=True)
    jar = work / 'patched.jar'
    jar.write_bytes(patched_classes)
    return jar, {'module': module, 'version': patched_version, 'patched_sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'changed_classes': sorted(changed)}


def main():
    WORK.mkdir(parents=True, exist_ok=True)
    java_home = os.environ.get('JAVA_HOME')
    javac = str(Path(java_home) / 'bin/javac') if java_home else shutil.which('javac')
    sdk = Path(os.environ.get('ANDROID_HOME', str(Path.home() / 'Library/Android/sdk')))
    android_jar = sdk / 'platforms/android-36/android.jar'
    if not javac or not android_jar.is_file():
        raise RuntimeError('Set JAVA_HOME and ANDROID_HOME; Android platform 36 is required')
    with tempfile.TemporaryDirectory(prefix='ft-sdk-patch-') as directory:
        temp = Path(directory)
        # Compile-only symbols: non-final R fields retain real runtime resource reads.
        # These helper classes are NOT packaged into either output AAR.
        stub = temp / 'stubs'
        stub.mkdir()
        (stub / 'UiThread.java').write_text('package androidx.annotation; public @interface UiThread {}')
        (stub / 'R.java').write_text('package com.ft.sdk.sessionreplay; public class R { public static class id { public static int ft_image_privacy; public static int ft_text_and_input_privacy; } }')
        subprocess.run([javac, '--release', '8', '-d', str(stub), str(stub / 'UiThread.java'), str(stub / 'R.java')], check=True)
        jar, sdk_manifest = build('ft-sdk', '1.7.5', SDK_VERSION, [SDK_SOURCE],
            [SDK_SOURCE.replace('.java', '.class'), SDK_SOURCE.replace('.java', '$Snapshot.class')],
            'permanent-id.patch', javac, [str(android_jar)], temp)
        _, replay_manifest = build('ft-session-replay', '0.1.8', REPLAY_VERSION,
            [REPLAY_PREFIX + n + '.java' for n in ['PermanentIdResolver', 'SnapshotProducer']],
            [REPLAY_PREFIX + n + '.class' for n in ['PermanentIdResolver', 'SnapshotProducer']],
            'replay-traversal.patch', javac, [str(android_jar), str(jar), str(stub)], temp)
        manifest = {'official_sha256': HASHES, 'artifacts': [sdk_manifest, replay_manifest]}
        (WORK / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    main()
