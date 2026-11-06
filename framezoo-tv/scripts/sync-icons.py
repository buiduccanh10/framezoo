#!/usr/bin/env python3
"""Copy the SVG paths used by desktop into Android VectorDrawables."""
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

root = Path(__file__).resolve().parents[2]
source = (root / 'framezoo-desktop/renderer-src/src/components/Icon.tsx').read_text()
out = root / 'framezoo-tv/app/src/main/res/drawable'
icons = {
    'search': 'search', 'bookmark_outline': 'bookmark', 'bookmark': 'bookmark_filled', 'ios_share': 'share', 'x': 'close', 'film': 'film', 'eye': 'eye', 'eyeSlash': 'eye_slash', 'extension': 'extension',
    'settings': 'settings', 'menu': 'menu', 'play': 'play', 'circle_question': 'question', 'feedback': 'feedback',
    'chevronLeft': 'chevron_left', 'chevronRight': 'chevron_right', 'chevronDown': 'chevron_down',
    'skip_forward': 'skip_forward', 'skip_backward': 'skip_backward',
    'arrowRight': 'arrow_right', 'up_down_arrow': 'up_down_arrow', 'chevronUp': 'chevron_up', 'clock_outline': 'clock', 'video': 'video', 'img': 'image', 'volume': 'volume', 'volume_x': 'volume_x',
}


def vector(key):
    match = re.search(r'^  ' + re.escape(key) + r': `([\s\S]*?)`,', source, re.M)
    if not match:
        raise ValueError(f'Missing desktop icon: {key}')
    svg = match.group(1)
    node = ET.fromstring(svg)
    x, y, width, height = map(float, node.attrib['viewBox'].split())
    if x or y:
        raise ValueError(f'Unsupported viewBox: {key}')
    comments = re.findall(r'<!--(.*?)-->', svg, re.S)
    lines = ['<?xml version="1.0" encoding="utf-8"?>',
             f'<!-- Generated from framezoo-desktop Icon.tsx: {key}. -->']
    lines += [f'<!-- {comment.strip()} -->' for comment in comments]
    # Match SVG preserveAspectRatio=meet for every non-square viewBox.
    scale = 24 / max(width, height)
    lines += [f'<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="{width * scale:g}dp" android:height="{height * scale:g}dp" android:viewportWidth="{width:g}" android:viewportHeight="{height:g}">']
    for child in node:
        tag = child.tag.rsplit('}', 1)[-1]
        attrs = child.attrib
        if tag == 'path':
            data = attrs.get('d', '')
        elif tag == 'line':
            data = f'M{attrs["x1"]},{attrs["y1"]} L{attrs["x2"]},{attrs["y2"]}'
        elif tag == 'polyline':
            pts = [float(v) for v in re.split(r'[\s,]+', attrs['points'].strip())]
            data = ' '.join(('M' if i == 0 else 'L') + f'{pts[i]:g},{pts[i+1]:g}' for i in range(0, len(pts), 2))
        elif tag == 'rect':
            x, y = float(attrs.get('x', '0')), float(attrs.get('y', '0'))
            w, h = float(attrs['width']), float(attrs['height'])
            radius = min(float(attrs.get('rx', '0')), w / 2, h / 2)
            if radius:
                data = (f'M{x+radius:g},{y:g} H{x+w-radius:g} a{radius:g},{radius:g} 0 0 1 {radius:g},{radius:g} '
                        f'V{y+h-radius:g} a{radius:g},{radius:g} 0 0 1 {-radius:g},{radius:g} '
                        f'H{x+radius:g} a{radius:g},{radius:g} 0 0 1 {-radius:g},{-radius:g} '
                        f'V{y+radius:g} a{radius:g},{radius:g} 0 0 1 {radius:g},{-radius:g} Z')
            else:
                data = f'M{x:g},{y:g} h{w:g} v{h:g} h{-w:g} Z'
        elif tag == 'circle':
            cx, cy, r = (float(attrs[a]) for a in ('cx', 'cy', 'r'))
            data = f'M{cx-r:g},{cy:g} a{r:g},{r:g} 0 1,0 {2*r:g},0 a{r:g},{r:g} 0 1,0 {-2*r:g},0'
        else:
            raise ValueError(f'Unsupported SVG element {tag} in {key}')
        if 'transform' in attrs:
            raise ValueError(f'Unsupported transform in {key}')
        fill = attrs.get('fill', node.attrib.get('fill', 'black'))
        stroke = attrs.get('stroke', node.attrib.get('stroke', 'none'))
        if fill == 'none' and stroke == 'none':
            continue
        parts = [f'android:pathData="{data}"']
        if fill != 'none':
            parts.append('android:fillColor="#FFFFFFFF"')
        if stroke != 'none':
            parts.extend(['android:strokeColor="#FFFFFFFF"', f'android:strokeWidth="{attrs.get("stroke-width", node.attrib.get("stroke-width", "1"))}"'])
            for prop, target in [('stroke-linecap', 'strokeLineCap'), ('stroke-linejoin', 'strokeLineJoin')]:
                value = attrs.get(prop, node.attrib.get(prop))
                if value:
                    parts.append(f'android:{target}="{value}"')
        lines.append('    <path ' + ' '.join(parts) + ' />')
    lines.append('</vector>')
    return '\n'.join(lines) + '\n'

for key, name in icons.items():
    path = out / f'desktop_{name}.xml'
    expected = vector(key)
    if '--check' in sys.argv:
        if not path.exists() or path.read_text() != expected:
            raise SystemExit(f'Icon differs from desktop: {path}')
    else:
        path.write_text(expected)

if '--check' in sys.argv:
    android = '{http://schemas.android.com/apk/res/android}'
    for path in out.glob('*.xml'):
        node = ET.parse(path).getroot()
        if node.tag != 'vector':
            continue
        width = float(node.attrib[android + 'width'].removesuffix('dp'))
        height = float(node.attrib[android + 'height'].removesuffix('dp'))
        viewport_width = float(node.attrib[android + 'viewportWidth'])
        viewport_height = float(node.attrib[android + 'viewportHeight'])
        if abs(width / height - viewport_width / viewport_height) > 0.00001:
            raise SystemExit(f'Vector aspect ratio differs from viewport: {path}')
