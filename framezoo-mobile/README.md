# FrameZoo Mobile

Bare React Native TypeScript app for Android phone and Android TV.

## Scope

- Independent app. No imports from `framezoo-desktop`.
- Mobile bottom tabs. Android TV left navigation rail.
- Generic user-installed addons for `catalog`, `meta`, `stream`, `subtitles` and `addon_catalog`.
- Stream sources remain addon-owned. The app does not bundle resolver, scraper, host or movie-open logic.
- Player is `MockPlayerAdapter` until the native `libmpv`/`libtorrent` phase.

## Development

Metro dev server with Fast Refresh:

```bash
pnpm --filter framezoo-mobile dev
```

One-command iOS development: select a simulator/device, then run Debug with
Metro and Fast Refresh:

```bash
pnpm --filter framezoo-mobile ios:dev
```

Android development:

```bash
pnpm --filter framezoo-mobile android:dev
```

The CLI starts Metro automatically for `ios:dev` and `android:dev`. Use the
separate `dev` command when Metro must be managed in its own terminal.

When Metro cache is stale:

```bash
pnpm --filter framezoo-mobile dev:reset
```

Equivalent legacy commands remain available:

```bash
pnpm --filter framezoo-mobile start
pnpm --filter framezoo-mobile ios
pnpm --filter framezoo-mobile android
pnpm --filter framezoo-mobile typecheck
pnpm --filter framezoo-mobile lint
pnpm --filter framezoo-mobile exec jest --runInBand
```

Android builds require a supported JDK. Android Studio JDK 21 works in this workspace:

```bash
cd framezoo-mobile/android
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew assembleDebug
```

APK output:

```text
framezoo-mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

Configure the backend in the auth screen. Login and registration use the backend challenge/signature contract. No fake local account is created.

## Backend configuration

Development defaults to `http://127.0.0.1:3000`. Release bundles read the backend
from `FRAMEZOO_BACKEND_URL`, falling back to `VITE_BACKEND_URL`:

```bash
FRAMEZOO_BACKEND_URL=https://api.example.com pnpm --filter framezoo-mobile ios:release
FRAMEZOO_BACKEND_URL=https://api.example.com pnpm --filter framezoo-mobile android:release
```

The Settings screen can still override the backend URL on a device.

## Native roadmap

The current player exposes the stable `PlayerAdapter` contract through `MockPlayerAdapter`. Replace it with native `libmpv`, `libtorrent`, PiP and Cast integrations only after the UI and addon contracts are validated.
