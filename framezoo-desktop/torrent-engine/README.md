# Torrent Engine

Framezoo ships the bundled Node worker at `torrent-engine/torrent-node.cjs`.
It runs with Electron's embedded Node (`ELECTRON_RUN_AS_NODE=1`) and uses
`torrent-stream` with a 512 KiB virtual-piece HTTP cache.

## Development

```sh
pnpm run dev
```

`pnpm run dev` bundles the worker through `pnpm run build:shell`. Release
builds copy the single worker bundle and its third-party notices into the app
resources. No Python setup is needed.

macOS and Windows targets use the same portable worker bundle.

Set `FRAMEZOO_TORRENT_DATA_DIR` to control the temporary torrent download
directory. `fileIdx` from Stremio streams is preferred; otherwise the largest
video file is selected.

Set `FRAMEZOO_TORRENT_PYTHON_ENGINE_PATH` only for temporary rollback to the
legacy Python sidecar. The normal path never falls back to Python.
