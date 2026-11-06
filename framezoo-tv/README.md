# FrameZoo TV

Android TV riêng; Kotlin, Compose, libtorrent RAM storage, libmpv. Không dùng `framezoo-mobile` hay player giả.

## Cấu trúc

| Thư mục | Trách nhiệm |
| --- | --- |
| `app/src/main/java/com/framezoo/tv/ui` | Màn hình Compose, state holder (`FrameZooState`), component D-pad, theme, player UI |
| `app/src/main/java/com/framezoo/tv/api` | Backend FrameZoo/TMDB và addon Stremio |
| `app/src/main/java/com/framezoo/tv/auth`, `model`, `storage` | Ed25519, kiểu dữ liệu, token mã hóa bằng Keystore |
| `app/src/main/java/com/framezoo/tv/player` | Vòng đời libmpv và SurfaceView phía Kotlin |
| `app/src/main/cpp/TorrentStream.cpp` | libtorrent, piece trong RAM, ưu tiên tải và tua |
| `app/src/main/cpp/MpvBridge.cpp` | JNI, libmpv và stream callback |
| `native` | Script build thư viện native, checksum, giấy phép |

Compose dùng state holder và callback; Kotlin không có `hooks` như React. Tách thêm file theo từng màn khi mỗi màn có trạng thái hoặc luồng độc lập.

UI TV dùng 23 theme preset và theme tùy chỉnh của desktop. Token và tên theme tiếng Việt trong `app/src/main/assets` được tạo từ `framezoo-desktop/renderer-src/themes` và locale desktop. Sau khi đổi theme desktop, chạy từ gốc monorepo:

```sh
node --import tsx framezoo-tv/scripts/sync-themes.mjs
node --import tsx framezoo-tv/scripts/sync-themes.mjs --check
```

Font Lato nằm trong `app/src/main/res/font`; giấy phép OFL ở `app/src/main/assets/licenses/Lato-OFL.txt`.

## Build

Yêu cầu Android SDK 36, Build Tools 36, NDK 27.1.12297006, JDK 17–21, CMake, Ninja, Meson, pkg-config, GNU sed/coreutils và wget. Trên macOS: `brew install meson ninja pkgconf wget gnu-sed coreutils`.

```sh
cd framezoo-tv
./gradlew assembleDebug
```

Mở thư mục `framezoo-tv` trong Android Studio. Gradle tự chạy `native/build-native.sh` khi thiếu native artifacts, tạo `.so` trong `app/src/main/jniLibs`; lần đầu cần thời gian để biên dịch. APK release chỉ `arm64-v8a`. Emulator x86_64: `./gradlew assembleDebug -PtvAbi=x86_64`.

Backend mặc định `https://api.framezoo.top`. Đặt URL khi build bằng biến môi trường hoặc Gradle property:

```sh
FRAMEZOO_TV_BACKEND_URL=https://api.example.com ./gradlew assembleDebug
./gradlew assembleDebug -PframezooBackendUrl=https://api.example.com
```

Biến môi trường được ưu tiên hơn Gradle property. Cài đặt trong ứng dụng ghi đè URL khi build; đổi backend sẽ đăng xuất và tải lại Discover. Bản release yêu cầu HTTPS; bản debug hỗ trợ HTTP, ví dụ `http://10.0.2.2:3000` để emulator kết nối máy chạy backend. URL build là cấu hình mặc định, không chứa bí mật.

 Addon manifest do người dùng tự cài. Torrent chỉ giữ tối đa 128 MiB piece trong RAM; dừng phát giải phóng dữ liệu. Phát 4K/HDR cần kiểm trên TV thật và codec/display tương ứng.

Native RAM storage bắt đầu từ ví dụ `examples/custom_storage.cpp` của libtorrent (BSD license), sau đó thêm giới hạn RAM, xác minh piece và kết nối libmpv. Nguồn libtorrent 2.1.2, OpenSSL 3.4.2, Boost 1.86.0 được kiểm SHA-256 trong script. mpv-android build scripts khóa commit `3137f2e`; mpv khóa `v0.41.0`.
