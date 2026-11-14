#include "TorrentStream.h"

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cmath>
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
struct Player { bool emulator{false}; mpv_handle* mpv{nullptr}; jobject surface{nullptr}; std::shared_ptr<TorrentStream> torrent; std::mutex torrentMutex; std::atomic<bool> cancelled{false}; std::shared_ptr<std::atomic<bool>> extractCancelled{std::make_shared<std::atomic<bool>>(false)}; std::thread events; std::atomic<bool> eventsDone{false}; std::mutex loadMutex; std::condition_variable loadChanged; bool fileLoaded{false}; bool playbackReady{false}; bool fileFailed{false}; };

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
	mpv_set_option_string(result->mpv, "terminal", "no");
	mpv_set_option_string(result->mpv, "sub-fonts-dir", java_string(env, fontsDir).c_str());
	mpv_set_option_string(result->mpv, "sub-font", java_string(env, fontFamily).c_str());
	mpv_set_option_string(result->mpv, "vo", "gpu");
	// ponytail: emulator MediaCodec can claim success without producing frames; real TVs use hardware decode.
	mpv_set_option_string(result->mpv, "hwdec", emulator ? "no" : "mediacodec-copy");
	mpv_set_option_string(result->mpv, "gpu-context", "android");
	mpv_set_option_string(result->mpv, "opengl-es", "yes");
	// ponytail: use simpler GPU rendering on emulators; retry the default when their renderer is reliable.
	if (emulator) mpv_set_option_string(result->mpv, "gpu-dumb-mode", "yes");
	// Keep the emulator path in 8-bit and <=1920px, but use mpv's filters rather
	// than a libavfilter graph. libavfilter rejects the HDR metadata transition
	// emitted by Dolby Vision streams (`Changing video frame properties...`) and
	// can leave the Android surface black even though HEVC decoding continues.
	if (emulator) mpv_set_option_string(result->mpv, "vf", "scale=w='min(1920,iw)':h=-2:flags=fast_bilinear,format=yuv420p");
	mpv_set_option_string(result->mpv, "ao", "audiotrack,opensles");
	// Keep the stream's default audio track. Restricting `alang` to English
	// drops audio on French, Korean, and other single-language releases.
	mpv_set_option_string(result->mpv, "audio-buffer", emulator ? "0.40" : "0.08");
	mpv_set_option_string(result->mpv, "audio-channels", emulator ? "stereo" : "auto");
	mpv_set_option_string(result->mpv, "audio-normalize-downmix", "yes");
	mpv_set_option_string(result->mpv, "ad-lavc-downmix", emulator ? "yes" : "no");
	mpv_set_option_string(result->mpv, "ad-lavc-ac3drc", "1");
	mpv_set_option_string(result->mpv, "vd-lavc-threads", "0");
	mpv_set_option_string(result->mpv, "vd-lavc-dr", "yes");
	mpv_set_option_string(result->mpv, "vd-lavc-check-hw-profile", "yes");
	// Emulator audio output can underrun while software HEVC catches up. Keep
	// video tied to the display clock there so a missing audio packet cannot
	// stall decoded frames; physical TVs retain audio-clock sync.
	mpv_set_option_string(result->mpv, "video-sync", emulator ? "display-resample" : "audio");
	mpv_set_option_string(result->mpv, "framedrop", "vo");
	mpv_set_option_string(result->mpv, "hr-seek", "yes");
	mpv_set_option_string(result->mpv, "hr-seek-framedrop", "yes");
	mpv_set_option_string(result->mpv, "vd-lavc-show-all", "no");
	mpv_set_option_string(result->mpv, "vd-lavc-fast", "no");
	mpv_set_option_string(result->mpv, "force-seekable", "yes");
	mpv_set_option_string(result->mpv, "network-timeout", "120");
	mpv_set_option_string(result->mpv, "stream-lavf-o", "reconnect=1,reconnect_streamed=1,reconnect_delay_max=5");
	mpv_set_option_string(result->mpv, "demuxer-lavf-buffersize", "131072");
	mpv_set_option_string(result->mpv, "cache", "yes");
	mpv_set_option_string(result->mpv, "cache-pause", "yes");
	mpv_set_option_string(result->mpv, "cache-pause-initial", emulator ? "yes" : "no");
	mpv_set_option_string(result->mpv, "cache-pause-wait", emulator ? "8" : "0.5");
	mpv_set_option_string(result->mpv, "cache-secs", emulator ? "20" : "120");
	mpv_set_option_string(result->mpv, "demuxer-readahead-secs", emulator ? "30" : "90");
	mpv_set_option_string(result->mpv, "demuxer-max-bytes", emulator ? "96MiB" : "768MiB");
	mpv_set_option_string(result->mpv, "demuxer-max-back-bytes", emulator ? "24MiB" : "128MiB");
	mpv_set_option_string(result->mpv, "demuxer-hysteresis-secs", "10");
	mpv_set_option_string(result->mpv, "demuxer-seekable-cache", "yes");
	mpv_set_option_string(result->mpv, "stream-buffer-size", emulator ? "16MiB" : "32MiB");
	mpv_set_option_string(result->mpv, "demuxer-lavf-analyzeduration", "0.5");
	mpv_set_option_string(result->mpv, "demuxer-lavf-probesize", "1048576");
	mpv_set_option_string(result->mpv, "sub-pos", "68"); // subtitles stay above the persistent TV controls
	mpv_set_option_string(result->mpv, "keep-open", "yes");
	mpv_set_option_string(result->mpv, "idle", "yes");
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
				// A source can emit FILE_LOADED and still fail before the first
				// playback restart. Wake waitLoaded immediately so the UI can return
				// to the source picker instead of waiting for its full timeout.
				{ std::lock_guard<std::mutex> lock(p->loadMutex); if (!p->playbackReady) p->fileFailed = true; }
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
	mpv_set_property_string(ptr->mpv, "hr-seek-framedrop", "yes");
	std::string source = java_string(env, url);
	char const* command[] = {"loadfile", source.c_str(), nullptr};
	return java_error(env, mpv_command(ptr->mpv, command) < 0 ? "Không mở được nguồn HTTP" : "");
}
extern "C" JNIEXPORT jstring JNICALL Java_com_framezoo_tv_player_NativePlayer_playTorrent(JNIEnv* env, jobject, jlong value, jstring magnet, jint fileIdx) {
	auto* ptr = player(value); if (!ptr) return java_error(env, "libmpv chưa khởi tạo");
	{
		std::lock_guard<std::mutex> lock(ptr->torrentMutex);
		ptr->torrent = std::make_shared<TorrentStream>();
		if (ptr->cancelled) ptr->torrent->cancel_start();
	}
	std::string error = ptr->torrent->start(java_string(env, magnet), fileIdx);
	if (!error.empty()) return java_error(env, error);
	if (ptr->cancelled) return java_error(env, "Đã dừng torrent");
	mpv_set_property_string(ptr->mpv, "hr-seek-framedrop", "no");
	char const* command[] = {"loadfile", "framezoo://video.mkv", nullptr};
	char const* emulatorCommand[] = {"loadfile", "framezoo://video.mkv", "replace", "-1",
		"cache=yes,cache-secs=20,cache-pause-wait=8,cache-pause-initial=yes,demuxer-max-bytes=96MiB,demuxer-max-back-bytes=24MiB", nullptr};
	int status = mpv_command(ptr->mpv, ptr->emulator ? emulatorCommand : command);
	return java_error(env, status < 0 ? "Không mở được luồng torrent" : "");
}

