#include <node_api.h>

#include <atomic>
#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <cstdio>
#include <cmath>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <unordered_map>
#include <utility>
#include <vector>

#include "mpv_dynamic.h"
#include "platform_surface.h"

namespace {

constexpr uint64_t MPV_RENDER_UPDATE_FRAME = 1ULL << 0;

struct NativeEvent {
  std::string player_id;
  int generation = 0;
  std::string type;
  std::string name;
  std::string message;
  std::string level;
  bool has_bool = false;
  bool bool_value = false;
  bool has_number = false;
  double number_value = 0;
  std::string string_value;
  mpv_node* node_value = nullptr;
};

std::string escape_json(const std::string& value) {
  std::string escaped;
  escaped.reserve(value.size() + 2);
  for (const char character : value) {
    switch (character) {
      case '"':
        escaped += "\\\"";
        break;
      case '\\':
        escaped += "\\\\";
        break;
      case '\n':
        escaped += "\\n";
        break;
      case '\r':
        escaped += "\\r";
        break;
      case '\t':
        escaped += "\\t";
        break;
      default:
        escaped += character;
        break;
    }
  }
  return escaped;
}

std::string node_to_json(const mpv_node* node) {
  if (!node) return "null";
  switch (node->format) {
    case MPV_FORMAT_STRING:
    case MPV_FORMAT_OSD_STRING:
      return "\"" + escape_json(node->string ? node->string : "") + "\"";
    case MPV_FORMAT_INT64:
      return std::to_string(node->int64);
    case MPV_FORMAT_DOUBLE:
      return std::to_string(node->double_);
    case MPV_FORMAT_FLAG:
      return node->flag ? "true" : "false";
    case MPV_FORMAT_NODE_ARRAY: {
      std::string result = "[";
      const auto* list = node->list;
      if (list) {
        for (int index = 0; index < list->num; index++) {
          if (index > 0) result += ",";
          result += node_to_json(&list->values[index]);
        }
      }
      return result + "]";
    }
    case MPV_FORMAT_NODE_MAP: {
      std::string result = "{";
      const auto* list = node->list;
      if (list) {
        for (int index = 0; index < list->num; index++) {
          if (index > 0) result += ",";
          result +=
              "\"" + escape_json(list->keys[index] ? list->keys[index] : "") +
              "\":";
          result += node_to_json(&list->values[index]);
        }
      }
      return result + "}";
    }
    default:
      return "null";
  }
}

struct MpvPlayer {
  std::string id;
  napi_env env = nullptr;
  napi_threadsafe_function callback = nullptr;
  MpvApi api;
  mpv_handle* handle = nullptr;
  mpv_render_context* render_context = nullptr;
  NativeSurface* surface = nullptr;
  std::atomic<bool> running{true};
  std::atomic<int> generation{0};
  std::mutex command_mutex;
  std::mutex render_mutex;
  std::thread event_thread;
  std::atomic<uint64_t> render_update_count{0};
  std::atomic<uint64_t> render_count{0};
  std::atomic<bool> video_frame_ready{false};
  std::atomic<double> pending_start_at{0};
  bool software_render = false;
  std::vector<uint8_t> sw_buffer;

  int command(const char* const* commands) {
    std::lock_guard<std::mutex> lock(command_mutex);
    return api.command(handle, commands);
  }

  void stop() {
    const bool wasRunning = running.exchange(false, std::memory_order_acq_rel);
    surface_disable_paint(surface);

    if (wasRunning && handle) {
      const char* command[] = {"quit", nullptr};
      this->command(command);
    }

    if (
        event_thread.joinable() &&
        event_thread.get_id() != std::this_thread::get_id()
    ) {
      event_thread.join();
    }
  }

  ~MpvPlayer() {
    stop();
    if (render_context) {
      api.render_context_free(render_context);
      render_context = nullptr;
    }
    if (handle) {
      api.terminate_destroy(handle);
      handle = nullptr;
    }
    surface_destroy(surface);
    surface = nullptr;
    if (callback) {
      napi_release_threadsafe_function(
          callback,
          napi_tsfn_abort
      );
      callback = nullptr;
    }
    api.unload();
  }

  void emit(NativeEvent* event) {
    if (!callback || !event) {
      delete event;
      return;
    }
    const napi_status status =
        napi_call_threadsafe_function(callback, event, napi_tsfn_nonblocking);
    if (status != napi_ok) delete event;
  }

  void emit_property_snapshot(
      const char* name,
      mpv_format format
  ) {
    if (!name || !handle) return;

    std::lock_guard<std::mutex> lock(command_mutex);
    auto* native_event = new NativeEvent();
    native_event->player_id = id;
    native_event->generation = generation.load();
    native_event->type = "property";
    native_event->name = name;

    if (format == MPV_FORMAT_DOUBLE) {
      double value = 0;
      if (api.get_property(handle, name, format, &value) < 0) {
        delete native_event;
        return;
      }
      native_event->has_number = true;
      native_event->number_value = value;
    } else if (format == MPV_FORMAT_FLAG) {
      int value = 0;
      if (api.get_property(handle, name, format, &value) < 0) {
        delete native_event;
        return;
      }
      native_event->has_bool = true;
      native_event->bool_value = value != 0;
    } else if (format == MPV_FORMAT_NODE) {
      mpv_node value{};
      if (api.get_property(handle, name, format, &value) < 0) {
        delete native_event;
        return;
      }
      native_event->string_value = node_to_json(&value);
      api.free_node_contents(&value);
    } else {
      delete native_event;
      return;
    }

    emit(native_event);
  }

