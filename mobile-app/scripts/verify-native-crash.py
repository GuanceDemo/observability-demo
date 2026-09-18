#!/usr/bin/env python3
"""Check packaged JNI crash opt-in and exact matching native debug symbols."""
import argparse
import os
from pathlib import Path
import re
import subprocess
import tempfile
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('apk')
parser.add_argument('symbols')
parser.add_argument('--enabled', action='store_true')
args = parser.parse_args()
sdk = Path(os.environ.get('ANDROID_HOME', os.environ.get('ANDROID_SDK_ROOT', '')))
readelf = sdk / 'ndk/27.1.12297006/toolchains/llvm/prebuilt/darwin-x86_64/bin/llvm-readelf'
with zipfile.ZipFile(args.apk) as apk, zipfile.ZipFile(args.symbols) as symbols, tempfile.TemporaryDirectory() as tmp:
    for abi in ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64']:
        packaged = Path(tmp) / 'packaged.so'
        debug = Path(tmp) / 'debug.so'
        packaged.write_bytes(apk.read(f'lib/{abi}/libdemo_native_faults.so'))
        names = [n for n in symbols.namelist() if n.startswith(abi + '/') and 'libdemo_native_faults.so' in n]
        assert len(names) == 1, (abi, names)
        debug.write_bytes(symbols.read(names[0]))
        dyn = subprocess.check_output([str(readelf), '--dyn-syms', str(packaged)], text=True)
        assert 'Java_com_malldemomobile_DemoNativeCrash_prepareCheckout' in dyn
        has_abort = bool(re.search(r'\bUND\s+abort(?:@|\s|$)', dyn))
        assert has_abort == args.enabled, (abi, 'abort import does not match opt-in')
        ids = []
        for binary in [packaged, debug]:
            notes = subprocess.check_output([str(readelf), '--notes', str(binary)], text=True)
            ids.append(re.search(r'Build ID: (\w+)', notes).group(1))
        assert ids[0] == ids[1], (abi, 'symbols from a different build')
        print(f'{abi}: enabled={args.enabled}, matching Build ID {ids[0]}')