namespace {
struct ExtractSource {
	std::shared_ptr<TorrentStream> torrent;
	std::shared_ptr<std::atomic<bool>> cancelled;
};
struct ExtractCookie {
	std::shared_ptr<TorrentStream> torrent;
	std::shared_ptr<std::atomic<bool>> cancelled;
	std::atomic<bool> localCancel{false};
	std::int64_t offset{0};
};
int64_t extract_read_fn(void* raw, char* buf, uint64_t nbytes) {
	auto* c = static_cast<ExtractCookie*>(raw);
	if (!c || !c->torrent || c->localCancel || (c->cancelled && *c->cancelled)) return -1;
	std::int64_t got = c->torrent->read(c->offset, buf, nbytes, c->cancelled ? c->cancelled.get() : nullptr);
	if (got > 0) c->offset += got;
	return got;
}
int64_t extract_seek_fn(void* raw, int64_t offset) {
	auto* c = static_cast<ExtractCookie*>(raw);
	if (!c || !c->torrent || c->localCancel || (c->cancelled && *c->cancelled)) return MPV_ERROR_GENERIC;
	std::int64_t size = c->torrent->size();
	if (offset < 0 || offset > size) return MPV_ERROR_GENERIC;
	c->offset = offset;
	c->torrent->seek(offset);
	return offset;
}
int64_t extract_size_fn(void* raw) {
	auto* c = static_cast<ExtractCookie*>(raw);
	return (c && c->torrent) ? c->torrent->size() : MPV_ERROR_UNSUPPORTED;
}
void extract_close_fn(void* raw) { delete static_cast<ExtractCookie*>(raw); }
void extract_cancel_fn(void* raw) { if (auto* c = static_cast<ExtractCookie*>(raw)) c->localCancel = true; }
int extract_open_ro(void* user_data, char*, mpv_stream_cb_info* info) {
	auto* src = static_cast<ExtractSource*>(user_data);
	if (!src || !src->torrent || (src->cancelled && *src->cancelled)) return MPV_ERROR_LOADING_FAILED;
	auto* c = new ExtractCookie{src->torrent, src->cancelled, false, 0};
	info->cookie = c;
	info->read_fn = extract_read_fn;
	info->seek_fn = extract_seek_fn;
	info->size_fn = extract_size_fn;
	info->close_fn = extract_close_fn;
	info->cancel_fn = extract_cancel_fn;
	return 0;
}
} // namespace

