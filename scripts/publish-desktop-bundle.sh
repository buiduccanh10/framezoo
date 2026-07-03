#!/usr/bin/env sh
set -eu

STAGING_BUNDLE="${DESKTOP_PUBLISH_STAGING_BUNDLE:-/staging/desktop-release-bundle.tar.gz}"
CHANNEL="${DESKTOP_PUBLISH_CHANNEL:-stable}"
DOWNLOADS_ROOT="${APP_DOWNLOAD_DIR:-/data/downloads}"
UPDATES_ROOT="${DOWNLOADS_ROOT}/desktop-updates"
RELEASES_ROOT="${UPDATES_ROOT}/releases"
WORK_ROOT="${UPDATES_ROOT}/.publish-${CHANNEL}-$$"

if [ ! -f "$STAGING_BUNDLE" ]; then
  echo "Desktop release bundle not found: $STAGING_BUNDLE"
  exit 1
fi

mkdir -p "$RELEASES_ROOT"
rm -rf "$WORK_ROOT"
mkdir -p "$WORK_ROOT"

cleanup() {
  rm -rf "$WORK_ROOT"
}

trap cleanup EXIT

tar -xzf "$STAGING_BUNDLE" -C "$WORK_ROOT"
node /workspace/scripts/verify-desktop-release-bundle.js "$WORK_ROOT" >/dev/null

VERSION="$(node -e "const fs=require('node:fs'); const path=require('node:path'); const manifest=JSON.parse(fs.readFileSync(path.join(process.argv[1],'manifest.json'),'utf8')); process.stdout.write(manifest.version);" "$WORK_ROOT")"
TARGET_RELEASE_DIR="${RELEASES_ROOT}/${VERSION}"
CHANNEL_PATH="${UPDATES_ROOT}/${CHANNEL}"
NEXT_LINK_PATH="${UPDATES_ROOT}/.${CHANNEL}.next"
rm -rf "$TARGET_RELEASE_DIR"
mkdir -p "$TARGET_RELEASE_DIR"
cp -R "$WORK_ROOT"/. "$TARGET_RELEASE_DIR"/

if [ -e "$CHANNEL_PATH" ] && [ ! -L "$CHANNEL_PATH" ]; then
  LEGACY_RELEASE_DIR="${RELEASES_ROOT}/${CHANNEL}-legacy-$(date +%Y%m%d%H%M%S)"
  mv "$CHANNEL_PATH" "$LEGACY_RELEASE_DIR"
  ln -s "releases/$(basename "$LEGACY_RELEASE_DIR")" "$CHANNEL_PATH"
fi

rm -f "$NEXT_LINK_PATH"
ln -s "releases/${VERSION}" "$NEXT_LINK_PATH"
rm -f "$CHANNEL_PATH"
mv -f "$NEXT_LINK_PATH" "$CHANNEL_PATH"

rm -f "$STAGING_BUNDLE"
echo "Published desktop release ${VERSION} to channel ${CHANNEL}"
