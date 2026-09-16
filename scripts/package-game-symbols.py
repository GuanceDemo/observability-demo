#!/usr/bin/env python3
"""Package exact unminified game sources with line-accurate Source Map v3 files."""
import json
import shutil
import sys
from pathlib import Path

def package(source, target):
    for name in ('game-runtime.js', 'game-hub.js', 'plants-engine.js', 'pvz-clock.js', 'plants-game.js', 'webgl-replay-game.js'):
        code = (source / name).read_text()
        target.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source / name, target / name)
        symbols = {'version': 3, 'file': name, 'sources': [name], 'sourcesContent': [code], 'names': [],
                   'mappings': ';'.join(['AAAA'] + ['AACA'] * (len(code.splitlines()) - 1))}
        (target / (name + '.map')).write_text(json.dumps(symbols, ensure_ascii=False))

if __name__ == '__main__':
    package(Path(sys.argv[1]), Path(sys.argv[2]))
