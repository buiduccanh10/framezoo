# FrameZoo TV

Android TV riêng; Kotlin, Compose, Material 3 for TV, libtorrent RAM storage, libmpv. Material 3 thông thường vẫn dùng cho trường nhập và menu thả xuống. Không dùng `framezoo-mobile` hay player giả.

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

Font Lato nằm trong `app/src/main/res/font`; giấy phép OFL ở `app/src/main/assets/licenses/Lato-OFL.txt`. Logo và ảnh chờ lấy từ desktop; các vector Android được tạo từ `renderer-src/src/components/Icon.tsx`, giữ thông tin giấy phép trong từng file. Khi desktop đổi icon, chạy:

```sh
python3 framezoo-tv/scripts/sync-icons.py
python3 framezoo-tv/scripts/sync-icons.py --check
```

Danh sách nhà cung cấp, lựa chọn biên tập và biểu tượng đánh giá cũng đồng bộ từ desktop:

```sh
python3 framezoo-tv/scripts/sync-discover.py
python3 framezoo-tv/scripts/sync-ratings.py
python3 framezoo-tv/scripts/sync-discover.py --check
python3 framezoo-tv/scripts/sync-ratings.py --check
```

## Cấu hình Backend URL

Backend URL bắt buộc phải được cấu hình qua biến môi trường hoặc file `.env` (không tự động fallback ngầm để tránh nhầm lẫn giữa môi trường test và prod). Sao chép `.env.example` thành `.env` trong thư mục `framezoo-tv`, rồi đặt URL:

```env
FRAMEZOO_TV_BACKEND_URL=http://localhost:3000
```

- **Thứ tự ưu tiên**: Biến môi trường `FRAMEZOO_TV_BACKEND_URL` > Gradle property (`-PframezooTvBackendUrl=...`) > file `framezoo-tv/.env`.
- **Bắt buộc cấu hình**: Nếu thiếu `FRAMEZOO_TV_BACKEND_URL`, quá trình build sẽ dừng ngay lập tức và ném lỗi `GradleException`.
- **Cố định theo build (không chỉnh sửa qua UI)**: URL backend được gắn trực tiếp vào `BuildConfig.BACKEND_URL` lúc biên dịch và không lưu đè qua SharedPreferences. Màn hình Cài đặt chỉ hiển thị địa chỉ Backend hiện tại dạng read-only trong mục *Tài khoản*.
- **Tự động ánh xạ trên Android Emulator (Debug mode)**: Trên Android Emulator, `localhost` (127.0.0.1) là chính thiết bị Android ảo. Ở chế độ Debug, ứng dụng tự động ánh xạ `localhost` hoặc `127.0.0.1` sang `10.0.2.2` để kết nối thẳng tới backend chạy trên máy host. Do đó bạn có thể để nguyên `http://localhost:3000` trong `.env`.
- **Android TV thật qua LAN**: Khi test trên TV thật qua Wi-Fi/LAN, cấu hình địa chỉ IP máy host: `FRAMEZOO_TV_BACKEND_URL=http://<IP_LAN_CUA_MAY_HOST>:3000`.
- **Bản Release**: Bắt buộc phải sử dụng URL HTTPS (ví dụ: `https://api.framezoo.top`).

Có thể ghi đè URL khi build:

```sh
FRAMEZOO_TV_BACKEND_URL=https://api.example.com ./gradlew assembleDebug
./gradlew assembleDebug -PframezooTvBackendUrl=https://api.example.com
```

## Build và Cài đặt

Yêu cầu Android SDK 36, Build Tools 36, NDK 27.1.12297006, JDK 17–21, CMake, Ninja, Meson, pkg-config, GNU sed/coreutils và wget. Trên macOS: `brew install meson ninja pkgconf wget gnu-sed coreutils`.

### 1. Biên dịch APK

```sh
cd framezoo-tv

# Build APK Debug (arm64-v8a cho thiết bị TV thật hoặc máy ảo arm64):
./gradlew assembleDebug

# Build APK Debug cho Android Emulator x86_64:
./gradlew assembleDebug -PtvAbi=x86_64

# Chạy Unit Tests:
./gradlew testDebugUnitTest
```

Mở thư mục `framezoo-tv` trong Android Studio. Gradle tự chạy `native/build-native.sh` khi thiếu native artifacts, tạo `.so` trong `app/src/main/jniLibs`; lần đầu cần thời gian để biên dịch. APK release chỉ `arm64-v8a`.

### 2. Cài đặt APK vào thiết bị / Emulator

> [!IMPORTANT]
> Lệnh `adb shell am start` chỉ khởi chạy ứng dụng đã cài đặt trên máy. Khi sửa code hoặc thay đổi `.env`, bạn **bắt buộc phải cài đặt lại APK mới** trước khi mở app:

```sh
# Cách 1: Dùng Gradle tự động cài đè bản Debug vào thiết bị đang kết nối:
./gradlew installDebug

# Cách 2: Dùng lệnh adb install trực tiếp file APK vừa build:
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### 3. Khởi chạy ứng dụng

```sh
# Dừng phiên bản cũ và khởi chạy MainActivity:
adb shell am force-stop com.framezoo.tv
adb shell am start -n com.framezoo.tv/.MainActivity
```

 Addon manifest do người dùng tự cài. Torrent chỉ giữ tối đa 128 MiB piece trong RAM; dừng phát giải phóng dữ liệu. Phát 4K/HDR cần kiểm trên TV thật và codec/display tương ứng.

Native RAM storage bắt đầu từ ví dụ `examples/custom_storage.cpp` của libtorrent (BSD license), sau đó thêm giới hạn RAM, xác minh piece và kết nối libmpv. Nguồn libtorrent 2.1.2, OpenSSL 3.4.2, Boost 1.86.0 được kiểm SHA-256 trong script. mpv-android build scripts khóa commit `3137f2e`; mpv khóa `v0.41.0`.
