# Torrent Engine

Bundled Python sidecar using Python `libtorrent`.

## Development

```sh
pnpm run dev
```

`pnpm run dev` prepares the local Python environment automatically. The main
process resolves `torrent-engine/run.sh` without `FRAMEZOO_TORRENT_ENGINE_PATH`.
Release builds compile a self-contained PyInstaller sidecar and copy it into
the app resources.

macOS release targets must be built on a runner matching the target
architecture. Windows ARM64 packages use the x64 sidecar, which Windows ARM64
runs through x64 emulation because the pinned `libtorrent` release does not
publish a Windows ARM64 wheel.

Set `FRAMEZOO_TORRENT_DATA_DIR` to control the temporary torrent download
directory. `fileIdx` from Stremio streams is preferred; otherwise the largest
video file is selected.
