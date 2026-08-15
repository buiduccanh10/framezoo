#if defined(_WIN32)

#include "platform_surface.h"

#include <windows.h>
#include <GL/gl.h>

#include <mutex>

struct NativeSurface {
  HWND hwnd = nullptr;
  HWND parent = nullptr;
  HDC dc = nullptr;
  HGLRC gl_context = nullptr;
  SurfaceBounds bounds{};
  std::atomic<uint64_t> paint_count{0};
  SurfacePaintCallback paint_callback = nullptr;
  void* user = nullptr;
};

namespace {

std::once_flag register_class_once;

void register_surface_class() {
  std::call_once(register_class_once, [] {
    WNDCLASSA window_class{};
    window_class.lpfnWndProc = [](HWND hwnd, UINT message, WPARAM wparam,
                                  LPARAM lparam) -> LRESULT {
      auto* surface = reinterpret_cast<NativeSurface*>(
          GetWindowLongPtrA(hwnd, GWLP_USERDATA)
      );

      switch (message) {
        case WM_ERASEBKGND:
          return 1;
        case WM_PAINT: {
          PAINTSTRUCT paint{};
          BeginPaint(hwnd, &paint);
          if (surface && surface->gl_context && surface->paint_callback) {
            const uint64_t paint_number =
                surface->paint_count.fetch_add(1) + 1;
            if (paint_number <= 5 || paint_number % 60 == 0) {
              std::fprintf(
                  stderr,
                  "[libmpv-native] paint count=%llu frame=%dx%d\n",
                  static_cast<unsigned long long>(paint_number),
                  surface->bounds.width,
                  surface->bounds.height
              );
            }
            wglMakeCurrent(surface->dc, surface->gl_context);
            surface->paint_callback(surface->user, surface);
          }
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
    window_class.style = CS_OWNDC;
    RegisterClassA(&window_class);
  });
}

bool setup_pixel_format(NativeSurface* surface) {
  PIXELFORMATDESCRIPTOR descriptor{};
  descriptor.nSize = sizeof(descriptor);
  descriptor.nVersion = 1;
  descriptor.dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER;
  descriptor.iPixelType = PFD_TYPE_RGBA;
  descriptor.cColorBits = 32;
  descriptor.cAlphaBits = 8;
  descriptor.cDepthBits = 24;
  descriptor.iLayerType = PFD_MAIN_PLANE;

  const int format = ChoosePixelFormat(surface->dc, &descriptor);
  return format != 0 && SetPixelFormat(surface->dc, format, &descriptor) == TRUE;
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
  surface->hwnd = CreateWindowExA(
      0,
      "FrameZooLibMpvSurface",
      "",
      WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS | WS_CLIPCHILDREN,
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
  surface->dc = GetDC(surface->hwnd);
  if (!surface->dc || !setup_pixel_format(surface)) {
    std::fprintf(
        stderr,
        "[libmpv-native] surface_create: GetDC/SetPixelFormat failed (err %lu)\n",
        static_cast<unsigned long>(GetLastError())
    );
    surface_destroy(surface);
    return nullptr;
  }

  surface->gl_context = wglCreateContext(surface->dc);
  if (!surface->gl_context) {
    std::fprintf(
        stderr,
        "[libmpv-native] surface_create: wglCreateContext failed (err %lu)\n",
        static_cast<unsigned long>(GetLastError())
    );
    surface_destroy(surface);
    return nullptr;
  }

  wglMakeCurrent(surface->dc, surface->gl_context);
  return surface;
}

void surface_resize(NativeSurface* surface, SurfaceBounds bounds) {
  if (!surface || !surface->hwnd) return;
  surface->bounds = bounds;
  SetWindowPos(
      surface->hwnd,
      HWND_BOTTOM,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      SWP_NOACTIVATE | SWP_SHOWWINDOW
  );
  surface_request_paint(surface);
}

void surface_reparent(NativeSurface* surface, void* parent_handle) {
  if (!surface || !surface->hwnd || !parent_handle) return;
  surface->parent = static_cast<HWND>(parent_handle);
  SetParent(surface->hwnd, surface->parent);
  SetWindowPos(
      surface->hwnd,
      HWND_BOTTOM,
      0,
      0,
      surface->bounds.width,
      surface->bounds.height,
      SWP_NOACTIVATE | SWP_SHOWWINDOW
  );
  surface_request_paint(surface);
}

void surface_request_paint(NativeSurface* surface) {
  if (!surface || !surface->hwnd) return;
  InvalidateRect(surface->hwnd, nullptr, FALSE);
}

void surface_disable_paint(NativeSurface* surface) {
  if (!surface) return;
  surface->paint_callback = nullptr;
  surface->user = nullptr;
}

void surface_destroy(NativeSurface* surface) {
  if (!surface) return;
  surface_disable_paint(surface);
  if (surface->gl_context) {
    wglMakeCurrent(nullptr, nullptr);
    wglDeleteContext(surface->gl_context);
    surface->gl_context = nullptr;
  }
  if (surface->dc && surface->hwnd) {
    ReleaseDC(surface->hwnd, surface->dc);
    surface->dc = nullptr;
  }
  if (surface->hwnd) {
    SetWindowLongPtrA(surface->hwnd, GWLP_USERDATA, 0);
    DestroyWindow(surface->hwnd);
    surface->hwnd = nullptr;
  }
  delete surface;
}

void* surface_get_proc_address(NativeSurface* surface, const char* name) {
  if (!name) return nullptr;
  void* address = reinterpret_cast<void*>(wglGetProcAddress(name));
  if (address) return address;

  static HMODULE opengl = LoadLibraryA("opengl32.dll");
  return reinterpret_cast<void*>(GetProcAddress(opengl, name));
}

void surface_make_current(NativeSurface* surface) {
  if (!surface) return;
  wglMakeCurrent(surface->dc, surface->gl_context);
}

void surface_swap_buffers(NativeSurface* surface) {
  if (surface) SwapBuffers(surface->dc);
}

int surface_width(NativeSurface* surface) {
  return surface ? surface->bounds.width : 0;
}

int surface_height(NativeSurface* surface) {
  return surface ? surface->bounds.height : 0;
}

void surface_configure_window(void* parent_handle) {
  // No-op on Windows
}

#endif