  void emit_playback_property_snapshots() {
    emit_property_snapshot("duration", MPV_FORMAT_DOUBLE);
    emit_property_snapshot("time-pos", MPV_FORMAT_DOUBLE);
    emit_property_snapshot("audio-pts", MPV_FORMAT_DOUBLE);
    emit_property_snapshot(
        "demuxer-cache-duration",
        MPV_FORMAT_DOUBLE
    );
    emit_property_snapshot("pause", MPV_FORMAT_FLAG);
    emit_property_snapshot("volume", MPV_FORMAT_DOUBLE);
    emit_property_snapshot("speed", MPV_FORMAT_DOUBLE);
    emit_property_snapshot("seeking", MPV_FORMAT_FLAG);
    emit_property_snapshot("paused-for-cache", MPV_FORMAT_FLAG);
    emit_property_snapshot("track-list", MPV_FORMAT_NODE);
    emit_property_snapshot("video-params", MPV_FORMAT_NODE);
    emit_property_snapshot("video-out-params", MPV_FORMAT_NODE);
  }

  void render() {
    std::lock_guard<std::mutex> lock(render_mutex);
    if (
        !running.load(std::memory_order_acquire) ||
        !render_context ||
        !surface
    ) {
      return;
    }
    const uint64_t render_number = render_count.fetch_add(1) + 1;
#if defined(_WIN32)
    if (software_render) {
      render_software(render_number);
      return;
    }
#endif
    surface_make_current(surface);
    const uint64_t update_flags = api.render_context_update(render_context);
    const bool has_frame_update =
        (update_flags & MPV_RENDER_UPDATE_FRAME) != 0;
    if (!running.load(std::memory_order_acquire)) return;
    mpv_opengl_fbo fbo{};
    fbo.fbo = 0;
    fbo.w = surface_width(surface);
    fbo.h = surface_height(surface);

    int flip_y = 1;
    mpv_render_param params[] = {
        {MPV_RENDER_PARAM_OPENGL_FBO, &fbo},
        {MPV_RENDER_PARAM_FLIP_Y, &flip_y},
        {MPV_RENDER_PARAM_INVALID, nullptr},
    };
    const int result = api.render_context_render(render_context, params);
    if (result < 0) {
      std::fprintf(
          stderr,
          "[libmpv-native] render failed player=%s result=%d update_flags=%llu "
          "surface=%dx%d\n",
          id.c_str(),
          result,
          static_cast<unsigned long long>(update_flags),
          fbo.w,
          fbo.h
      );
    } else if (render_number <= 5 || render_number % 60 == 0) {
      std::fprintf(
          stderr,
          "[libmpv-native] render player=%s frame=%llu update_flags=%llu "
          "surface=%dx%d generation=%d\n",
          id.c_str(),
          static_cast<unsigned long long>(render_number),
          static_cast<unsigned long long>(update_flags),
          fbo.w,
          fbo.h,
          generation.load()
      );
    }
    surface_swap_buffers(surface);
    api.render_context_report_swap(render_context);

    if (
        result >= 0 &&
        has_frame_update &&
        !video_frame_ready.exchange(true, std::memory_order_acq_rel)
    ) {
      auto* native_event = new NativeEvent();
      native_event->player_id = id;
      native_event->generation = generation.load();
      native_event->type = "video-frame";
      emit(native_event);
    }
  }

#if defined(_WIN32)
  void render_software(uint64_t render_number) {
    const int width = surface_width(surface);
    const int height = surface_height(surface);
    if (width <= 0 || height <= 0) return;

    size_t stride = static_cast<size_t>(width) * 4;
    const size_t needed = stride * static_cast<size_t>(height);
    if (sw_buffer.size() < needed) {
      sw_buffer.assign(needed, 0);
    }

    const uint64_t update_flags = api.render_context_update(render_context);
    const bool has_frame_update =
        (update_flags & MPV_RENDER_UPDATE_FRAME) != 0;
    if (!running.load(std::memory_order_acquire)) return;

    int size[2] = {width, height};
    mpv_render_param params[] = {
        {MPV_RENDER_PARAM_SW_SIZE, size},
        {MPV_RENDER_PARAM_SW_FORMAT, const_cast<char*>("rgb0")},
        {MPV_RENDER_PARAM_SW_STRIDE, &stride},
        {MPV_RENDER_PARAM_SW_POINTER, sw_buffer.data()},
        {MPV_RENDER_PARAM_INVALID, nullptr},
    };
    const int result = api.render_context_render(render_context, params);
    if (result >= 0) {
      surface_blit_rgb0(surface, sw_buffer.data(), stride);
    }
    if (result < 0) {
      std::fprintf(
          stderr,
          "[libmpv-native] software render failed player=%s result=%d "
          "update_flags=%llu surface=%dx%d\n",
          id.c_str(),
          result,
          static_cast<unsigned long long>(update_flags),
          width,
          height
      );
    } else if (render_number <= 5 || render_number % 60 == 0) {
      std::fprintf(
          stderr,
          "[libmpv-native] software render player=%s frame=%llu "
          "update_flags=%llu surface=%dx%d generation=%d\n",
          id.c_str(),
          static_cast<unsigned long long>(render_number),
          static_cast<unsigned long long>(update_flags),
          width,
          height,
          generation.load()
      );
    }
    if (
        result >= 0 &&
        has_frame_update &&
        !video_frame_ready.exchange(true, std::memory_order_acq_rel)
    ) {
      auto* native_event = new NativeEvent();
      native_event->player_id = id;
      native_event->generation = generation.load();
      native_event->type = "video-frame";
      emit(native_event);
    }
  }
#endif

