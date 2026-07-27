# betamovie-desktop

Electron shell for `betamovie-fe`.

## What this package does

- builds `betamovie-fe` into `betamovie-desktop/renderer`
- bundles Electron `main` and `preload` code into `betamovie-desktop/dist`
- packages a native desktop app with `electron-builder`

## MPV Resources

MPV resources are downloaded locally and ignored by Git. Development uses only
the current host target. Targeted release commands download only the target
being packaged:

- `dist:desktop:mac:arm64` -> `darwin-arm64`
- `dist:desktop:mac:x64` -> `darwin-x64`
- `package:release:win:arm64` -> `win32-arm64`
- `package:release:win:x64` -> `win32-x64`

`electron-builder` copies only `resources/bin/${platform}-${arch}/**`, including
the MPV executable and its `lib` dependencies. Other platform directories stay
out of the app bundle.

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
BETAMOVIE_BACKEND_URL=https://your-api.example.com pnpm run dev:desktop
```

or

```bash
BETAMOVIE_BACKEND_URL=https://your-api.example.com pnpm run dist:desktop
```

## Current limitations

- `window.__ALPHAFLIX_DESKTOP__` is enabled and backed by a minimal Electron IPC bridge.
- The bridge currently covers the extension-style calls the frontend already expects: `hello`, `makeRequest`, `prepareStream`, and `openPage`.
- `BrowserWindow.webPreferences.webSecurity` is enabled. Packaged windows use the `app://renderer` origin, so `betamovie-be` must allow that origin in production CORS.
- Mac signing/notarization and Windows signing are not configured yet.
- Local desktop-origin CORS support for `betamovie-be` allows `localhost` and `127.0.0.1` origins in development.
