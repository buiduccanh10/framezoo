# Native dependencies

`build-native.sh` downloads source archives with SHA-256 checks, verifies Git commit IDs, then builds the `.so` files locally. The exact archive hashes are in that script. License texts are saved in `licenses/`.

| Component | Pinned source | License file |
| --- | --- | --- |
| libtorrent | 2.1.2 | `licenses/libtorrent-BSD.txt` |
| try_signal | `105cce59972f925a33aa6b1c3109e4cd3caf583d` | `licenses/try_signal.txt` |
| Boost headers | 1.86.0 | `licenses/Boost.txt` |
| OpenSSL | 3.4.2 | `licenses/OpenSSL-Apache-2.0.txt` |
| mpv-android build scripts | `3137f2e377222307336fd6208262a1ea29fd707a` | `licenses/mpv-android-MIT.txt` |
| mpv | `41f6a645068483470267271e1d09966ca3b9f413` (v0.41.0) | `licenses/mpv-LICENSE.LGPL` |
| FFmpeg | `e3a61e91030696348b56361bdf80ea358aef4a19` (n7.0.2) | `licenses/ffmpeg-LICENSE.md`, `licenses/ffmpeg-COPYING.LGPLv2.1`, `licenses/ffmpeg-COPYING.LGPLv3` |
| libplacebo | `1fd3c7bde7b943fe8985c893310b5269a09b46c5` (v7.349.0) | `licenses/libplacebo-LICENSE` |
| dav1d | `42b2b24fb8819f1ed3643aa9cf2a62f03868e3aa` (1.5.1) | `licenses/dav1d-COPYING` |
| libass | `e46aedea0a0d17da4c4ef49d84b94a7994664ab5` (0.17.3) | `licenses/libass-COPYING` |
| FreeType | `42608f77f20749dd6ddc9e0536788eaad70ea4b5` (2.13.3) | `licenses/freetype2-LICENSE.TXT` |
| FriBidi | 1.0.16 | `licenses/fribidi-COPYING` |
| HarfBuzz | 11.2.0 | `licenses/harfbuzz-COPYING` |
| libunibreak | 6.1 | `licenses/unibreak-LICENCE` |
| Lua | 5.2.4 | `licenses/lua-license.html` |
| Mbed TLS | 3.6.3 | `licenses/mbedtls-LICENSE` |

The build disables mpv GPL components and FFmpeg GPL components. libplacebo submodules are pinned by its Git tree. Android NDK `libc++_shared.so` comes from NDK 27.1.12297006; Android SDK/NDK terms apply.
