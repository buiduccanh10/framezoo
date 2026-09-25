# Native libmpv addon

Supported targets:

- `darwin-arm64`
- `darwin-x64`
- `win32-arm64`
- `win32-x64`

Build with a Node header directory and a staged libmpv runtime:

```bash
NODE_INCLUDE_DIR=/path/to/node/include/node \
LIBMPV_ROOT=/path/to/pinned/libmpv \
pnpm run native:build:host
```

The CMake target dynamically loads libmpv at runtime. The addon is staged at
`resources/native/<platform>-<arch>/libmpv.node`; the matching runtime belongs
in `resources/libmpv/<platform>-<arch>/`.

## macOS surface suspend regression

This creates a real AppKit `NSOpenGLView`, queues an AppKit paint, disables
painting, and destroys the surface before the queued work is drained. It
regresses the stale `drawRect` lifecycle seen around sleep/wake.

```bash
SDKROOT="$(xcrun --sdk macosx --show-sdk-path)" \
cmake -S native -B native/build/darwin-arm64 -DFRAMEZOO_NATIVE_BUILD_TESTS=ON
SDKROOT="$(xcrun --sdk macosx --show-sdk-path)" \
cmake --build native/build/darwin-arm64 --target platform_surface_mac_test
ctest --test-dir native/build/darwin-arm64 --output-on-failure
```
