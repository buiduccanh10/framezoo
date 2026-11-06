#!/usr/bin/env python3
"""Run on an Android TV with FrameZoo open at the top of Discover: python3 scripts/check-discover-dpad.py SERIAL."""
import subprocess
import sys
import xml.etree.ElementTree as ET

adb = ["adb", "-s", sys.argv[1]]

def key(name, hold=False):
    subprocess.run(adb + ["shell", "input", "keyevent"] + (["--longpress"] if hold else []) + ["KEYCODE_DPAD_" + name], check=True)

def focused():
    subprocess.run(adb + ["shell", "uiautomator", "dump", "/sdcard/framezoo-nav-check.xml"], check=True, stdout=subprocess.DEVNULL)
    root = ET.fromstring(subprocess.check_output(adb + ["shell", "cat", "/sdcard/framezoo-nav-check.xml"]))
    for node in root.iter("node"):
        if node.get("focused") == "true" and node.get("class") != "android.webkit.WebView":
            return " ".join((child.get("text", "") + " " + child.get("content-desc", "")).strip() for child in node.iter("node")).strip()
    raise AssertionError("Không tìm thấy focus")

assert "FrameZoo" in focused(), "Đưa focus về logo ở đầu Discover trước khi chạy"
key("DOWN"); key("DOWN")
assert "Tất cả" in focused()
key("RIGHT")
assert "Phim truyền hình" in focused()
key("RIGHT", hold=True)
assert "Quốc gia" in focused()
key("LEFT", hold=True)
assert "Phim truyền hình" in focused()
key("RIGHT", hold=True)
assert "Quốc gia" in focused()
key("RIGHT", hold=True)
assert "Năm" in focused()
key("LEFT", hold=True)
assert "Quốc gia" in focused()
key("LEFT", hold=True)
assert "Phim truyền hình" in focused()
print("Discover D-pad: PASS")
