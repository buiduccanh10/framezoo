#!/usr/bin/env python3
"""Sync Discover providers and editor picks from desktop."""
import json
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[2]
source = (root / 'framezoo-desktop/renderer-src/src/pages/discover/types/discover.ts').read_text()
output = root / 'framezoo-tv/app/src/main/assets/discover.json'

def block(name):
    return re.search(r'(?:const|export const) ' + name + r'[^=]*=\s*\[([\s\S]*?)\];', source).group(1)

data = {}
for name in ('MOVIES_DATA', 'TV_SHOWS_DATA'):
    data[name] = [{'id': int(i), 'type': t} for i, t in re.findall(r'\{ id: (\d+), type: "(movie|show)" \}', block(name))]
for name in ('MOVIE_PROVIDERS', 'TV_PROVIDERS'):
    data[name] = [{'name': n, 'id': i} for n, i in re.findall(r'\{ name: "([^"]+)", id: "(\d+)" \}', block(name))]
expected = json.dumps(data, ensure_ascii=False, indent=2) + '\n'
if '--check' in sys.argv:
    if not output.exists() or output.read_text() != expected:
        raise SystemExit('Discover data differs from desktop')
else:
    output.write_text(expected)
