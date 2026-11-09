#include "TorrentStream.h"

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>
#include <android/log.h>
#include <jni.h>
#include <mpv/client.h>
#include <mpv/stream_cb.h>
extern "C" {
#include <libavcodec/jni.h>
}

struct StreamCookie { TorrentStream* torrent; std::int64_t offset{0}; std::atomic<bool> cancelled{false}; };
struct Player { bool emulator{false}; mpv_handle* mpv{nullptr}; jobject surface{nullptr}; std::unique_ptr<TorrentStream> torrent; std::mutex torrentMutex; std::atomic<bool> cancelled{false}; std::thread events; std::atomic<bool> eventsDone{false}; std::mutex loadMutex; std::condition_variable loadChanged; bool fileLoaded{false}; bool playbackReady{false}; bool fileFailed{false}; };

static int open_stream(void* data, char*, mpv_stream_cb_info* info) {
	auto* player = static_cast<Player*>(data);
	if (!player->torrent) return MPV_ERROR_LOADING_FAILED;
	auto* cookie = new StreamCookie{player->torrent.get()};
	info->cookie = cookie;
	info->read_fn = [](void* c, char* buf, std::uint64_t n) -> std::int64_t {
		auto* stream = static_cast<StreamCookie*>(c);
		auto nread = stream->torrent->read(stream->offset, buf, n);
		if (nread > 0) stream->offset += nread;
		return nread;
	};
	info->seek_fn = [](void* c, std::int64_t pos) -> std::int64_t {
		auto* stream = static_cast<StreamCookie*>(c);
		if (pos < 0 || pos > stream->torrent->size()) return -1;
		stream->offset = pos; stream->torrent->seek(pos); return pos;
	};
	info->size_fn = [](void* c) -> std::int64_t { return static_cast<StreamCookie*>(c)->torrent->size(); };
	info->close_fn = [](void* c) { delete static_cast<StreamCookie*>(c); };
	info->cancel_fn = [](void* c) { static_cast<StreamCookie*>(c)->torrent->cancel(); };
	return 0;
}

static std::string java_string(JNIEnv* env, jstring value) {
	if (!value) return {};
	char const* chars = env->GetStringUTFChars(value, nullptr);
	std::string result(chars);
	env->ReleaseStringUTFChars(value, chars);
	return result;
}
static jstring java_error(JNIEnv* env, std::string const& error) { return error.empty() ? nullptr : env->NewStringUTF(error.c_str()); }
static Player* player(jlong value) { return reinterpret_cast<Player*>(value); }

