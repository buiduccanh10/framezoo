#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$ROOT/native/.work"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
NDK="$SDK/ndk/27.1.12297006"
ABI="${ABI:-arm64-v8a}"
[[ "$ABI" == arm64-v8a || "$ABI" == x86_64 ]] || { echo "ABI không hỗ trợ: $ABI" >&2; exit 1; }
[[ -d "$NDK" ]] || { echo "Thiếu NDK 27.1.12297006: $NDK" >&2; exit 1; }
mkdir -p "$WORK/downloads" "$WORK/src" "$WORK/prefix/$ABI"

fetch() {
  local url="$1" dest="$2" expected="$3"
  [[ -f "$dest" ]] || curl -fL --retry 2 "$url" -o "$dest"
  local actual
  actual="$(shasum -a 256 "$dest" | cut -d ' ' -f 1)"
  [[ "$actual" == "$expected" ]] || { echo "SHA-256 sai: $dest" >&2; exit 1; }
}

pin_git() {
  local url="$1" revision="$2" dest="$3"
  if [[ ! -d "$dest/.git" ]]; then
    mkdir -p "$dest"
    git init -q "$dest"
    git -C "$dest" remote add origin "$url"
    git -C "$dest" fetch -q --depth 1 origin "$revision"
    git -C "$dest" checkout -q FETCH_HEAD
  fi
  [[ "$(git -C "$dest" rev-parse HEAD)" == "$revision" ]] || { echo "Revision sai: $dest" >&2; exit 1; }
}

unpack_dep() {
  local name="$1" url="$2" sha="$3" format="$4" scripts="$5"
  local dest="$scripts/deps/$name" archive="$WORK/downloads/$name.tar"
  fetch "$url" "$archive" "$sha"
  if [[ ! -d "$dest" ]]; then
    mkdir -p "$dest"
    tar -x"$format"f "$archive" -C "$dest" --strip-components=1
  fi
}

build_torrent() {
  local prefix="$WORK/prefix/$ABI"
  fetch 'https://github.com/arvidn/libtorrent/archive/refs/tags/v2.1.2.tar.gz' \
    "$WORK/downloads/libtorrent-2.1.2.tar.gz" '894760cc0a17ea9c678a582d62b027b62ba2514d77bd0a6e31f461444c0a6b32'
  fetch 'https://archives.boost.io/release/1.86.0/source/boost_1_86_0.tar.gz' \
    "$WORK/downloads/boost-1.86.0.tar.gz" '2575e74ffc3ef1cd0babac2c1ee8bdb5782a0ee672b1912da40e5b4b591ca01f'
  fetch 'https://github.com/openssl/openssl/releases/download/openssl-3.4.2/openssl-3.4.2.tar.gz' \
    "$WORK/downloads/openssl-3.4.2.tar.gz" '17b02459fc28be415470cccaae7434f3496cac1306b86b52c83886580e82834c'
  fetch 'https://github.com/arvidn/try_signal/archive/105cce59972f925a33aa6b1c3109e4cd3caf583d.tar.gz' \
    "$WORK/downloads/try-signal.tar.gz" '6f111b0d77429a8051be4faed06cf23fb03cf6ee233967c84fdd9d8d3b42ba8e'
  [[ -d "$WORK/src/libtorrent-2.1.2" ]] || tar -xzf "$WORK/downloads/libtorrent-2.1.2.tar.gz" -C "$WORK/src"
  [[ -d "$WORK/src/boost_1_86_0" ]] || tar -xzf "$WORK/downloads/boost-1.86.0.tar.gz" -C "$WORK/src"
  [[ -d "$WORK/src/openssl-3.4.2" ]] || tar -xzf "$WORK/downloads/openssl-3.4.2.tar.gz" -C "$WORK/src"
  if [[ ! -f "$WORK/src/libtorrent-2.1.2/deps/try_signal/try_signal.cpp" ]]; then
    tar -xzf "$WORK/downloads/try-signal.tar.gz" -C "$WORK/src/libtorrent-2.1.2/deps/try_signal" --strip-components=1
  fi

  if [[ ! -f "$prefix/lib/libssl.a" ]]; then
    local host target
    host="$(find "$NDK/toolchains/llvm/prebuilt" -maxdepth 1 -type d | tail -1)"
    target=android-arm64
    [[ "$ABI" == x86_64 ]] && target=android-x86_64
    (
      cd "$WORK/src/openssl-3.4.2"
      # The source tree is shared by both ABIs. Reusing generated objects
      # after switching ARM64 <-> x86_64 makes the linker consume the wrong
      # architecture from libcrypto.a.
      if [[ -f Makefile ]]; then
        make distclean >/dev/null 2>&1 || make clean >/dev/null 2>&1 || true
      fi
      export ANDROID_NDK_ROOT="$NDK" PATH="$host/bin:$PATH"
      perl Configure "$target" -D__ANDROID_API__=26 no-shared no-tests --prefix="$prefix"
      make -j"$(sysctl -n hw.ncpu)"
      make install_sw
    )
  fi

  cmake -S "$WORK/src/libtorrent-2.1.2" -B "$WORK/libtorrent-$ABI" -G Ninja \
    -DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" \
    -DANDROID_ABI="$ABI" -DANDROID_PLATFORM=android-26 \
    -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$prefix" \
    -DCMAKE_CXX_STANDARD=17 -DBUILD_SHARED_LIBS=OFF \
    -DBoost_NO_BOOST_CMAKE=ON -DBOOST_ROOT="$WORK/src/boost_1_86_0" \
    -DBoost_INCLUDE_DIR="$WORK/src/boost_1_86_0" -DOPENSSL_ROOT_DIR="$prefix" \
    -DOPENSSL_INCLUDE_DIR="$prefix/include" -DOPENSSL_SSL_LIBRARY="$prefix/lib/libssl.a" \
    -DOPENSSL_CRYPTO_LIBRARY="$prefix/lib/libcrypto.a" \
    -Dbuild_tests=OFF -Dbuild_examples=OFF -Dbuild_tools=OFF -Dpython-bindings=OFF \
    -Ddeprecated-functions=OFF -Dlogging=OFF -Di2p=OFF -Dwebtorrent=OFF
  cmake --build "$WORK/libtorrent-$ABI" --parallel "$(sysctl -n hw.ncpu)"
  cmake --install "$WORK/libtorrent-$ABI"
}

