#!/usr/bin/env python3
"""Sync Discover rating assets from desktop."""
import re
import sys
from pathlib import Path
root = Path(__file__).resolve().parents[2]
assets = root / 'framezoo-tv/app/src/main/assets/ratings'
assets.mkdir(exist_ok=True)
source = root / 'framezoo-desktop/renderer-src/public/tomatoes'
files = {path.name: path.read_bytes() for path in source.glob('*.svg')}
files['dice.svg'] = (root / 'framezoo-desktop/renderer-src/public/lightbar-images/dice.svg').read_bytes()
icons = (root / 'framezoo-desktop/renderer-src/src/components/Icon.tsx').read_text()
match = re.search(r'^  imdb: `([\s\S]*?)`,', icons, re.M)
if not match: raise SystemExit('Missing desktop IMDb icon')
files['imdb.svg'] = match.group(1).replace('currentColor', '#facc15').encode()
for name, data in files.items():
    path = assets / name
    if '--check' in sys.argv:
        if not path.exists() or path.read_bytes() != data: raise SystemExit(f'Asset differs: {path}')
    else: path.write_bytes(data)

platforms = root / 'framezoo-tv/app/src/main/assets/platforms'
platforms.mkdir(exist_ok=True)
for source_file in (root / 'framezoo-desktop/renderer-src/public/platforms').glob('*.png'):
    target = platforms / source_file.name
    data = source_file.read_bytes()
    if '--check' in sys.argv:
        if not target.exists() or target.read_bytes() != data: raise SystemExit(f'Asset differs: {target}')
    else: target.write_bytes(data)

thumbnail = root / 'framezoo-tv/app/src/main/res/drawable-nodpi/desktop_trailer_placeholder.png'
thumbnail_data = (root / 'framezoo-desktop/renderer-src/public/thumbnail-placeholder.png').read_bytes()
if '--check' in sys.argv:
    if not thumbnail.exists() or thumbnail.read_bytes() != thumbnail_data: raise SystemExit(f'Asset differs: {thumbnail}')
else: thumbnail.write_bytes(thumbnail_data)
