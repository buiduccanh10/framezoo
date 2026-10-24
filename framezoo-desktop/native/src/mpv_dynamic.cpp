#include "mpv_dynamic.h"

#include <cstdlib>
#include <mutex>
#include <sstream>
#include <string>
#include <vector>

#if defined(_WIN32)
#include <windows.h>
#else
#include <dlfcn.h>
#endif

namespace {

#if defined(_WIN32)
std::wstring utf8_to_wide(const std::string& value) {
  if (value.empty()) return {};
  const int length = MultiByteToWideChar(
      CP_UTF8,
      0,
      value.data(),
      static_cast<int>(value.size()),
      nullptr,
      0
  );
  if (length <= 0) return {};
  std::wstring result(static_cast<size_t>(length), L'\0');
  MultiByteToWideChar(
      CP_UTF8,
      0,
      value.data(),
      static_cast<int>(value.size()),
      result.data(),
      length
  );
  return result;
}

bool is_path_absolute(const std::string& path) {
  if (path.size() >= 2 && path[1] == ':') return true;
  if (path.size() >= 2 && (path[0] == '\\' || path[0] == '/') &&
      (path[1] == '\\' || path[1] == '/')) {
    return true;
  }
  return path.find('\\') != std::string::npos || path.find('/') != std::string::npos;
}
#endif

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

void* load_library(const std::string& path, unsigned long* last_error = nullptr) {
#if defined(_WIN32)
  const std::wstring wide_path = utf8_to_wide(path);
  HMODULE h = nullptr;
  if (is_path_absolute(path)) {
    // For an absolute path to libmpv-2.dll, LOAD_WITH_ALTERED_SEARCH_PATH allows
    // Windows to resolve co-located dependency DLLs from the same folder.
    h = LoadLibraryExW(
        wide_path.c_str(),
        NULL,
        LOAD_WITH_ALTERED_SEARCH_PATH
    );
    if (!h) {
      const DWORD err = GetLastError();
      if (last_error) *last_error = err;
      // If initialization itself failed (1114), do not re-invoke DllMain.
      if (err != ERROR_DLL_INIT_FAILED) {
        h = LoadLibraryExW(
            wide_path.c_str(),
            NULL,
            LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS
        );
      }
    }
  } else {
    // For simple DLL names, use standard DLL search path (PATH / application dir).
    h = LoadLibraryW(wide_path.c_str());
  }

  if (!h && last_error) {
    *last_error = GetLastError();
  }
  return static_cast<void*>(h);
#else
  if (last_error) *last_error = 0;
  return dlopen(path.c_str(), RTLD_NOW | RTLD_LOCAL);
#endif
}

std::vector<std::string> library_candidates() {
  std::vector<std::string> paths;
#if defined(_WIN32)
  const wchar_t* configured_wide = _wgetenv(L"FRAMEZOO_LIBMPV_PATH");
  if (configured_wide && *configured_wide) {
    const int utf8_len = WideCharToMultiByte(
        CP_UTF8,
        0,
        configured_wide,
        -1,
        nullptr,
        0,
        nullptr,
        nullptr
    );
    if (utf8_len > 0) {
      std::string configured(static_cast<size_t>(utf8_len), '\0');
      WideCharToMultiByte(
          CP_UTF8,
          0,
          configured_wide,
          -1,
          configured.data(),
          utf8_len,
          nullptr,
          nullptr
      );
      configured.resize(utf8_len - 1);
      paths.emplace_back(std::move(configured));
    }
  }
  paths.emplace_back("libmpv-2.dll");
  paths.emplace_back("mpv-2.dll");
  paths.emplace_back("libmpv-1.dll");
  paths.emplace_back("libmpv.dll");
#else
  if (const char* configured = std::getenv("FRAMEZOO_LIBMPV_PATH")) {
    paths.emplace_back(configured);
  }
  paths.emplace_back("@loader_path/libmpv.2.dylib");
  paths.emplace_back("@loader_path/libmpv.dylib");
  paths.emplace_back("libmpv.2.dylib");
  paths.emplace_back("libmpv.dylib");
#endif
  return paths;
}

std::mutex g_api_mutex;
MpvApi g_shared_api{};
bool g_shared_api_loaded = false;
std::string g_shared_load_error;

}  // namespace

bool MpvApi::load(std::string* error) {
  std::lock_guard<std::mutex> lock(g_api_mutex);

  if (g_shared_api_loaded && g_shared_api.library) {
    *this = g_shared_api;
    return true;
  }

  if (!g_shared_load_error.empty() && !g_shared_api_loaded) {
    // If previous attempt failed, keep error string for diagnostics.
  }

  std::ostringstream failures;
  for (const auto& path : library_candidates()) {
    unsigned long err_code = 0;
    void* lib = load_library(path, &err_code);
    if (!lib) {
#if defined(_WIN32)
      failures << path << " (err " << err_code << "); ";
#else
      const char* dl_err = dlerror();
      failures << path << (dl_err ? std::string(" (") + dl_err + ")" : "") << "; ";
#endif
      continue;
    }

    MpvApi loaded_api{};
    loaded_api.library = lib;

#define LOAD_MPV_SYMBOL(field, symbol)                                          \
  if (!load_symbol(loaded_api.library, symbol, &loaded_api.field)) {           \
    failures << symbol << "; ";                                                 \
    continue;                                                                   \
  }

    LOAD_MPV_SYMBOL(create, "mpv_create")
    LOAD_MPV_SYMBOL(initialize, "mpv_initialize")
    LOAD_MPV_SYMBOL(set_option_string, "mpv_set_option_string")
    LOAD_MPV_SYMBOL(command, "mpv_command")
    LOAD_MPV_SYMBOL(command_async, "mpv_command_async")
    LOAD_MPV_SYMBOL(wait_event, "mpv_wait_event")
    LOAD_MPV_SYMBOL(observe_property, "mpv_observe_property")
    LOAD_MPV_SYMBOL(get_property, "mpv_get_property")
    LOAD_MPV_SYMBOL(get_property_string, "mpv_get_property_string")
    LOAD_MPV_SYMBOL(set_property_string, "mpv_set_property_string")
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

    g_shared_api = loaded_api;
    g_shared_api_loaded = true;
    g_shared_load_error.clear();
    *this = g_shared_api;
    return true;
  }

  g_shared_load_error = "Unable to load libmpv runtime. Checked: " + failures.str();
  if (error) {
    *error = g_shared_load_error;
  }
  return false;
}

void MpvApi::unload() {
  // libmpv is retained as a process-wide singleton once loaded. Unloading and
  // re-loading monolithic MinGW libmpv DLLs exhausts TLS slots and corrupts
  // runtime state in DllMain, resulting in Win32 error 1114 (ERROR_DLL_INIT_FAILED).
  // Instances simply clear their local handle without calling FreeLibrary/dlclose.
  library = nullptr;
}