  void event_loop() {
    while (running) {
      mpv_event* event = api.wait_event(handle, 0.1);
      if (!event || event->event_id == MPV_EVENT_NONE) continue;
      if (!running.load(std::memory_order_acquire)) break;

      if (event->event_id == MPV_EVENT_SHUTDOWN) break;

      auto* native_event = new NativeEvent();
      native_event->player_id = id;
      native_event->generation = generation.load();

      switch (event->event_id) {
        case MPV_EVENT_FILE_LOADED:
          native_event->type = "file-loaded";
          emit(native_event);
          emit_playback_property_snapshots();
          {
            const double start_at =
                pending_start_at.exchange(0, std::memory_order_acq_rel);
            if (start_at > 0) {
              const std::string start_value = std::to_string(start_at);
              const char* seek_command[] = {
                  "seek",
                  start_value.c_str(),
                  "absolute",
                  nullptr,
              };
              if (command(seek_command) < 0) {
                std::fprintf(
                    stderr,
                    "[libmpv-native] initial seek failed after file-loaded "
                    "start=%.3f\n",
                    start_at
                );
              }
            }
          }
          break;
        case MPV_EVENT_VIDEO_RECONFIG:
          native_event->type = "video-reconfig";
          emit(native_event);
          emit_playback_property_snapshots();
#if defined(_WIN32)
          // Windows renders through the native HWND instead of the custom
          // render callback used by macOS. Use reconfig as its closest
          // available first-frame signal.
          if (!video_frame_ready.exchange(true, std::memory_order_acq_rel)) {
            auto* frame_event = new NativeEvent();
            frame_event->player_id = id;
            frame_event->generation = generation.load();
            frame_event->type = "video-frame";
            emit(frame_event);
          }
#endif
          break;
        case MPV_EVENT_END_FILE: {
          auto* end_file =
              static_cast<mpv_event_end_file*>(event->data);
          if (end_file && end_file->error < 0) {
            native_event->type = "error";
            native_event->name = "end-file";
            native_event->message =
                "libmpv end-file error " + std::to_string(end_file->error);
          } else {
            native_event->type = "end-file";
          }
          emit(native_event);
          break;
        }
        case MPV_EVENT_LOG_MESSAGE: {
          native_event->type = "log";
          auto* log =
              static_cast<mpv_event_log_message*>(event->data);
          if (log) {
            native_event->level = log->level ? log->level : "info";
            native_event->message = log->text ? log->text : "";
          }
          emit(native_event);
          break;
        }
        case MPV_EVENT_PROPERTY_CHANGE: {
          auto* property =
              static_cast<mpv_event_property*>(event->data);
          native_event->type = "property";
          if (property && property->name) {
            native_event->name = property->name;
          }
          if (property && property->data) {
            switch (property->format) {
              case MPV_FORMAT_FLAG:
                native_event->has_bool = true;
                native_event->bool_value =
                    *static_cast<int*>(property->data) != 0;
                break;
              case MPV_FORMAT_INT64:
                native_event->has_number = true;
                native_event->number_value =
                    static_cast<double>(
                        *static_cast<int64_t*>(property->data)
                    );
                break;
              case MPV_FORMAT_DOUBLE:
                native_event->has_number = true;
                native_event->number_value =
                    *static_cast<double*>(property->data);
                break;
              case MPV_FORMAT_STRING:
              case MPV_FORMAT_OSD_STRING:
                native_event->string_value =
                    static_cast<const char*>(property->data);
                break;
              case MPV_FORMAT_NODE:
                native_event->string_value = node_to_json(
                    static_cast<mpv_node*>(property->data)
                );
                break;
              default:
                break;
            }
          }
          if (
              property &&
              property->data &&
              property->name &&
              (std::string(property->name) == "video-params" ||
               std::string(property->name) == "video-out-params")
          ) {
            surface_request_paint(surface);
          }
          const bool is_diagnostic_property =
              property && property->name &&
              (std::string(property->name) == "duration" ||
               std::string(property->name) == "pause" ||
               std::string(property->name) == "volume" ||
               std::string(property->name) == "speed" ||
               std::string(property->name) == "seeking" ||
               std::string(property->name) == "paused-for-cache" ||
               std::string(property->name) == "video-params" ||
               std::string(property->name) == "video-out-params" ||
               std::string(property->name) == "track-list");
          if (is_diagnostic_property) {
            std::fprintf(
                stderr,
                "[libmpv-native] property name=%s format=%d has_data=%d\n",
                property->name,
                property->format,
                property->data ? 1 : 0
            );
          }
          emit(native_event);
          break;
        }
        default:
          delete native_event;
          break;
      }
    }
  }
};

std::mutex players_mutex;
std::unordered_map<std::string, std::shared_ptr<MpvPlayer>> players;
std::atomic<uint64_t> next_player_id{1};
std::mutex audio_requests_mutex;
std::unordered_map<std::string, std::shared_ptr<std::atomic<bool>>>
    audio_request_cancellations;

void render_update_callback(void* user) {
  auto* player = static_cast<MpvPlayer*>(user);
  if (!player || !player->running.load(std::memory_order_acquire)) return;
  const uint64_t update_number = player->render_update_count.fetch_add(1) + 1;
  if (update_number <= 5 || update_number % 60 == 0) {
    std::fprintf(
        stderr,
        "[libmpv-native] render_update player=%s count=%llu generation=%d\n",
        player->id.c_str(),
        static_cast<unsigned long long>(update_number),
        player->generation.load()
    );
  }
  if (player->surface) surface_request_paint(player->surface);
}

void paint_callback(void* user, NativeSurface*) {
  auto* player = static_cast<MpvPlayer*>(user);
  if (player && player->running.load(std::memory_order_acquire)) {
    player->render();
  }
}

bool get_named(napi_env env, napi_value object, const char* name, napi_value* out) {
  return napi_get_named_property(env, object, name, out) == napi_ok;
}

bool get_value_string(napi_env env, napi_value value, std::string* out) {
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok) {
    return false;
  }
  std::string result(length + 1, '\0');
  if (napi_get_value_string_utf8(
          env, value, result.data(), length + 1, &length
      ) != napi_ok) {
    return false;
  }
  result.resize(length);
  *out = result;
  return true;
}

bool get_string(napi_env env, napi_value object, const char* name, std::string* out) {
  napi_value value;
  return get_named(env, object, name, &value) &&
      get_value_string(env, value, out);
}

