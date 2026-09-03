# framezoo-desktop

Electron shell for `framezoo-fe`.

## What this package does

- builds `framezoo-fe` into `framezoo-desktop/renderer`
- bundles Electron `main` and `preload` code into `framezoo-desktop/dist`
- packages a native desktop app with `electron-builder`

## libmpv Resources

Desktop playback uses the libmpv Render API through the native Node-API addon.
The app does not spawn the MPV CLI or create an MPV IPC socket.

Supported targets:

- `darwin-arm64`
- `darwin-x64`
- `win32-arm64`
- `win32-x64`

Build from a pinned libmpv `v0.41.0` runtime root. On macOS, the staging
script copies the non-system dylib dependency closure and rewrites it to
`@loader_path`; on Windows it stages the matching DLL set:

```bash
LIBMPV_ROOT=/path/to/pinned/libmpv CMAKE=/path/to/cmake \
  pnpm run native:build:host
LIBMPV_ROOT=/path/to/pinned/libmpv pnpm run resources:ensure
```

`electron-builder` packages the native addon and matching libmpv runtime from
`resources/native/${platform}-${arch}` and
`resources/libmpv/${platform}-${arch}`. Linux is not a supported desktop
native target.

For a macOS universal build, build both slices first, then combine the addon,
libmpv, and dependency dylibs:

```bash
pnpm run native:build:darwin-arm64
pnpm run native:build:darwin-x64
pnpm run native:build:darwin-universal
pnpm run resources:ensure:darwin-universal
```

## Commands

From the repo root:

```bash
pnpm install
pnpm run dev:desktop
pnpm run build:desktop
pnpm run pack:desktop
pnpm run dist:desktop
pnpm run dist:desktop:mac:arm64
pnpm run dist:desktop:mac:x64
pnpm run dist:desktop:mac:universal
```

## Backend URL

The Electron preload injects runtime config into the renderer as `window.__CONFIG__`.

Default backend:

```text
http://127.0.0.1:3000
```

Desktop login / onboarding pings `http://127.0.0.1:3000/meta` so the app can verify
the local backend even before the user is authenticated.

Override at launch time:

```bash
FRAMEZOO_BACKEND_URL=https://your-api.example.com pnpm run dev:desktop
```

or

```bash
FRAMEZOO_BACKEND_URL=https://your-api.example.com pnpm run dist:desktop
```

## Releases and Updates

`.github/workflows/publish-desktop.yml` builds four release variants:
`mac-arm64`, `mac-x64`, `win-x64`, and `win-arm64`. It publishes installers,
update feeds, blockmaps, and manifests to the public
`buiduccanh10/framezoo-desktop-releases` GitHub repository.

The source repository needs an Actions secret named `DESKTOP_RELEASE_TOKEN`.
Use a fine-grained GitHub token with `Contents: Read and write` access to
`framezoo-desktop-releases`. The release repository must contain an initial
commit before the first release.

The website fetches `download-manifest.json` server-side through `/download`;
installer requests redirect to GitHub Release assets. Desktop update checks use
the GitHub Release feed directly. Windows uses `electron-updater`; unsigned
macOS builds keep the existing manual ZIP, `xattr -cr`, and ad-hoc `codesign`
installation path.

## Current limitations

- `window.__FRAMEZOO_DESKTOP__` is enabled and backed by a minimal Electron IPC bridge.
- The bridge currently covers the extension-style calls the frontend already expects: `hello`, `makeRequest`, `prepareStream`, and `openPage`.
- `BrowserWindow.webPreferences.webSecurity` is enabled. Packaged windows use the `app://renderer` origin, so `framezoo-be` must allow that origin in production CORS.
- Mac signing/notarization and Windows signing are not configured yet.
- Local desktop-origin CORS support for `framezoo-be` allows `localhost` and `127.0.0.1` origins in development.
