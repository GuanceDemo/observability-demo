#!/usr/bin/env python3
"""Exercise the actual original/patched AAR compressor and Replay segment joining.

Optional --capture-dir reads previously captured multipart *.body files locally;
it never sends or modifies telemetry. Raw headers and payloads are not printed.
"""
import argparse
import importlib.util
import os
from pathlib import Path
import random
import struct
import subprocess
import tempfile
import zipfile
import zlib

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('patch_builder', Path(__file__).with_name('build-ft-sdk-patch.py'))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def join_segments(segments, payloads):
    # Replay transport strips each independent header/trailer and joins the
    # byte-aligned blocks, followed by one final block and combined checksum.
    return (segments[0][:2] + b''.join(s[2:-6] for s in segments) + b'\x03\x00' +
            struct.pack('>I', zlib.adler32(b''.join(payloads))))


def inflate_complete(data):
    inflater = zlib.decompressobj()
    result = inflater.decompress(data) + inflater.flush()
    assert inflater.eof, 'Truncated compressed stream'
    assert not inflater.unused_data, 'Extra stream or trailing bytes'
    assert not inflater.unconsumed_tail, 'Unconsumed input'
    return result


def captured_segments(directory):
    result = []
    for path in sorted(directory.glob('*.body')):
        body = path.read_bytes()
        if not body.startswith(b'--'):
            continue
        for part in body.split(body.split(b'\r\n', 1)[0]):
            header, sep, data = part.partition(b'\r\n\r\n')
            if sep and b'name="segment"' in header:
                compressed = data.removesuffix(b'\r\n')
                result.append((compressed, zlib.decompress(compressed)))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--capture-dir', type=Path)
    args = parser.parse_args()
    rng = random.Random(42)
    payloads = [bytes(rng.randrange(256) for _ in range(n))
                for n in (0, 1, 1023, 1024, 1025, 2048, 65536, 1000000)]
    payloads += [b'\x00' * 1000000, '{"text":"确认闪退"}\n'.encode()]
    captured = captured_segments(args.capture_dir) if args.capture_dir else []
    if args.capture_dir:
        assert len(captured) > 1, 'Need multiple captured segments'
        payloads += [p for _, p in captured]
    java_bin = Path(os.environ['JAVA_HOME']) / 'bin'
    work = builder.WORK
    original_aar = builder.download('ft-session-replay', '0.1.8', '.aar')
    official_aar = builder.download('ft-session-replay', builder.REPLAY_BASE_VERSION, '.aar')
    patched = work / 'maven' / builder.GROUP / 'ft-session-replay' / builder.REPLAY_VERSION / f'ft-session-replay-{builder.REPLAY_VERSION}.aar'
    with tempfile.TemporaryDirectory(prefix='replay-compression-test-') as tmp:
        tmp = Path(tmp)
        source = tmp / 'CompressionProbe.java'
        source.write_text('''import java.nio.file.*;
import com.ft.sdk.sessionreplay.internal.net.BytesCompressor;
public class CompressionProbe {
 public static void main(String[] args) throws Exception {
  BytesCompressor compressor = new BytesCompressor();
  for (String arg : args) {
   Path input = Paths.get(arg);
   Files.write(Paths.get(arg + ".z"), compressor.compressBytes(Files.readAllBytes(input)));
  }
 }
}''')
        results = {}
        for name, aar in [('original', original_aar), ('official', official_aar), ('patched', patched)]:
            folder = tmp / name
            folder.mkdir()
            jar = folder / 'replay.jar'
            with zipfile.ZipFile(aar) as archive:
                jar.write_bytes(archive.read('classes.jar'))
            subprocess.run([str(java_bin / 'javac'), '--release', '8', '-cp', str(jar), '-d', str(folder), str(source)], check=True)
            inputs = []
            for i, data in enumerate(payloads):
                path = folder / f'{i}.bin'
                path.write_bytes(data)
                inputs.append(str(path))
            subprocess.run([str(java_bin / 'java'), '-cp', os.pathsep.join([str(folder), str(jar)]), 'CompressionProbe', *inputs], check=True)
            results[name] = [Path(p + '.z').read_bytes() for p in inputs]
        assert results['official'] == results['patched'], 'Local patches changed official compression output'
        for payload, compressed in zip(payloads, results['patched']):
            assert inflate_complete(compressed) == payload
        assert inflate_complete(join_segments(results['patched'], payloads)) == b''.join(payloads)
        # Pin the old failure: it round-trips individually but appends another
        # stream and terminates a concatenated Replay after the first payload.
        for payload, compressed in zip(payloads, results['original']):
            decoder = zlib.decompressobj()
            assert decoder.decompress(compressed) == payload
            assert decoder.eof and decoder.unused_data
        old_join = zlib.decompress(join_segments(results['original'][1:], payloads[1:]))
        assert old_join == payloads[1] and old_join != b''.join(payloads[1:])
        if captured:
            compressed, plain = zip(*captured)
            assert zlib.decompress(join_segments(compressed, plain)) == plain[0]
        print(f'PASS: {len(payloads)} payloads round-trip with no trailing stream; joined output complete; original first-segment truncation reproduced; {len(captured)} captured segments checked.')


if __name__ == '__main__':
    main()