extern "C" JNIEXPORT jint JNICALL Java_com_framezoo_tv_player_NativePlayer_setAudioMode(JNIEnv* env, jobject, jlong value, jstring mode) {
	auto* ptr = player(value); if (!ptr || !ptr->mpv) return -1;
	std::string m = mode ? java_string(env, mode) : "auto";
	int s1 = 0, s2 = 0, s3 = 0;
	if (m == "stereo-dialogue") {
		s1 = mpv_set_property_string(ptr->mpv, "audio-spdif", "");
		s2 = mpv_set_property_string(ptr->mpv, "audio-channels", "stereo");
		s3 = mpv_set_property_string(ptr->mpv, "af", "lavfi=[dynaudnorm=f=250:g=31:p=0.5]");
	} else if (m == "passthrough") {
		s1 = mpv_set_property_string(ptr->mpv, "af", "");
		s2 = mpv_set_property_string(ptr->mpv, "audio-channels", "auto");
		s3 = mpv_set_property_string(ptr->mpv, "audio-spdif", "ac3,eac3,dts,dts-hd,truehd");
	} else {
		s1 = mpv_set_property_string(ptr->mpv, "audio-spdif", "");
		s2 = mpv_set_property_string(ptr->mpv, "af", "");
		s3 = mpv_set_property_string(ptr->mpv, "audio-channels", ptr->emulator ? "stereo" : "auto");
	}
	return (s1 < 0 || s2 < 0 || s3 < 0) ? -1 : 0;
}
extern "C" JNIEXPORT void JNICALL Java_com_framezoo_tv_player_NativePlayer_cancelExtractAudio(JNIEnv*, jobject, jlong value) {
	if (auto* ptr = player(value)) {
		if (ptr->extractCancelled) ptr->extractCancelled->store(true);
	}
}
extern "C" JNIEXPORT jstring JNICALL Java_com_framezoo_tv_player_NativePlayer_extractAudio(JNIEnv* env, jobject, jlong value, jstring url, jobjectArray headers, jdouble startAtSec, jdouble durationSec, jstring outputPath, jstring audioTrackId) {
	auto* ptr = player(value);
	std::string src = url ? java_string(env, url) : "";
	std::string out = outputPath ? java_string(env, outputPath) : "";
	std::string aid = audioTrackId ? java_string(env, audioTrackId) : "";
	if (src.empty() || out.empty() || durationSec <= 0) return java_error(env, "Tham số tách âm thanh không hợp lệ");
	std::string joined;
	if (headers) {
		for (jsize i = 0; i < env->GetArrayLength(headers); ++i) {
			if (i) joined += ",";
			joined += java_string(env, static_cast<jstring>(env->GetObjectArrayElement(headers, i)));
		}
	}
	std::shared_ptr<std::atomic<bool>> cancelFlag = ptr && ptr->extractCancelled ? ptr->extractCancelled : std::make_shared<std::atomic<bool>>(false);
	cancelFlag->store(false);
	bool useTorrent = src.rfind("framezoo://", 0) == 0;
	std::shared_ptr<TorrentStream> torrentCopy;
	if (useTorrent) {
		if (!ptr) return java_error(env, "libmpv chưa khởi tạo");
		std::lock_guard<std::mutex> lock(ptr->torrentMutex);
		torrentCopy = ptr->torrent;
		if (!torrentCopy) return java_error(env, "Không có luồng torrent");
	}
	mpv_handle* extract = mpv_create();
	if (!extract) return java_error(env, "Không tạo được phiên tách âm thanh");
	std::string startStr = std::to_string(std::max(0.0, double(startAtSec)));
	std::string durStr = std::to_string(double(durationSec));
	mpv_set_option_string(extract, "terminal", "no");
	mpv_set_option_string(extract, "vo", "null");
	mpv_set_option_string(extract, "vid", "no");
	mpv_set_option_string(extract, "sid", "no");
	mpv_set_option_string(extract, "ao", "pcm");
	mpv_set_option_string(extract, "ao-pcm-file", out.c_str());
	mpv_set_option_string(extract, "ao-pcm-waveheader", "yes");
	mpv_set_option_string(extract, "audio-format", "s16");
	mpv_set_option_string(extract, "audio-channels", "mono");
	mpv_set_option_string(extract, "audio-samplerate", "16000");
	mpv_set_option_string(extract, "hr-seek", "yes");
	mpv_set_option_string(extract, "start", startStr.c_str());
	mpv_set_option_string(extract, "length", durStr.c_str());
	mpv_set_option_string(extract, "pause", "yes");
	mpv_set_option_string(extract, "keep-open", "no");
	mpv_set_option_string(extract, "idle", "no");
	mpv_set_option_string(extract, "cache", "yes");
	mpv_set_option_string(extract, "force-seekable", "yes");
	mpv_set_option_string(extract, "network-timeout", "45");
	mpv_set_option_string(extract, "demuxer-max-bytes", "8388608");
	mpv_set_option_string(extract, "demuxer-max-back-bytes", "2097152");
	mpv_set_option_string(extract, "demuxer-readahead-secs", "12");
	if (!aid.empty() && aid != "auto" && aid != "no") {
		mpv_set_option_string(extract, "aid", aid.c_str());
	}
	if (!useTorrent) {
		mpv_set_option_string(extract, "stream-lavf-o", "reconnect=1,reconnect_streamed=1,reconnect_delay_max=5");
	}
	if (mpv_initialize(extract) < 0) {
		mpv_terminate_destroy(extract);
		return java_error(env, "Không khởi tạo được phiên tách âm thanh");
	}
	ExtractSource extractSrc{torrentCopy, cancelFlag};
	if (useTorrent) {
		mpv_stream_cb_add_ro(extract, "framezoo", &extractSrc, extract_open_ro);
	} else if (!joined.empty()) {
		mpv_set_property_string(extract, "http-header-fields", joined.c_str());
	}
	char const* targetUri = useTorrent ? "framezoo://video.mkv" : src.c_str();
	char const* loadCmd[] = {"loadfile", targetUri, "replace", nullptr};
	if (mpv_command(extract, loadCmd) < 0) {
		mpv_terminate_destroy(extract);
		return java_error(env, "Không nạp được nguồn để tách âm thanh");
	}
	bool started = false;
	bool completed = false;
	std::string errMsg;
	auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(90);
	while (std::chrono::steady_clock::now() < deadline) {
		if (cancelFlag->load()) {
			errMsg = "Đã hủy tách âm thanh";
			break;
		}
		mpv_event* ev = mpv_wait_event(extract, 0.25);
		if (!ev || ev->event_id == MPV_EVENT_NONE) continue;
		if (ev->event_id == MPV_EVENT_FILE_LOADED) {
			started = true;
			mpv_set_property_string(extract, "pause", "no");
		} else if (ev->event_id == MPV_EVENT_END_FILE) {
			auto* eof = static_cast<mpv_event_end_file*>(ev->data);
			if (started && eof && (eof->reason == MPV_END_FILE_REASON_EOF || eof->reason == MPV_END_FILE_REASON_STOP)) {
				completed = true;
			} else if (eof && eof->error < 0) {
				errMsg = mpv_error_string(eof->error);
			} else {
				errMsg = "Không đọc được âm thanh từ nguồn phát";
			}
			break;
		} else if (ev->event_id == MPV_EVENT_SHUTDOWN) {
			break;
		}
	}
	if (!completed && errMsg.empty()) {
		errMsg = "Hết thời gian tách âm thanh";
	}
	mpv_terminate_destroy(extract);
	if (!completed) {
		return java_error(env, errMsg);
	}
	return java_error(env, "");
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
    // `video-frame-info` exists as soon as the decoder is configured. Its
    // picture type stays `unavailable` until a frame is actually displayed.
    char* pictureType = mpv_get_property_string(ptr->mpv, "video-frame-info/picture-type");
    if (!pictureType) {
        __android_log_print(ANDROID_LOG_INFO, "FrameZooMPV", "video-frame-info/picture-type unavailable");
        return JNI_FALSE;
    }
    std::string type(pictureType);
    mpv_free(pictureType);
    if (type != "I" && type != "P" && type != "B") {
        __android_log_print(ANDROID_LOG_INFO, "FrameZooMPV", "video-frame-info/picture-type=%s", type.c_str());
    }
    if (type == "I" || type == "P" || type == "B") return JNI_TRUE;

    // Some Android emulator builds expose frame metadata without a picture
    // type. `frame-time` is populated only after a decoded frame is presented;
    // require valid video dimensions to avoid treating decoder setup as ready.
    double frameTime = 0.0;
    std::int64_t width = 0;
    std::int64_t height = 0;
    const int frameStatus = mpv_get_property(ptr->mpv, "video-frame-info/frame-time", MPV_FORMAT_DOUBLE, &frameTime);
    const int widthStatus = mpv_get_property(ptr->mpv, "video-params/w", MPV_FORMAT_INT64, &width);
    const int heightStatus = mpv_get_property(ptr->mpv, "video-params/h", MPV_FORMAT_INT64, &height);
    return frameStatus >= 0 && widthStatus >= 0 && heightStatus >= 0 &&
        std::isfinite(frameTime) && width > 0 && height > 0 ? JNI_TRUE : JNI_FALSE;
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
