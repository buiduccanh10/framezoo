#!/usr/bin/env python3
"""Run on an Android TV with FrameZoo open at the top of Discover: python3 scripts/check-discover-dpad.py SERIAL."""
import subprocess
import sys
import xml.etree.ElementTree as ET

adb = ["adb", "-s", sys.argv[1]]

def key(name, hold=False):
    subprocess.run(adb + ["shell", "input", "keyevent"] + (["--longpress"] if hold else []) + ["KEYCODE_DPAD_" + name], check=True)

def focused():
    for _ in range(10):
        try:
            res = subprocess.run(adb + ["shell", "uiautomator", "dump", "/sdcard/framezoo-nav-check.xml"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if res.returncode == 0:
                raw = subprocess.check_output(adb + ["shell", "cat", "/sdcard/framezoo-nav-check.xml"])
                if raw.strip().startswith(b"<?xml"):
                    root = ET.fromstring(raw)
                    for node in root.iter("node"):
                        if node.get("focused") == "true" and node.get("class") != "android.webkit.WebView":
                            val = " ".join((child.get("text", "") + " " + child.get("content-desc", "")).strip() for child in node.iter("node")).strip()
                            if val:
                                return val
        except Exception:
            pass
        import time; time.sleep(0.5)
    raise AssertionError("Không tìm thấy focus")

def has_any(text, *candidates):
    return any(c.lower() in text.lower() for c in candidates)

assert "FrameZoo" in focused(), "Đưa focus về logo ở đầu Discover trước khi chạy"
key("DOWN"); key("DOWN")
assert has_any(focused(), "Tất cả", "All")
key("RIGHT")
assert has_any(focused(), "Phim truyền hình", "Series", "TV Shows")
key("RIGHT", hold=True)
assert has_any(focused(), "Quốc gia", "Country")
key("LEFT", hold=True)
assert has_any(focused(), "Phim truyền hình", "Series", "TV Shows")
key("RIGHT", hold=True)
assert has_any(focused(), "Quốc gia", "Country")
key("RIGHT", hold=True)
assert has_any(focused(), "Năm", "Year")
key("LEFT", hold=True)
assert has_any(focused(), "Quốc gia", "Country")
key("LEFT", hold=True)
assert has_any(focused(), "Phim truyền hình", "Series", "TV Shows")
print("Discover D-pad: PASS")