bool get_number(napi_env env, napi_value object, const char* name, double* out) {
  napi_value value;
  if (!get_named(env, object, name, &value)) return false;
  return napi_get_value_double(env, value, out) == napi_ok;
}

bool get_bool(napi_env env, napi_value object, const char* name, bool* out) {
  napi_value value;
  if (!get_named(env, object, name, &value)) return false;
  return napi_get_value_bool(env, value, out) == napi_ok;
}

SurfaceBounds get_bounds(napi_env env, napi_value object) {
  double x = 0;
  double y = 0;
  double width = 1;
  double height = 1;
  get_number(env, object, "x", &x);
  get_number(env, object, "y", &y);
  get_number(env, object, "width", &width);
  get_number(env, object, "height", &height);
  return {
      static_cast<int>(x),
      static_cast<int>(y),
      std::max(1, static_cast<int>(width)),
      std::max(1, static_cast<int>(height)),
  };
}

std::shared_ptr<MpvPlayer> find_player(const std::string& id) {
  std::lock_guard<std::mutex> lock(players_mutex);
  auto found = players.find(id);
  return found == players.end() ? nullptr : found->second;
}

napi_value throw_error(napi_env env, const std::string& message) {
  napi_throw_error(env, nullptr, message.c_str());
  return nullptr;
}

int set_mpv_property(
    MpvPlayer* player,
    const char* property,
    const char* value
) {
  const char* command[] = {"set", property, value, nullptr};
  return player->command(command);
}

void set_mpv_option(MpvPlayer* player, const char* option, const char* value) {
  const int result =
      player->api.set_option_string(player->handle, option, value);
  if (result < 0) {
    std::fprintf(
        stderr,
        "[libmpv-native] option failed option=%s result=%d\n",
        option,
        result
    );
  }
}

std::string get_headers(napi_env env, napi_value request);

struct AudioExtractionRequest {
  napi_env env = nullptr;
  napi_async_work work = nullptr;
  napi_deferred deferred = nullptr;
  std::string url;
  std::string output_path;
  std::string headers;
  std::string request_id;
  std::shared_ptr<std::atomic<bool>> cancelled =
      std::make_shared<std::atomic<bool>>(false);
  double start_at = 0;
  double duration = 0;
  std::string error;
  bool succeeded = false;
};

bool wait_for_audio_file(
    AudioExtractionRequest* request,
    MpvApi* api,
    mpv_handle* handle
) {
  const double target_time = request->start_at + request->duration;
  bool file_loaded = false;
  bool stop_requested = false;
  auto capture_started_at = std::chrono::steady_clock::now();
  auto started_at = std::chrono::steady_clock::now();
  const auto timeout = std::chrono::seconds(
      static_cast<int>(std::ceil(request->duration)) + 120
  );

  while (true) {
    if (request->cancelled->load(std::memory_order_acquire)) {
      request->error = "libmpv audio extraction cancelled";
      if (handle) {
        const char* quit_command[] = {"quit", nullptr};
        api->command(handle, quit_command);
      }
      return false;
    }
    if (
        std::chrono::steady_clock::now() - started_at > timeout
    ) {
      request->error = "libmpv audio extraction timed out";
      return false;
    }

    mpv_event* event = api->wait_event(handle, 0.1);
    if (!event) continue;
    if (event->event_id == MPV_EVENT_SHUTDOWN) {
      request->error = "libmpv audio extraction shut down";
      return false;
    }
    if (event->event_id == MPV_EVENT_FILE_LOADED) {
      file_loaded = true;
      const char* play_command[] = {"set", "pause", "no", nullptr};
      if (api->command(handle, play_command) < 0) {
        request->error = "libmpv audio extraction playback failed";
        return false;
      }
      capture_started_at = std::chrono::steady_clock::now();
      continue;
    }
    if (event->event_id == MPV_EVENT_END_FILE) {
      auto* end_file = static_cast<mpv_event_end_file*>(event->data);
      if (end_file && end_file->error < 0) {
        request->error =
            "libmpv audio extraction ended with error " +
            std::to_string(end_file->error);
        return false;
      }
      return file_loaded;
    }

    if (!file_loaded) continue;

    double current_time = 0;
    const bool has_current_time =
        api->get_property(
            handle,
            "time-pos",
            MPV_FORMAT_DOUBLE,
            &current_time
        ) >= 0 &&
        std::isfinite(current_time);

    const auto capture_elapsed =
        std::chrono::steady_clock::now() - capture_started_at;
    const bool reached_target =
        has_current_time && current_time >= target_time;
    const bool exceeded_duration =
        capture_elapsed >=
        std::chrono::duration<double>(request->duration + 3.0);
    if (reached_target || exceeded_duration) {
      if (!stop_requested) {
        const char* pause_command[] = {"set", "pause", "yes", nullptr};
        api->command(handle, pause_command);
        const char* stop_command[] = {"stop", nullptr};
        if (api->command(handle, stop_command) < 0) {
          request->error = "libmpv audio extraction stop failed";
          return false;
        }
        stop_requested = true;
      }
    }
  }
}

