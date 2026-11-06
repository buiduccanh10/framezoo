#!/usr/bin/env python3
import os
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "..", "framezoo-desktop", "renderer-src", "src", "assets", "locales")
DEST = os.path.join(ROOT, "app", "src", "main", "assets", "locales")

if not os.path.exists(SRC):
    raise SystemExit(f"Desktop locales directory not found: {SRC}")

shutil.rmtree(DEST, ignore_errors=True)
shutil.copytree(SRC, DEST)
count = len([f for f in os.listdir(DEST) if f.endswith(".json")])
print(f"Synced {count} locale files 100% identical from {SRC} to {DEST}")
