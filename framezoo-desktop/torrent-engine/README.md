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

For an authorized HTTP proxy, launch the desktop process with `http_proxy` and
`https_proxy` set to the proxy URL. Set `no_proxy=localhost,127.0.0.1,::1` so
the local torrent stream stays local. HTTP(S) tracker discovery uses these
environment variables, and libmpv uses `http_proxy` for HTTP and HTTPS media.
The proxy does not automatically carry BitTorrent peer connections.