void run_audio_extraction(AudioExtractionRequest* request) {
  MpvApi api;
  std::string load_error;
  if (!api.load(&load_error)) {
    request->error = load_error;
    return;
  }

  mpv_handle* handle = api.create();
  if (!handle) {
    request->error = "mpv_create failed for audio extraction";
    api.unload();
    return;
  }

  auto cleanup = [&]() {
    api.terminate_destroy(handle);
    api.unload();
    handle = nullptr;
  };

  const std::string start_value = std::to_string(request->start_at);
  const std::string length_value = std::to_string(request->duration);
  const auto set_option = [&](const char* name, const char* value) {
    return api.set_option_string(handle, name, value) >= 0;
  };
  if (
      !set_option("terminal", "no") ||
      !set_option("vo", "null") ||
      !set_option("vid", "no") ||
      !set_option("ao", "pcm") ||
      !set_option("ao-pcm-file", request->output_path.c_str()) ||
      !set_option("ao-pcm-waveheader", "yes") ||
      !set_option("audio-format", "s16") ||
      !set_option("audio-channels", "mono") ||
      !set_option("audio-samplerate", "16000") ||
      !set_option("start", start_value.c_str()) ||
      !set_option("length", length_value.c_str()) ||
      !set_option("pause", "yes") ||
      !set_option("keep-open", "no") ||
      !set_option("idle", "no") ||
      !set_option("cache", "yes") ||
      !set_option("force-seekable", "yes")
  ) {
    request->error = "libmpv audio extraction option failed";
    cleanup();
    return;
  }

  if (api.initialize(handle) < 0) {
    request->error = "mpv_initialize failed for audio extraction";
    cleanup();
    return;
  }

  if (!request->headers.empty()) {
    const char* header_command[] = {
        "set",
        "http-header-fields",
        request->headers.c_str(),
        nullptr,
    };
    if (api.command(handle, header_command) < 0) {
      request->error = "libmpv audio extraction header configuration failed";
      cleanup();
      return;
    }
  }

  const char* load_command[] = {
      "loadfile",
      request->url.c_str(),
      "replace",
      nullptr,
  };
  if (api.command(handle, load_command) < 0) {
    request->error = "libmpv audio extraction load failed";
    cleanup();
    return;
  }

  const bool completed = wait_for_audio_file(request, &api, handle);
  cleanup();
  if (!completed) {
    std::remove(request->output_path.c_str());
    return;
  }

  request->succeeded = true;
}

void execute_audio_extraction(napi_env, void* data) {
  run_audio_extraction(static_cast<AudioExtractionRequest*>(data));
}

void complete_audio_extraction(
    napi_env env,
    napi_status status,
    void* data
) {
  auto* request = static_cast<AudioExtractionRequest*>(data);
  if (!request->request_id.empty()) {
    std::lock_guard<std::mutex> lock(audio_requests_mutex);
    audio_request_cancellations.erase(request->request_id);
  }
  if (status != napi_ok || !request->succeeded) {
    napi_value error;
    napi_create_string_utf8(
        env,
        request->error.empty()
            ? "libmpv audio extraction failed"
            : request->error.c_str(),
        NAPI_AUTO_LENGTH,
        &error
    );
    napi_reject_deferred(env, request->deferred, error);
  } else {
    napi_value result;
    napi_create_string_utf8(
        env,
        request->output_path.c_str(),
        NAPI_AUTO_LENGTH,
        &result
    );
    napi_resolve_deferred(env, request->deferred, result);
  }
  napi_delete_async_work(env, request->work);
  delete request;
}

napi_value extract_audio(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  if (
      napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok ||
      argc < 1
  ) {
    return throw_error(env, "extractAudio(request) expected");
  }

  auto* request = new AudioExtractionRequest();
  request->env = env;
  if (
      !get_string(env, argv[0], "url", &request->url) ||
      request->url.empty() ||
      !get_string(env, argv[0], "outputPath", &request->output_path) ||
      request->output_path.empty() ||
      !get_number(env, argv[0], "startAt", &request->start_at) ||
      !get_number(env, argv[0], "duration", &request->duration) ||
      request->duration <= 0
  ) {
    delete request;
    return throw_error(env, "invalid audio extraction request");
  }
  request->headers = get_headers(env, argv[0]);
  get_string(env, argv[0], "requestId", &request->request_id);
  request->start_at = std::max(0.0, request->start_at);
  request->duration = std::min(60.0, std::max(1.0, request->duration));

  napi_value promise;
  if (
      napi_create_promise(env, &request->deferred, &promise) != napi_ok
  ) {
    delete request;
    return throw_error(env, "failed to create audio extraction promise");
  }

  napi_value resource_name;
  napi_create_string_utf8(
      env,
      "libmpv-audio-extraction",
      NAPI_AUTO_LENGTH,
      &resource_name
  );
  if (
      napi_create_async_work(
          env,
          nullptr,
          resource_name,
          execute_audio_extraction,
          complete_audio_extraction,
          request,
          &request->work
  ) != napi_ok
  ) {
    delete request;
    return throw_error(env, "failed to create audio extraction work");
  }
  if (!request->request_id.empty()) {
    std::lock_guard<std::mutex> lock(audio_requests_mutex);
    audio_request_cancellations[request->request_id] = request->cancelled;
  }
  if (napi_queue_async_work(env, request->work) != napi_ok) {
    if (!request->request_id.empty()) {
      std::lock_guard<std::mutex> lock(audio_requests_mutex);
      audio_request_cancellations.erase(request->request_id);
    }
    napi_delete_async_work(env, request->work);
    delete request;
    return throw_error(env, "failed to queue audio extraction work");
  }
  return promise;
}

napi_value cancel_audio_extraction(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  if (
      napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok ||
      argc < 1
  ) {
    return throw_error(env, "cancelAudioExtraction(requestId) expected");
  }
  std::string request_id;
  if (!get_value_string(env, argv[0], &request_id) || request_id.empty()) {
    return throw_error(env, "requestId must be a non-empty string");
  }
  bool cancelled = false;
  {
    std::lock_guard<std::mutex> lock(audio_requests_mutex);
    auto found = audio_request_cancellations.find(request_id);
    if (found != audio_request_cancellations.end()) {
      found->second->store(true, std::memory_order_release);
      cancelled = true;
    }
  }
  napi_value result;
  napi_get_boolean(env, cancelled, &result);
  return result;
}

