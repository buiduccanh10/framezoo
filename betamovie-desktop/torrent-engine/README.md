# Torrent Engine

Local development sidecar using Python `libtorrent`.

## macOS ARM64

```sh
pnpm run torrent:setup
pnpm run dev:torrent
```

`dev:torrent` sets `BETAMOVIE_TORRENT_ENGINE_PATH` to the sidecar launcher.
The sidecar exposes a local HTTP Range endpoint consumed by the renderer.

Set `BETAMOVIE_TORRENT_DATA_DIR` to control the temporary torrent download
directory. `fileIdx` from Stremio streams is preferred; otherwise the largest
video file is selected.