build_mpv() {
  local source="$WORK/src/mpv-android" arch=arm64
  [[ "$ABI" == x86_64 ]] && arch=x86_64
  pin_git https://github.com/mpv-android/mpv-android.git 3137f2e377222307336fd6208262a1ea29fd707a "$source"
  local scripts="$source/buildscripts"
  gsed -i 's/v_ndk=r28b/v_ndk=r27c/; s/v_ndk_n=28.1.13356709/v_ndk_n=27.1.12297006/; s/v_sdk_platform=35/v_sdk_platform=36/; s/v_sdk_build_tools=35.0.0/v_sdk_build_tools=36.0.0/' "$scripts/include/depinfo.sh"
  gsed -i 's/--enable-{gpl,version3}/--enable-version3/' "$scripts/scripts/ffmpeg.sh"
  gsed -i 's/-Dlibmpv=true/-Dgpl=false -Dlibmpv=true/' "$scripts/scripts/mpv.sh"
  mkdir -p "$scripts/sdk" "$scripts/deps"
  ln -sfn "$NDK" "$scripts/sdk/android-ndk-r27c"
  ln -sfn "$SDK" "$scripts/sdk/android-sdk-mac"
  mkdir -p "$scripts/deps"
  pin_git https://github.com/videolan/dav1d.git 42b2b24fb8819f1ed3643aa9cf2a62f03868e3aa "$scripts/deps/dav1d"
  pin_git https://github.com/FFmpeg/FFmpeg.git e3a61e91030696348b56361bdf80ea358aef4a19 "$scripts/deps/ffmpeg"
  pin_git https://gitlab.freedesktop.org/freetype/freetype.git 42608f77f20749dd6ddc9e0536788eaad70ea4b5 "$scripts/deps/freetype2"
  pin_git https://github.com/libass/libass.git e46aedea0a0d17da4c4ef49d84b94a7994664ab5 "$scripts/deps/libass"
  pin_git https://github.com/haasn/libplacebo.git 1fd3c7bde7b943fe8985c893310b5269a09b46c5 "$scripts/deps/libplacebo"
  git -C "$scripts/deps/libplacebo" submodule update -q --init --recursive
  pin_git https://github.com/mpv-player/mpv.git 41f6a645068483470267271e1d09966ca3b9f413 "$scripts/deps/mpv"
  unpack_dep mbedtls 'https://github.com/Mbed-TLS/mbedtls/releases/download/mbedtls-3.6.3/mbedtls-3.6.3.tar.bz2' 64cd73842cdc05e101172f7b437c65e7312e476206e1dbfd644433d11bc56327 j "$scripts"
  unpack_dep fribidi 'https://github.com/fribidi/fribidi/releases/download/v1.0.16/fribidi-1.0.16.tar.xz' 1b1cde5b235d40479e91be2f0e88a309e3214c8ab470ec8a2744d82a5a9ea05c J "$scripts"
  unpack_dep harfbuzz 'https://github.com/harfbuzz/harfbuzz/releases/download/11.2.0/harfbuzz-11.2.0.tar.xz' 50f7d0a208367e606dbf6eecc5cfbecc01a47be6ee837ae7aff2787e24b09b45 J "$scripts"
  unpack_dep unibreak 'https://github.com/adah1972/libunibreak/releases/download/libunibreak_6_1/libunibreak-6.1.tar.gz' cc4de0099cf7ff05005ceabff4afed4c582a736abc38033e70fdac86335ce93f z "$scripts"
  unpack_dep lua 'https://www.lua.org/ftp/lua-5.2.4.tar.gz' b9e2e4aad6789b3b63a056d442f7b39f0ecfca3ae0f1fc0ae4e9614401b69f4b z "$scripts"
  cd "$scripts"
  ./buildall.sh --arch "$arch" mpv
  local output="$ROOT/app/src/main/jniLibs/$ABI"
  mkdir -p "$output"
  cp -L "$scripts/prefix/$arch/lib/"*.so "$output/"
  local triple=aarch64-linux-android
  [[ "$ABI" == x86_64 ]] && triple=x86_64-linux-android
  cp "$NDK/toolchains/llvm/prebuilt/darwin-x86_64/sysroot/usr/lib/$triple/libc++_shared.so" "$output/"
  mkdir -p "$WORK/prefix/$ABI/include/mpv"
  cp "$scripts/prefix/$arch/include/mpv/"*.h "$WORK/prefix/$ABI/include/mpv/"
}

case "${1:-all}" in
  torrent) build_torrent ;;
  mpv) build_mpv ;;
  all) build_torrent; build_mpv ;;
  *) echo 'Dùng: native/build-native.sh [torrent|mpv|all]' >&2; exit 1 ;;
esac
