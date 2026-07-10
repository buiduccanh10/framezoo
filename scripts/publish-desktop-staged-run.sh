#!/usr/bin/env sh
set -eu

STAGED_INPUT_ROOT="${STAGED_INPUT_ROOT:-}"
if [ -z "$STAGED_INPUT_ROOT" ]; then
  echo "STAGED_INPUT_ROOT is required."
  exit 1
fi

BUNDLE_SCRIPT_ROOT="${BUNDLE_SCRIPT_ROOT:-${STAGED_INPUT_ROOT}/scripts}"
CHANNEL="${DESKTOP_PUBLISH_CHANNEL:-stable}"
PUBLISHED_AT="${PUBLISHED_AT:-$(date -u +"%Y-%m-%dT%H:%M:%SZ")}"
DOWNLOADS_ROOT="${APP_DOWNLOAD_DIR:-/data/downloads}"
UPDATES_ROOT="${DOWNLOADS_ROOT}/desktop-updates"
RELEASES_ROOT="${UPDATES_ROOT}/releases"
WORK_ROOT="${UPDATES_ROOT}/.publish-${CHANNEL}-$$"

mkdir -p "$RELEASES_ROOT"
rm -rf "$WORK_ROOT"

cleanup() {
  rm -rf "$WORK_ROOT"
}

trap cleanup EXIT

node "$BUNDLE_SCRIPT_ROOT/create-desktop-release-bundle.js" \
  --input-root "$STAGED_INPUT_ROOT" \
  --output-dir "$WORK_ROOT" \
  --channel "$CHANNEL" \
  --published-at "$PUBLISHED_AT" >/dev/null

node "$BUNDLE_SCRIPT_ROOT/verify-desktop-release-bundle.js" "$WORK_ROOT" >/dev/null

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

echo "Published desktop release ${VERSION} to channel ${CHANNEL}"

KEEP=3
echo "Cleaning up old releases, keeping the newest ${KEEP}..."
ls -dt "$RELEASES_ROOT"/*/ 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -rf
echo "Cleanup finished."