std::string get_headers(napi_env env, napi_value request) {
  napi_value headers;
  if (!get_named(env, request, "headers", &headers)) return "";

  napi_valuetype headers_type;
  if (napi_typeof(env, headers, &headers_type) != napi_ok ||
      headers_type != napi_object) {
    return "";
  }

  napi_value names;
  if (napi_get_property_names(env, headers, &names) != napi_ok) return "";

  uint32_t length = 0;
  napi_get_array_length(env, names, &length);
  std::string result;
  for (uint32_t index = 0; index < length; index++) {
    napi_value key;
    napi_get_element(env, names, index, &key);
    size_t key_length = 0;
    napi_get_value_string_utf8(env, key, nullptr, 0, &key_length);
    std::string key_value(key_length + 1, '\0');
    napi_get_value_string_utf8(
        env, key, key_value.data(), key_length + 1, &key_length
    );
    key_value.resize(key_length);

    napi_value value;
    if (napi_get_property(env, headers, key, &value) != napi_ok) continue;
    size_t value_length = 0;
    if (napi_get_value_string_utf8(env, value, nullptr, 0, &value_length) !=
        napi_ok) {
      continue;
    }
    std::string value_string(value_length + 1, '\0');
    napi_get_value_string_utf8(
        env, value, value_string.data(), value_length + 1, &value_length
    );
    value_string.resize(value_length);
    if (!result.empty()) result += ",";
    result += key_value + ": " + value_string;
  }
  return result;
}

std::string get_command_type(napi_env env, napi_value command) {
  std::string type;
  get_string(env, command, "type", &type);
  return type;
}

napi_value create_player(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok ||
      argc < 3) {
    return throw_error(env, "createPlayer(parentHandle, bounds, callback) expected");
  }

  bool is_buffer = false;
  napi_is_buffer(env, argv[0], &is_buffer);
  if (!is_buffer) return throw_error(env, "parentHandle must be a Buffer");

  void* parent_handle = nullptr;
  size_t handle_length = 0;
  napi_get_buffer_info(env, argv[0], &parent_handle, &handle_length);
  if (!parent_handle || handle_length < sizeof(void*)) {
    return throw_error(env, "parentHandle is empty");
  }

  napi_valuetype callback_type = napi_undefined;
  napi_typeof(env, argv[2], &callback_type);
  if (callback_type != napi_function) {
    return throw_error(env, "callback must be a function");
  }

  auto* parent = *static_cast<void**>(parent_handle);
  auto player = std::make_shared<MpvPlayer>();
  player->env = env;
  player->id = "libmpv-" + std::to_string(next_player_id.fetch_add(1));

  std::string load_error;
  if (!player->api.load(&load_error)) {
    return throw_error(env, load_error);
  }

  SurfaceBounds bounds = get_bounds(env, argv[1]);
  player->surface = surface_create(
      parent,
      bounds,
      paint_callback,
      player.get()
  );
  if (!player->surface) return throw_error(env, "native surface creation failed");

  player->handle = player->api.create();
  if (!player->handle) return throw_error(env, "mpv_create failed");

  set_mpv_option(player.get(), "terminal", "no");
#if defined(_WIN32)
  const std::string wid_str = std::to_string(
      reinterpret_cast<uintptr_t>(surface_native_handle(player->surface))
  );
  set_mpv_option(player.get(), "wid", wid_str.c_str());
  set_mpv_option(player.get(), "vo", "gpu,direct3d,null");
  set_mpv_option(player.get(), "gpu-api", "d3d11,auto");
  set_mpv_option(player.get(), "gpu-context", "d3d11,auto");
#else
  set_mpv_option(player.get(), "vo", "libmpv");
#endif
  set_mpv_option(player.get(), "osc", "no");
  set_mpv_option(player.get(), "osd-level", "0");
  set_mpv_option(player.get(), "osd-bar", "no");
  set_mpv_option(player.get(), "input-default-bindings", "no");
  set_mpv_option(player.get(), "input-vo-keyboard", "no");
  set_mpv_option(player.get(), "hwdec", "auto-safe");
  set_mpv_option(player.get(), "keep-open", "yes");
  set_mpv_option(player.get(), "idle", "yes");
  set_mpv_option(player.get(), "network-timeout", "120");
  set_mpv_option(player.get(), "cache", "yes");
  set_mpv_option(player.get(), "cache-pause", "yes");
  set_mpv_option(player.get(), "cache-pause-initial", "no");
  set_mpv_option(player.get(), "cache-pause-wait", "0.5");
  // Keep torrent playback responsive without allowing libmpv to retain
  // hundreds of megabytes per player while the sidecar already buffers
  // requested pieces on disk.
  set_mpv_option(player.get(), "cache-secs", "30");
  set_mpv_option(player.get(), "demuxer-readahead-secs", "15");
  set_mpv_option(player.get(), "demuxer-max-bytes", "256MiB");
  set_mpv_option(player.get(), "stream-buffer-size", "2MiB");
  set_mpv_option(player.get(), "force-seekable", "yes");
  if (player->api.initialize(player->handle) < 0) {
    return throw_error(env, "mpv_initialize failed");
  }

  napi_value resource_name;
  napi_create_string_utf8(env, "libmpv-event", NAPI_AUTO_LENGTH, &resource_name);
  napi_create_threadsafe_function(
      env,
      argv[2],
      nullptr,
      resource_name,
      0,
      1,
      nullptr,
      nullptr,
      nullptr,
        [](napi_env callback_env, napi_value js_callback, void*, void* data) {
        auto* event = static_cast<NativeEvent*>(data);
        if (!callback_env || !js_callback) {
          delete event;
          return;
        }
        napi_value object;
        napi_create_object(callback_env, &object);

        napi_value value;
        napi_create_string_utf8(
            callback_env,
            event->player_id.c_str(),
            NAPI_AUTO_LENGTH,
            &value
        );
        napi_set_named_property(callback_env, object, "playerId", value);
        napi_create_int32(callback_env, event->generation, &value);
        napi_set_named_property(callback_env, object, "generation", value);
        napi_create_string_utf8(
            callback_env,
            event->type.c_str(),
            NAPI_AUTO_LENGTH,
            &value
        );
        napi_set_named_property(callback_env, object, "type", value);
        if (!event->name.empty()) {
          napi_create_string_utf8(
              callback_env, event->name.c_str(), NAPI_AUTO_LENGTH, &value
          );
          napi_set_named_property(callback_env, object, "name", value);
        }
        if (!event->message.empty()) {
          napi_create_string_utf8(
              callback_env, event->message.c_str(), NAPI_AUTO_LENGTH, &value
          );
          napi_set_named_property(callback_env, object, "message", value);
        }
        if (!event->level.empty()) {
          napi_create_string_utf8(
              callback_env, event->level.c_str(), NAPI_AUTO_LENGTH, &value
          );
          napi_set_named_property(callback_env, object, "level", value);
        }
        if (event->has_bool) {
          napi_get_boolean(callback_env, event->bool_value, &value);
          napi_set_named_property(callback_env, object, "data", value);
        } else if (event->has_number) {
          napi_create_double(callback_env, event->number_value, &value);
          napi_set_named_property(callback_env, object, "data", value);
        } else if (!event->string_value.empty()) {
          napi_create_string_utf8(
              callback_env,
              event->string_value.c_str(),
              NAPI_AUTO_LENGTH,
              &value
          );
          napi_set_named_property(callback_env, object, "data", value);
        }

        napi_value global;
        napi_get_global(callback_env, &global);
        napi_call_function(
            callback_env,
            global,
            js_callback,
            1,
            &object,
            nullptr
        );
        delete event;
      },
      &player->callback
  );

