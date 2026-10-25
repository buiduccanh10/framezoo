#include "mpv_dynamic.h"

#include <cstdlib>
#include <cwctype>
#include <iomanip>
#include <mutex>
#include <sstream>
#include <string>
#include <unordered_set>
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

std::string wide_to_utf8(const std::wstring& value) {
  if (value.empty()) return {};
  const int length = WideCharToMultiByte(
      CP_UTF8,
      0,
      value.data(),
      static_cast<int>(value.size()),
      nullptr,
      0,
      nullptr,
      nullptr
  );
  if (length <= 0) return {};
  std::string result(static_cast<size_t>(length), '\0');
  WideCharToMultiByte(
      CP_UTF8,
      0,
      value.data(),
      static_cast<int>(value.size()),
      result.data(),
      length,
      nullptr,
      nullptr
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

bool is_path_absolute_wide(const std::wstring& path) {
  if (path.size() >= 2 && path[1] == L':') return true;
  if (path.size() >= 2 && (path[0] == L'\\' || path[0] == L'/') &&
      (path[1] == L'\\' || path[1] == L'/')) {
    return true;
  }
  return path.find(L'\\') != std::wstring::npos || path.find(L'/') != std::wstring::npos;
}

std::wstring canonicalize_path(const std::wstring& path) {
  if (path.empty()) return {};
  wchar_t full[MAX_PATH] = {0};
  if (is_path_absolute_wide(path)) {
    if (GetFullPathNameW(path.c_str(), MAX_PATH, full, nullptr) > 0) {
      std::wstring result(full);
      for (auto& c : result) c = static_cast<wchar_t>(towlower(c));
      return result;
    }
  } else {
    if (SearchPathW(nullptr, path.c_str(), nullptr, MAX_PATH, full, nullptr) > 0) {
      std::wstring result(full);
      for (auto& c : result) c = static_cast<wchar_t>(towlower(c));
      return result;
    }
  }
  std::wstring result(path);
  for (auto& c : result) c = static_cast<wchar_t>(towlower(c));
  return result;
}

struct VehDiagnostic {
  DWORD exception_code = 0;
  void* exception_address = nullptr;
  std::wstring fault_module;
  uintptr_t fault_offset = 0;
  uint8_t fault_bytes[8] = {0};
  size_t fault_bytes_read = 0;
};

static thread_local bool t_catching_dll_init = false;
static thread_local VehDiagnostic t_veh_diag{};

static LONG CALLBACK DllInitVectoredHandler(PEXCEPTION_POINTERS ep) {
  if (!t_catching_dll_init || !ep || !ep->ExceptionRecord) {
    return EXCEPTION_CONTINUE_SEARCH;
  }
  const DWORD code = ep->ExceptionRecord->ExceptionCode;
  if (code == 0xC000001D /* STATUS_ILLEGAL_INSTRUCTION */ ||
      code == 0xC0000005 /* STATUS_ACCESS_VIOLATION */ ||
      code == 0xC0000096 /* STATUS_PRIVILEGED_INSTRUCTION */ ||
      code == 0xC0000028 /* STATUS_BAD_STACK */ ||
      code == 0xC00000FD /* STATUS_STACK_OVERFLOW */) {
    if (t_veh_diag.exception_code == 0) {
      t_veh_diag.exception_code = code;
      t_veh_diag.exception_address = ep->ExceptionRecord->ExceptionAddress;

      HMODULE hMod = nullptr;
      if (GetModuleHandleExW(
              GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS |
                  GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
              reinterpret_cast<LPCWSTR>(t_veh_diag.exception_address),
              &hMod
          ) &&
          hMod) {
        wchar_t modPath[MAX_PATH] = {0};
        if (GetModuleFileNameW(hMod, modPath, MAX_PATH)) {
          const wchar_t* baseName = wcsrchr(modPath, L'\\');
          t_veh_diag.fault_module = baseName ? baseName + 1 : modPath;
          t_veh_diag.fault_offset =
              reinterpret_cast<uintptr_t>(t_veh_diag.exception_address) -
              reinterpret_cast<uintptr_t>(hMod);
        }
      }

      SIZE_T bytesRead = 0;
      if (ReadProcessMemory(
              GetCurrentProcess(),
              t_veh_diag.exception_address,
              t_veh_diag.fault_bytes,
              sizeof(t_veh_diag.fault_bytes),
              &bytesRead
          )) {
        t_veh_diag.fault_bytes_read = bytesRead;
      }
    }
  }
  return EXCEPTION_CONTINUE_SEARCH;
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

void* load_library(const std::string& path, std::string* detailed_error = nullptr) {
#if defined(_WIN32)
  const std::wstring wide_path = utf8_to_wide(path);
  HMODULE h = nullptr;

  PVOID veh_handle = AddVectoredExceptionHandler(1, DllInitVectoredHandler);
  t_catching_dll_init = true;
  t_veh_diag = {};

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

  const DWORD last_err = h ? 0 : GetLastError();

  t_catching_dll_init = false;
  if (veh_handle) {
    RemoveVectoredExceptionHandler(veh_handle);
  }

  if (!h && detailed_error) {
    std::ostringstream diag;
    diag << "err " << last_err;
    if (last_err == ERROR_DLL_INIT_FAILED) {
      const bool has_avx = IsProcessorFeaturePresent(PF_AVX_INSTRUCTIONS_AVAILABLE) != 0;
      const bool has_avx2 = IsProcessorFeaturePresent(PF_AVX2_INSTRUCTIONS_AVAILABLE) != 0;
      diag << " [init_failed";
      if (t_veh_diag.exception_code != 0) {
        diag << ": code=0x" << std::hex << std::uppercase << t_veh_diag.exception_code;
        if (!t_veh_diag.fault_module.empty()) {
          diag << " mod=" << wide_to_utf8(t_veh_diag.fault_module) << "+0x"
               << std::hex << std::nouppercase << t_veh_diag.fault_offset;
        }
        if (t_veh_diag.fault_bytes_read > 0) {
          diag << " bytes=";
          for (size_t b = 0; b < t_veh_diag.fault_bytes_read; ++b) {
            diag << std::hex << std::setw(2) << std::setfill('0')
                 << static_cast<int>(t_veh_diag.fault_bytes[b]);
          }
        }
      }
      diag << " avx=" << (has_avx ? "1" : "0") << " avx2=" << (has_avx2 ? "1" : "0") << "]";
    }
    *detailed_error = diag.str();
  }
  return static_cast<void*>(h);
#else
  if (detailed_error) detailed_error->clear();
  void* lib = dlopen(path.c_str(), RTLD_NOW | RTLD_LOCAL);
  if (!lib && detailed_error) {
    const char* dl_err = dlerror();
    *detailed_error = dl_err ? dl_err : "dlopen failed";
  }
  return lib;
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
bool g_shared_init_failed = false;
std::string g_shared_load_error;

}  // namespace

bool MpvApi::load(std::string* error) {
  std::lock_guard<std::mutex> lock(g_api_mutex);

  if (g_shared_api_loaded && g_shared_api.library) {
    *this = g_shared_api;
    return true;
  }

  if (g_shared_init_failed) {
    // If a fatal initialization failure (e.g. error 1114) occurred, do not
    // re-invoke DllMain across candidates or subsequent load attempts.
    if (error) *error = g_shared_load_error;
    return false;
  }

  std::unordered_set<std::string> attempted_canonical;
  std::ostringstream failures;
  for (const auto& path : library_candidates()) {
#if defined(_WIN32)
    const std::wstring canon_w = canonicalize_path(utf8_to_wide(path));
    const std::string canon = wide_to_utf8(canon_w);
    if (!canon.empty() && attempted_canonical.count(canon) > 0) {
      continue;
    }
    if (!canon.empty()) {
      attempted_canonical.insert(canon);
    }
#endif

    std::string load_err;
    void* lib = load_library(path, &load_err);
    if (!lib) {
      failures << path << " (" << load_err << "); ";
#if defined(_WIN32)
      if (load_err.find("err 1114") != std::string::npos) {
        g_shared_init_failed = true;
      }
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