extern "C" JNIEXPORT jlong JNICALL Java_com_framezoo_tv_player_NativePlayer_create(JNIEnv* env, jobject, jboolean emulator, jstring fontsDir, jstring fontFamily) {
	JavaVM* vm = nullptr;
	if (env->GetJavaVM(&vm) == JNI_OK) av_jni_set_java_vm(vm, nullptr);
	auto result = std::make_unique<Player>();
	result->emulator = emulator;
	result->mpv = mpv_create();
	if (!result->mpv) return 0;
	mpv_request_log_messages(result->mpv, "warn");
	mpv_set_option_string(result->mpv, "sub-fonts-dir", java_string(env, fontsDir).c_str());
	mpv_set_option_string(result->mpv, "sub-font", java_string(env, fontFamily).c_str());
	mpv_set_option_string(result->mpv, "vo", "gpu");
	// ponytail: emulator MediaCodec can claim success without producing frames; real TVs use hardware decode.
	mpv_set_option_string(result->mpv, "hwdec", emulator ? "no" : "mediacodec-copy");
	mpv_set_option_string(result->mpv, "gpu-context", "android");
	mpv_set_option_string(result->mpv, "opengl-es", "yes");
	// ponytail: use simpler GPU rendering on emulators; retry the default when their renderer is reliable.
	if (emulator) mpv_set_option_string(result->mpv, "gpu-dumb-mode", "yes");
	// ponytail: emulator frames are limited to 8-bit and 1920px wide; remove this when high-resolution playback is reliable.
	if (emulator) mpv_set_option_string(result->mpv, "vf", "lavfi=[scale=w='min(1920,iw)':h=-2,format=yuv420p]");
	mpv_set_option_string(result->mpv, "ao", "audiotrack,opensles");
	mpv_set_option_string(result->mpv, "sub-pos", "68"); // subtitles stay above the persistent TV controls
	mpv_set_option_string(result->mpv, "keep-open", "yes");
	int cb = mpv_stream_cb_add_ro(result->mpv, "framezoo", result.get(), open_stream);
	if (cb < 0) { mpv_destroy(result->mpv); return 0; }
	if (mpv_initialize(result->mpv) < 0) { mpv_destroy(result->mpv); return 0; }
	result->events = std::thread([p = result.get()] {
		while (!p->eventsDone) {
			mpv_event* event = mpv_wait_event(p->mpv, -1);
			if (event->event_id == MPV_EVENT_FILE_LOADED) {
				{ std::lock_guard<std::mutex> lock(p->loadMutex); p->fileLoaded = true; }
				p->loadChanged.notify_all();
			} else if (event->event_id == MPV_EVENT_PLAYBACK_RESTART) {
				{ std::lock_guard<std::mutex> lock(p->loadMutex); p->playbackReady = true; }
				p->loadChanged.notify_all();
			} else if (event->event_id == MPV_EVENT_LOG_MESSAGE) {
				auto* msg = static_cast<mpv_event_log_message*>(event->data);
				__android_log_print(ANDROID_LOG_INFO, "FrameZooMPV", "[%s] %s", msg->prefix, msg->text);
			} else if (event->event_id == MPV_EVENT_END_FILE) {
				auto* end = static_cast<mpv_event_end_file*>(event->data);
				__android_log_print(ANDROID_LOG_INFO, "FrameZooMPV", "end file: reason=%d error=%s", end->reason, mpv_error_string(end->error));
				{ std::lock_guard<std::mutex> lock(p->loadMutex); if (!p->fileLoaded) p->fileFailed = true; }
				p->loadChanged.notify_all();
			}
		}
	});
	return reinterpret_cast<jlong>(result.release());
}
extern "C" JNIEXPORT void JNICALL Java_com_framezoo_tv_player_NativePlayer_destroy(JNIEnv* env, jobject, jlong value) {
	auto ptr = std::unique_ptr<Player>(player(value));
	if (!ptr) return;
	ptr->eventsDone = true;
	mpv_wakeup(ptr->mpv);
	if (ptr->events.joinable()) ptr->events.join();
	if (ptr->mpv) mpv_terminate_destroy(ptr->mpv);
	ptr->torrent.reset();
	if (ptr->surface) env->DeleteGlobalRef(ptr->surface);
}
extern "C" JNIEXPORT void JNICALL Java_com_framezoo_tv_player_NativePlayer_cancel(JNIEnv*, jobject, jlong value) {
	auto* ptr = player(value); if (!ptr) return;
	ptr->cancelled = true;
	ptr->loadChanged.notify_all();
	std::lock_guard<std::mutex> lock(ptr->torrentMutex);
	if (ptr->torrent) ptr->torrent->cancel_start();
}
extern "C" JNIEXPORT void JNICALL Java_com_framezoo_tv_player_NativePlayer_attachSurface(JNIEnv* env, jobject, jlong value, jobject surface) {
	auto* ptr = player(value); if (!ptr) return;
	if (ptr->surface) env->DeleteGlobalRef(ptr->surface);
	ptr->surface = env->NewGlobalRef(surface);
	std::int64_t wid = reinterpret_cast<std::intptr_t>(ptr->surface);
	int status = mpv_set_option(ptr->mpv, "wid", MPV_FORMAT_INT64, &wid);
	if (status < 0) __android_log_print(ANDROID_LOG_ERROR, "FrameZooTV", "wid: %s", mpv_error_string(status));
	mpv_set_option_string(ptr->mpv, "force-window", "yes");
	mpv_set_property_string(ptr->mpv, "vo", "gpu");
}
extern "C" JNIEXPORT void JNICALL Java_com_framezoo_tv_player_NativePlayer_surfaceSize(JNIEnv*, jobject, jlong value, jint width, jint height) {
	auto* ptr = player(value); if (!ptr) return;
	std::string size = std::to_string(width) + "x" + std::to_string(height);
	mpv_set_property_string(ptr->mpv, "android-surface-size", size.c_str());
}
extern "C" JNIEXPORT void JNICALL Java_com_framezoo_tv_player_NativePlayer_detachSurface(JNIEnv* env, jobject, jlong value) {
	auto* ptr = player(value); if (!ptr || !ptr->surface) return;
	mpv_set_property_string(ptr->mpv, "vo", "null");
	mpv_set_property_string(ptr->mpv, "force-window", "no");
	std::int64_t wid = 0;
	mpv_set_option(ptr->mpv, "wid", MPV_FORMAT_INT64, &wid);
	env->DeleteGlobalRef(ptr->surface); ptr->surface = nullptr;
}
extern "C" JNIEXPORT jstring JNICALL Java_com_framezoo_tv_player_NativePlayer_playUrl(JNIEnv* env, jobject, jlong value, jstring url, jobjectArray headers) {
	auto* ptr = player(value); if (!ptr) return java_error(env, "libmpv chưa khởi tạo");
	std::string joined;
	for (jsize i = 0; i < env->GetArrayLength(headers); ++i) {
		if (i) joined += ",";
		joined += java_string(env, static_cast<jstring>(env->GetObjectArrayElement(headers, i)));
	}
	mpv_set_property_string(ptr->mpv, "http-header-fields", joined.c_str());
	std::string source = java_string(env, url);
	char const* command[] = {"loadfile", source.c_str(), nullptr};
	return java_error(env, mpv_command(ptr->mpv, command) < 0 ? "Không mở được nguồn HTTP" : "");
}
extern "C" JNIEXPORT jstring JNICALL Java_com_framezoo_tv_player_NativePlayer_playTorrent(JNIEnv* env, jobject, jlong value, jstring magnet, jint fileIdx) {
	auto* ptr = player(value); if (!ptr) return java_error(env, "libmpv chưa khởi tạo");
	{
		std::lock_guard<std::mutex> lock(ptr->torrentMutex);
		ptr->torrent = std::make_unique<TorrentStream>();
		if (ptr->cancelled) ptr->torrent->cancel_start();
	}
	std::string error = ptr->torrent->start(java_string(env, magnet), fileIdx);
	if (!error.empty()) return java_error(env, error);
	if (ptr->cancelled) return java_error(env, "Đã dừng torrent");
	// ponytail: emulator torrents need bounded read-ahead; tune when its network and decoder sustain 4K.
	char const* command[] = {"loadfile", "framezoo://video.mkv", nullptr};
	char const* emulatorCommand[] = {"loadfile", "framezoo://video.mkv", "replace", "-1",
		"cache=yes,cache-secs=20,cache-pause-wait=8,cache-pause-initial=yes,demuxer-max-bytes=64MiB,demuxer-max-back-bytes=16MiB", nullptr};
	int status = mpv_command(ptr->mpv, ptr->emulator ? emulatorCommand : command);
	return java_error(env, status < 0 ? "Không mở được luồng torrent" : "");
}
extern "C" JNIEXPORT jboolean JNICALL Java_com_framezoo_tv_player_NativePlayer_waitLoaded(JNIEnv*, jobject, jlong value, jint timeoutMs) {
	auto* ptr = player(value); if (!ptr) return false;
	std::unique_lock<std::mutex> lock(ptr->loadMutex);
	ptr->loadChanged.wait_for(lock, std::chrono::milliseconds(timeoutMs), [ptr] {
		return (ptr->fileLoaded && ptr->playbackReady) || ptr->fileFailed || ptr->cancelled;
	});
	return ptr->fileLoaded && ptr->playbackReady && !ptr->cancelled;
}
extern "C" JNIEXPORT jint JNICALL Java_com_framezoo_tv_player_NativePlayer_command(JNIEnv* env, jobject, jlong value, jobjectArray args) {
	auto* ptr = player(value); if (!ptr) return MPV_ERROR_INVALID_PARAMETER;
	std::vector<std::string> values;
	for (jsize i = 0; i < env->GetArrayLength(args); ++i) values.push_back(java_string(env, static_cast<jstring>(env->GetObjectArrayElement(args, i))));
	std::vector<char const*> command;
	for (auto const& arg : values) command.push_back(arg.c_str());
	command.push_back(nullptr);
	return mpv_command(ptr->mpv, command.data());
}
extern "C" JNIEXPORT jboolean JNICALL Java_com_framezoo_tv_player_NativePlayer_hasVideoFrame(JNIEnv*, jobject, jlong value) {
    auto* ptr = player(value); if (!ptr) return JNI_FALSE;
    mpv_node frame{};
    int status = mpv_get_property(ptr->mpv, "video-frame-info", MPV_FORMAT_NODE, &frame);
    if (status < 0) return JNI_FALSE;
    mpv_free_node_contents(&frame);
    return JNI_TRUE;
}
extern "C" JNIEXPORT jdouble JNICALL Java_com_framezoo_tv_player_NativePlayer_propertyDouble(JNIEnv* env, jobject, jlong value, jstring name) {
	auto* ptr = player(value); if (!ptr) return 0;
	double result = 0;
	mpv_get_property(ptr->mpv, java_string(env, name).c_str(), MPV_FORMAT_DOUBLE, &result);
	return result;
}
extern "C" JNIEXPORT jstring JNICALL Java_com_framezoo_tv_player_NativePlayer_propertyString(JNIEnv* env, jobject, jlong value, jstring name) {
	auto* ptr = player(value); if (!ptr) return nullptr;
	char* result = mpv_get_property_string(ptr->mpv, java_string(env, name).c_str());
	if (!result) return nullptr;
	auto output = env->NewStringUTF(result);
	mpv_free(result);
	return output;
}
extern "C" JNIEXPORT void JNICALL Java_com_framezoo_tv_player_NativePlayer_addTorrentPeer(JNIEnv* env, jobject, jlong value, jstring host, jint port) {
	auto* ptr = player(value); if (!ptr) return;
	std::lock_guard<std::mutex> lock(ptr->torrentMutex);
	if (ptr->torrent) ptr->torrent->add_peer(java_string(env, host), port);
}
extern "C" JNIEXPORT jstring JNICALL Java_com_framezoo_tv_player_NativePlayer_torrentStats(JNIEnv* env, jobject, jlong value) {
	auto* ptr = player(value); if (!ptr) return nullptr;
	std::lock_guard<std::mutex> lock(ptr->torrentMutex);
	if (!ptr->torrent) return nullptr;
	std::string stats = ptr->torrent->stats_json();
	return env->NewStringUTF(stats.c_str());
}