#if defined(__APPLE__)
  mpv_opengl_init_params gl_params{};
  gl_params.get_proc_address = [](void* ctx, const char* name) -> void* {
    return surface_get_proc_address(static_cast<NativeSurface*>(ctx), name);
  };
  gl_params.get_proc_address_ctx = player->surface;
  surface_make_current(player->surface);
  mpv_render_param render_params[] = {
      {MPV_RENDER_PARAM_API_TYPE, const_cast<char*>("opengl")},
      {MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &gl_params},
      {MPV_RENDER_PARAM_INVALID, nullptr},
  };
  if (player->api.render_context_create(
          &player->render_context,
          player->handle,
          render_params
      ) < 0) {
    return throw_error(env, "mpv_render_context_create failed");
  }
  player->api.render_context_set_update_callback(
      player->render_context,
      render_update_callback,
      player.get()
  );
#endif

  const char* observed[] = {
      "time-pos",
      "audio-pts",
      "duration",
      "pause",
      "volume",
      "speed",
      "seeking",
      "paused-for-cache",
      "demuxer-cache-duration",
      "track-list",
      "video-params",
      "video-out-params",
    };
    const mpv_format formats[] = {
      MPV_FORMAT_DOUBLE,
      MPV_FORMAT_DOUBLE,
      MPV_FORMAT_DOUBLE,
      MPV_FORMAT_FLAG,
      MPV_FORMAT_DOUBLE,
      MPV_FORMAT_DOUBLE,
      MPV_FORMAT_FLAG,
      MPV_FORMAT_FLAG,
      MPV_FORMAT_DOUBLE,
      MPV_FORMAT_NODE,
      MPV_FORMAT_NODE,
      MPV_FORMAT_NODE,
    };
  for (size_t index = 0; index < sizeof(observed) / sizeof(observed[0]); index++) {
    player->api.observe_property(
        player->handle,
        static_cast<uint64_t>(index + 1),
        observed[index],
        formats[index]
    );
  }
  player->api.request_log_messages(player->handle, "info");

  {
    std::lock_guard<std::mutex> lock(players_mutex);
    players.emplace(player->id, player);
  }
  player->event_thread = std::thread([player] { player->event_loop(); });

  napi_value result;
  napi_create_string_utf8(
      env, player->id.c_str(), NAPI_AUTO_LENGTH, &result
  );
  return result;
}

napi_value warmup(napi_env env, napi_callback_info) {
  MpvApi api;
  std::string load_error;
  if (!api.load(&load_error)) {
    return throw_error(env, load_error);
  }

  mpv_handle* handle = api.create();
  if (!handle) {
    api.unload();
    return throw_error(env, "mpv_create failed during warmup");
  }

  api.set_option_string(handle, "terminal", "no");
  api.set_option_string(handle, "vo", "null");
  api.set_option_string(handle, "ao", "null");
  api.set_option_string(handle, "idle", "yes");

  const int result = api.initialize(handle);
  api.terminate_destroy(handle);
  api.unload();

  if (result < 0) {
    return throw_error(env, "mpv_initialize failed during warmup");
  }

  napi_value value;
  napi_get_boolean(env, true, &value);
  return value;
}

napi_value resize_player(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  std::string id;
  if (!get_value_string(env, argv[0], &id)) {
    return throw_error(env, "player id must be a string");
  }
  auto player = find_player(id);
  if (!player) return throw_error(env, "player not found");
  surface_resize(player->surface, get_bounds(env, argv[1]));
  napi_value result;
  napi_get_boolean(env, true, &result);
  return result;
}

napi_value reparent_player(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  std::string id;
  if (!get_value_string(env, argv[0], &id)) {
    return throw_error(env, "player id must be a string");
  }

  bool is_buffer = false;
  napi_is_buffer(env, argv[1], &is_buffer);
  if (!is_buffer) return throw_error(env, "parentHandle must be a Buffer");
  void* handle = nullptr;
  size_t handle_length = 0;
  napi_get_buffer_info(env, argv[1], &handle, &handle_length);
  if (!handle || handle_length < sizeof(void*)) {
    return throw_error(env, "parentHandle is empty");
  }
  auto parent = *static_cast<void**>(handle);
  auto player = find_player(id);
  if (!player) return throw_error(env, "player not found");
  surface_reparent(player->surface, parent);
  napi_value result;
  napi_get_boolean(env, true, &result);
  return result;
}

