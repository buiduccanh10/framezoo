# Third-Party Notices and Attribution

Framezoo incorporates or interacts with the following third-party APIs, open-source components, native runtimes, and fonts. Their respective copyright holders and license terms are preserved below.

---

## 1. Metadata & External API Attributions

### TMDB (The Movie Database)
- **Notice:** *"This product uses the TMDB API but is not endorsed or certified by TMDB."*
- Metadata, posters, backdrops, cast/crew details, curated lists, and discovery feeds are retrieved via official TMDB APIs. All artwork and metadata remain the property of TMDB and its licensors.

### OMDb API
- Supplementary IMDb and Rotten Tomatoes reference ratings are retrieved via the official OMDb API (`OMDB_API_KEY`).

### Subtitle Service Providers
- Framezoo's optional subtitles integration interacts with third-party APIs (including OpenSubtitles.com REST API v1, SubSource API, Wyzie, and Granite), subject to each provider's terms of service and Framezoo's takedown blocklist (`/legal/dmca`).

---

## 2. Upstream & Copyleft / Permissive Software Notices

### Upstream MIT Notice (UI Components — Copyright (c) 2021 James Hawkins)
Portions of the early web/UI codebase carry forward code originally licensed under the MIT License:

> Copyright (c) 2021 James Hawkins
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

### Backend Service (`framezoo-be`) — GNU GPL v3.0
- Portions of `framezoo-be` derive from GPL-3.0 licensed backend code; the full GPL-3.0 license text is preserved verbatim at `framezoo-be/LICENSE`.
- Major runtime dependencies include Nitro (`nitropack`), `h3`, Prisma (`@prisma/client` / `@prisma/adapter-pg` — Apache-2.0), `ioredis` (MIT), `bullmq` (MIT), `nodemailer` (MIT-0), `zod` (MIT), `jsonwebtoken` (MIT), `bcryptjs` (MIT), `libsodium-wrappers` (ISC), `tweetnacl` (Unlicense), `tmdb-ts` (MIT), `prom-client` (Apache-2.0), `cheerio` (MIT), `jsdom` (MIT).

---

## 3. Desktop App (`framezoo-desktop`)
Built with Electron, Chromium, Node.js, React, Vite, Tailwind CSS, TanStack Query, Zustand, i18next, Lucide, DOMPurify, ONNX Runtime Web (`onnxruntime-web`), and Electron Builder (`MIT` / `Apache-2.0` / `BSD` licenses).

Native media/P2P helpers packaged alongside Desktop:
- **libmpv / mpv** — LGPL-2.1+ (built without GPL components).
- **FFmpeg** — LGPL-2.1+ (built without GPL components).
- **libtorrent-rasterbar** — BSD-3-Clause (configured strictly as a non-seeding streaming reader).

---

## 4. Mobile App (`framezoo-mobile`)
Built with React Native, React, React Navigation, TanStack Query, Zustand, i18next, React Native Keychain, React Native Safe Area Context, React Native Screens, AsyncStorage, `@noble/hashes`, and `tweetnacl` (`MIT` / `Unlicense`).

---

## 5. Android TV App (`framezoo-tv`)

### Native C/C++ Dependencies
Source archives, SHA-256 verification, and full upstream license texts live in `framezoo-tv/native/licenses/` (see `framezoo-tv/native/DEPENDENCIES.md`):

| Component | Pinned Version / Commit | License File |
| --- | --- | --- |
| libtorrent | 2.1.2 (BSD) | `framezoo-tv/native/licenses/libtorrent-BSD.txt` |
| try_signal | `105cce59972f925a33aa6b1c3109e4cd3caf583d` | `framezoo-tv/native/licenses/try_signal.txt` |
| Boost headers | 1.86.0 (BSL-1.0) | `framezoo-tv/native/licenses/Boost.txt` |
| OpenSSL | 3.4.2 (Apache-2.0) | `framezoo-tv/native/licenses/OpenSSL-Apache-2.0.txt` |
| mpv-android build scripts | `3137f2e377222307336fd6208262a1ea29fd707a` (MIT) | `framezoo-tv/native/licenses/mpv-android-MIT.txt` |
| mpv | v0.41.0 (LGPL-2.1+, GPL disabled) | `framezoo-tv/native/licenses/mpv-LICENSE.LGPL` |
| FFmpeg | n7.0.2 (LGPL-2.1+/LGPL-3, GPL disabled) | `framezoo-tv/native/licenses/ffmpeg-LICENSE.md`, `ffmpeg-COPYING.LGPLv2.1`, `ffmpeg-COPYING.LGPLv3` |
| libplacebo | v7.349.0 (LGPL-2.1+) | `framezoo-tv/native/licenses/libplacebo-LICENSE` |
| dav1d | 1.5.1 (BSD-2-Clause) | `framezoo-tv/native/licenses/dav1d-COPYING` |
| libass | 0.17.3 (ISC) | `framezoo-tv/native/licenses/libass-COPYING` |
| FreeType | 2.13.3 (FTL / GPLv2) | `framezoo-tv/native/licenses/freetype2-LICENSE.TXT` |
| FriBidi | 1.0.16 (LGPL-2.1+) | `framezoo-tv/native/licenses/fribidi-COPYING` |
| HarfBuzz | 11.2.0 (Old MIT) | `framezoo-tv/native/licenses/harfbuzz-COPYING` |
| libunibreak | 6.1 (zlib) | `framezoo-tv/native/licenses/unibreak-LICENCE` |
| Lua | 5.2.4 (MIT) | `framezoo-tv/native/licenses/lua-license.html` |
| Mbed TLS | 3.6.3 (Apache-2.0) | `framezoo-tv/native/licenses/mbedtls-LICENSE` |

### JVM Libraries & Typography
- AndroidX / Jetpack Compose / Material3 for TV / Lifecycle (`Apache-2.0`)
- Coil (`Apache-2.0`), Bouncy Castle `bcprov-jdk18on` (`MIT`), JUnit 4 (`EPL-1.0`)
- **Lato Font** — SIL Open Font License 1.1 (`framezoo-tv/app/src/main/assets/licenses/Lato-OFL.txt`)

---

## 6. Legal & Takedown Contact
For licensing inquiries, copyright/DMCA takedown requests, or personal data requests:
- **Operator:** Bùi Đức Cảnh (Independent Developer, Framezoo Project)
- **Email:** `framezoo.top@gmail.com` / `legal@framezoo.top` / `privacy@framezoo.top`
- **Phone:** `+84 984 908 816`
- **Web Legal Portal:** `https://framezoo.top/legal/terms`, `https://framezoo.top/legal/privacy`, `https://framezoo.top/legal/dmca`, `https://framezoo.top/legal/about`
