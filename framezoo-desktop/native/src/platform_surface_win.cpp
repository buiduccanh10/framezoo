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

void surface_configure_window(void* parent_handle) {
  if (!parent_handle) return;
  HWND parent = static_cast<HWND>(parent_handle);
  LONG_PTR style = GetWindowLongPtrA(parent, GWL_STYLE);
  if (!(style & WS_CLIPCHILDREN)) {
    SetWindowLongPtrA(parent, GWL_STYLE, style | WS_CLIPCHILDREN);
    SetWindowPos(
        parent,
        nullptr,
        0,
        0,
        0,
        0,
        SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED
    );
  }

  EnumChildWindows(
      parent,
      [](HWND child, LPARAM) -> BOOL {
        LONG_PTR child_style = GetWindowLongPtrA(child, GWL_STYLE);
        if (!(child_style & WS_CLIPSIBLINGS)) {
          SetWindowLongPtrA(child, GWL_STYLE, child_style | WS_CLIPSIBLINGS);
          SetWindowPos(
              child,
              nullptr,
              0,
              0,
              0,
              0,
              SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED
          );
        }
        return TRUE;
      },
      0
  );
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

  surface_configure_window(surface->parent);

  surface->hwnd = CreateWindowExA(
      0,
      "FrameZooLibMpvSurface",
      "",
      WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      surface->parent,
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
  return surface;
}

void surface_resize(NativeSurface* surface, SurfaceBounds bounds) {
  if (!surface || !surface->hwnd) return;
  surface->bounds = bounds;
  SetWindowPos(
      surface->hwnd,
      HWND_TOP,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      SWP_NOACTIVATE | SWP_SHOWWINDOW
  );
  surface_configure_window(surface->parent);
}

void surface_reparent(NativeSurface* surface, void* parent_handle) {
  if (!surface || !surface->hwnd || !parent_handle) return;
  surface->parent = static_cast<HWND>(parent_handle);
  SetParent(surface->hwnd, surface->parent);
  surface_configure_window(surface->parent);
  SetWindowPos(
      surface->hwnd,
      HWND_TOP,
      0,
      0,
      surface->bounds.width,
      surface->bounds.height,
      SWP_NOACTIVATE | SWP_SHOWWINDOW
  );
}

void surface_request_paint(NativeSurface*) {}

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