napi_value command_player(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  std::string id;
  if (!get_value_string(env, argv[0], &id)) {
    return throw_error(env, "player id must be a string");
  }
  auto player = find_player(id);
  if (!player) return throw_error(env, "player not found");

  std::string type = get_command_type(env, argv[1]);
  std::string value;
  double number = 0;
  bool boolean = false;
  std::vector<std::string> values;
  if (type == "play") {
    values = {"set", "pause", "no"};
  } else if (type == "pause") {
    values = {"set", "pause", "yes"};
  } else if (type == "seek" && get_number(env, argv[1], "time", &number)) {
    values = {"seek", std::to_string(number), "absolute"};
  } else if (
      type == "set-volume" && get_number(env, argv[1], "volume", &number)
  ) {
    values = {"set", "volume", std::to_string(number * 100)};
  } else if (type == "set-mute" && get_bool(env, argv[1], "muted", &boolean)) {
    values = {"set", "mute", boolean ? "yes" : "no"};
  } else if (
      type == "set-playback-rate" &&
      get_number(env, argv[1], "rate", &number)
  ) {
    values = {"set", "speed", std::to_string(number)};
  } else if (
      (type == "set-audio-track" || type == "set-subtitle-track" ||
       type == "set-secondary-subtitle-track") &&
      get_string(env, argv[1], "trackId", &value)
  ) {
    values = {
        "set",
        type == "set-audio-track"
            ? "aid"
            : type == "set-secondary-subtitle-track" ? "secondary-sid"
                                                       : "sid",
        value,
    };
  } else {
    return throw_error(env, "unsupported libmpv command");
  }

  std::vector<const char*> command;
  for (const auto& item : values) command.push_back(item.c_str());
  command.push_back(nullptr);
  if (player->command(command.data()) < 0) {
    return throw_error(env, "libmpv command failed");
  }

  napi_value result;
  napi_get_boolean(env, true, &result);
  return result;
}

napi_value load_player(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  std::string id;
  if (!get_value_string(env, argv[0], &id)) {
    return throw_error(env, "player id must be a string");
  }
  auto player = find_player(id);
  if (!player) return throw_error(env, "player not found");

  std::string url;
  if (!get_string(env, argv[1], "url", &url) || url.empty()) {
    return throw_error(env, "source url is required");
  }

  double start_at = 0;
  bool autoplay = true;
  bool is_torrent = false;
  double requested_generation = 0;
  get_number(env, argv[1], "startAt", &start_at);
  get_bool(env, argv[1], "autoplay", &autoplay);
  get_bool(env, argv[1], "isTorrent", &is_torrent);
  get_number(env, argv[1], "generation", &requested_generation);
  player->generation.store(
      std::max(0, static_cast<int>(requested_generation))
  );
  player->video_frame_ready.store(false, std::memory_order_release);
  player->pending_start_at.store(
      std::max(0.0, start_at),
      std::memory_order_release
  );
  const std::string headers = get_headers(env, argv[1]);
  if (
      set_mpv_property(
          player.get(),
          "http-header-fields",
          headers.c_str()
      ) < 0
  ) {
    return throw_error(env, "libmpv header configuration failed");
  }
  if (
      set_mpv_property(
          player.get(),
          "pause",
          autoplay ? "no" : "yes"
      ) < 0
  ) {
    return throw_error(env, "libmpv pause configuration failed");
  }
  if (
      set_mpv_property(
          player.get(),
          "force-seekable",
          is_torrent ? "no" : "yes"
      ) < 0
  ) {
    return throw_error(env, "libmpv seekability configuration failed");
  }

  const char* load_command[] = {"loadfile", url.c_str(), "replace", nullptr};
  if (player->command(load_command) < 0) {
    return throw_error(env, "libmpv loadfile command failed");
  }
  napi_value result;
  napi_get_boolean(env, true, &result);
  return result;
}

napi_value destroy_player(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  std::string id;
  if (!get_value_string(env, argv[0], &id)) {
    return throw_error(env, "player id must be a string");
  }

  std::shared_ptr<MpvPlayer> player;
  {
    std::lock_guard<std::mutex> lock(players_mutex);
    auto found = players.find(id);
    if (found != players.end()) {
      player = found->second;
      players.erase(found);
    }
  }
  if (player) player->stop();
  player.reset();
  napi_value result;
  napi_get_boolean(env, true, &result);
  return result;
}

napi_value configure_window(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  bool is_buffer = false;
  if (argc > 0) napi_is_buffer(env, argv[0], &is_buffer);
  if (!is_buffer) return throw_error(env, "parentHandle must be a Buffer");
  void* handle = nullptr;
  size_t handle_length = 0;
  napi_get_buffer_info(env, argv[0], &handle, &handle_length);
  if (!handle || handle_length < sizeof(void*)) {
    return throw_error(env, "parentHandle is empty");
  }
  auto parent = *static_cast<void**>(handle);
  surface_configure_window(parent);
  napi_value result;
  napi_get_boolean(env, true, &result);
  return result;
}

napi_value init(napi_env env, napi_value exports) {
  napi_property_descriptor methods[] = {
      {"warmup", nullptr, warmup, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"createPlayer", nullptr, create_player, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"resizePlayer", nullptr, resize_player, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"reparentPlayer", nullptr, reparent_player, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"commandPlayer", nullptr, command_player, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"extractAudio", nullptr, extract_audio, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"cancelAudioExtraction", nullptr, cancel_audio_extraction, nullptr,
       nullptr, nullptr, napi_default, nullptr},
      {"loadPlayer", nullptr, load_player, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"destroyPlayer", nullptr, destroy_player, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"configureWindow", nullptr, configure_window, nullptr, nullptr, nullptr,
       napi_default, nullptr},
  };
  napi_define_properties(
      env,
      exports,
      sizeof(methods) / sizeof(methods[0]),
      methods
  );
  return exports;
}

}  // namespace

NAPI_MODULE_INIT() {
  return init(env, exports);
}
