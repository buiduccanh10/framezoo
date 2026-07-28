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
