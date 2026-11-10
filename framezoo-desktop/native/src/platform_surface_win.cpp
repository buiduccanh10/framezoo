#if defined(_WIN32)

#include "platform_surface.h"

#include <windows.h>
#include <cstdio>
#include <mutex>

struct NativeSurface {
  HWND hwnd = nullptr;
  HWND parent = nullptr;
  SurfaceBounds bounds{};
  std::atomic<uint64_t> paint_count{0};
  SurfacePaintCallback paint_callback = nullptr;
  void* user = nullptr;
};

namespace {

std::once_flag register_class_once;

RECT screen_bounds(HWND parent, const SurfaceBounds& bounds) {
  POINT origin{0, 0};
  if (parent) ClientToScreen(parent, &origin);
  return RECT{
      origin.x + bounds.x,
      origin.y + bounds.y,
      origin.x + bounds.x + bounds.width,
      origin.y + bounds.y + bounds.height,
  };
}

UINT surface_position_flags(HWND parent) {
  return SWP_NOACTIVATE |
      (parent && (!IsWindowVisible(parent) || IsIconic(parent))
           ? SWP_HIDEWINDOW
           : SWP_SHOWWINDOW);
}

void register_surface_class() {
  std::call_once(register_class_once, [] {
    WNDCLASSA window_class{};
    window_class.lpfnWndProc = [](HWND hwnd, UINT message, WPARAM wparam,
                                  LPARAM lparam) -> LRESULT {
      switch (message) {
        case WM_ERASEBKGND:
          return 1;
        case WM_PAINT: {
          PAINTSTRUCT paint{};
          BeginPaint(hwnd, &paint);
          EndPaint(hwnd, &paint);
          return 0;
        }
        case WM_NCHITTEST:
          return HTTRANSPARENT;
        case WM_MOUSEACTIVATE:
          return MA_NOACTIVATE;
        case WM_DESTROY:
          return 0;
        default:
          return DefWindowProcA(hwnd, message, wparam, lparam);
      }
    };
    window_class.hInstance = GetModuleHandleA(nullptr);
    window_class.lpszClassName = "FrameZooLibMpvSurface";
    window_class.hbrBackground = nullptr;
    RegisterClassA(&window_class);
  });
}

}  // namespace

void surface_configure_window(void* parent_handle) {
  // Windows uses a separate top-level popup for the video surface. Mutating
  // Chromium's child styles here creates an HWND airspace conflict: mpv's
  // first painted frame can cover the renderer controls permanently.
  (void)parent_handle;
}

NativeSurface* surface_create(
    void* parent_handle,
    SurfaceBounds bounds,
    SurfacePaintCallback paint_callback,
    void* user
) {
  register_surface_class();

  auto* surface = new NativeSurface();
  surface->parent = static_cast<HWND>(parent_handle);
  surface->bounds = bounds;
  surface->paint_callback = paint_callback;
  surface->user = user;

  const RECT target = screen_bounds(surface->parent, bounds);
  surface->hwnd = CreateWindowExA(
      WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
      "FrameZooLibMpvSurface",
      "",
      // Keep the native video outside Chromium's child-window tree. The
      // transparent Electron player remains above this popup, so its DOM
      // header, toolbar, subtitles, and click targets stay composited.
      // ponytail: avoids raw frame IPC; upgrade to a shared D3D texture when
      // Chromium exposes a stable native-surface import path.
      WS_POPUP | WS_VISIBLE | WS_CLIPSIBLINGS,
      target.left,
      target.top,
      bounds.width,
      bounds.height,
      nullptr,
      nullptr,
      GetModuleHandleA(nullptr),
      nullptr
  );
  if (!surface->hwnd) {
    std::fprintf(
        stderr,
        "[libmpv-native] surface_create: CreateWindowExA failed (err %lu)\n",
        static_cast<unsigned long>(GetLastError())
    );
    delete surface;
    return nullptr;
  }

  SetWindowLongPtrA(
      surface->hwnd,
      GWLP_USERDATA,
      reinterpret_cast<LONG_PTR>(surface)
  );
  SetWindowPos(
      surface->hwnd,
      surface->parent,
      target.left,
      target.top,
      bounds.width,
      bounds.height,
      surface_position_flags(surface->parent)
  );
  return surface;
}

void surface_resize(NativeSurface* surface, SurfaceBounds bounds) {
  if (!surface || !surface->hwnd) return;
  surface->bounds = bounds;
  const RECT target = screen_bounds(surface->parent, bounds);
  SetWindowPos(
      surface->hwnd,
      surface->parent,
      target.left,
      target.top,
      bounds.width,
      bounds.height,
      surface_position_flags(surface->parent)
  );
}

void surface_reparent(NativeSurface* surface, void* parent_handle) {
  if (!surface || !surface->hwnd || !parent_handle) return;
  surface->parent = static_cast<HWND>(parent_handle);
  const RECT target = screen_bounds(surface->parent, surface->bounds);
  SetWindowPos(
      surface->hwnd,
      surface->parent,
      target.left,
      target.top,
      surface->bounds.width,
      surface->bounds.height,
      surface_position_flags(surface->parent)
  );
}

void surface_request_paint(NativeSurface*) {}

void surface_notify_system_wake(NativeSurface* surface) {
  if (!surface || !surface->hwnd) return;
  // After sleep/resume the popup can lose its z-order/position relative to the
  // Electron window and DWM may keep a stale composition of it. Re-apply the
  // physical bounds and invalidate so the next mpv frame is presented.
  const RECT target = screen_bounds(surface->parent, surface->bounds);
  SetWindowPos(
      surface->hwnd,
      surface->parent,
      target.left,
      target.top,
      surface->bounds.width,
      surface->bounds.height,
      surface_position_flags(surface->parent) | SWP_FRAMECHANGED
  );
  RedrawWindow(
      surface->hwnd,
      nullptr,
      nullptr,
      RDW_INVALIDATE | RDW_UPDATENOW | RDW_ALLCHILDREN
  );
}

void surface_disable_paint(NativeSurface* surface) {
  if (!surface) return;
  surface->paint_callback = nullptr;
  surface->user = nullptr;
}

void surface_destroy(NativeSurface* surface) {
  if (!surface) return;
  surface_disable_paint(surface);
  if (surface->hwnd) {
    SetWindowLongPtrA(surface->hwnd, GWLP_USERDATA, 0);
    DestroyWindow(surface->hwnd);
    surface->hwnd = nullptr;
  }
  delete surface;
}

void* surface_get_proc_address(NativeSurface*, const char*) {
  return nullptr;
}

void surface_make_current(NativeSurface*) {}

void surface_swap_buffers(NativeSurface*) {}

int surface_width(NativeSurface* surface) {
  return surface ? surface->bounds.width : 0;
}

int surface_height(NativeSurface* surface) {
  return surface ? surface->bounds.height : 0;
}

void* surface_native_handle(NativeSurface* surface) {
  return surface ? static_cast<void*>(surface->hwnd) : nullptr;
}

int surface_blit_rgb0(NativeSurface*, const void*, size_t) {
  return 1;
}

#endif
