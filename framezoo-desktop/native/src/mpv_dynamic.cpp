#include "mpv_dynamic.h"

#include <cstdlib>
#include <sstream>
#include <vector>

#if defined(_WIN32)
#include <windows.h>
#else
#include <dlfcn.h>
#endif

namespace {

template <typename T>
bool load_symbol(void* library, const char* name, T* target) {
#if defined(_WIN32)
  *target = reinterpret_cast<T>(
      GetProcAddress(static_cast<HMODULE>(library), name)
  );
#else
  *target = reinterpret_cast<T>(dlsym(library, name));
#endif
  return *target != nullptr;
}

void* load_library(const char* path) {
#if defined(_WIN32)
  return static_cast<void*>(LoadLibraryA(path));
#else
  return dlopen(path, RTLD_NOW | RTLD_LOCAL);
#endif
}

void close_library(void* library) {
  if (!library) return;
#if defined(_WIN32)
  FreeLibrary(static_cast<HMODULE>(library));
#else
  dlclose(library);
#endif
}

std::vector<std::string> library_candidates() {
  std::vector<std::string> paths;
  if (const char* configured = std::getenv("FRAMEZOO_LIBMPV_PATH")) {
    paths.emplace_back(configured);
  }
#if defined(_WIN32)
  paths.emplace_back("libmpv-2.dll");
  paths.emplace_back("mpv-2.dll");
  paths.emplace_back("libmpv-1.dll");
  paths.emplace_back("libmpv.dll");
#else
  paths.emplace_back("@loader_path/libmpv.2.dylib");
  paths.emplace_back("@loader_path/libmpv.dylib");
  paths.emplace_back("libmpv.2.dylib");
  paths.emplace_back("libmpv.dylib");
#endif
  return paths;
}

}  // namespace

bool MpvApi::load(std::string* error) {
  if (library) return true;

  std::ostringstream failures;
  for (const auto& path : library_candidates()) {
    library = load_library(path.c_str());
    if (!library) {
      failures << path << "; ";
      continue;
    }

#define LOAD_MPV_SYMBOL(field, symbol)                                          \
  if (!load_symbol(library, symbol, &field)) {                                  \
    failures << symbol << "; ";                                                 \
    close_library(library);                                                     \
    library = nullptr;                                                          \
    continue;                                                                   \
  }

    LOAD_MPV_SYMBOL(create, "mpv_create")
    LOAD_MPV_SYMBOL(initialize, "mpv_initialize")
    LOAD_MPV_SYMBOL(set_option_string, "mpv_set_option_string")
    LOAD_MPV_SYMBOL(command, "mpv_command")
    LOAD_MPV_SYMBOL(wait_event, "mpv_wait_event")
    LOAD_MPV_SYMBOL(observe_property, "mpv_observe_property")
    LOAD_MPV_SYMBOL(get_property, "mpv_get_property")
    LOAD_MPV_SYMBOL(get_property_string, "mpv_get_property_string")
    LOAD_MPV_SYMBOL(free_node_contents, "mpv_free_node_contents")
    LOAD_MPV_SYMBOL(free_memory, "mpv_free")
    LOAD_MPV_SYMBOL(terminate_destroy, "mpv_terminate_destroy")
    LOAD_MPV_SYMBOL(request_log_messages, "mpv_request_log_messages")
    LOAD_MPV_SYMBOL(render_context_create, "mpv_render_context_create")
    LOAD_MPV_SYMBOL(render_context_free, "mpv_render_context_free")
    LOAD_MPV_SYMBOL(
        render_context_set_update_callback,
        "mpv_render_context_set_update_callback"
    )
    LOAD_MPV_SYMBOL(render_context_update, "mpv_render_context_update")
    LOAD_MPV_SYMBOL(render_context_render, "mpv_render_context_render")
    LOAD_MPV_SYMBOL(
        render_context_report_swap,
        "mpv_render_context_report_swap"
    )

#undef LOAD_MPV_SYMBOL
    return true;
  }

  if (error) {
    *error = "Unable to load libmpv runtime. Checked: " + failures.str();
  }
  return false;
}

void MpvApi::unload() {
  close_library(library);
  library = nullptr;
  create = nullptr;
  initialize = nullptr;
  set_option_string = nullptr;
  command = nullptr;
  wait_event = nullptr;
  observe_property = nullptr;
  get_property = nullptr;
  get_property_string = nullptr;
  free_node_contents = nullptr;
  free_memory = nullptr;
  terminate_destroy = nullptr;
  request_log_messages = nullptr;
  render_context_create = nullptr;
  render_context_free = nullptr;
  render_context_set_update_callback = nullptr;
  render_context_update = nullptr;
  render_context_render = nullptr;
  render_context_report_swap = nullptr;
}
