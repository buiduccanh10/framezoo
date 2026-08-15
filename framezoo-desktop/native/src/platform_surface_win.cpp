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
        case WM_USER + 101:
        case WM_PAINT: {
          PAINTSTRUCT paint{};
          if (message == WM_PAINT) {
            BeginPaint(hwnd, &paint);
          }
          if (surface && surface->paint_callback) {
            const uint64_t paint_number =
                surface->paint_count.fetch_add(1) + 1;
            if (paint_number <= 5 || paint_number % 60 == 0) {
              std::fprintf(
                  stderr,
                  "[libmpv-native] paint count=%llu frame=%dx%d msg=%u\n",
                  static_cast<unsigned long long>(paint_number),
                  surface->bounds.width,
                  surface->bounds.height,
                  static_cast<unsigned int>(message)
              );
            }
            if (surface->gl_context && surface->dc) {
              wglMakeCurrent(surface->dc, surface->gl_context);
            }
            surface->paint_callback(surface->user, surface);
          }
          if (message == WM_PAINT) {
            EndPaint(hwnd, &paint);
          }
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

#define WGL_CONTEXT_MAJOR_VERSION_ARB 0x2091
#define WGL_CONTEXT_MINOR_VERSION_ARB 0x2092
#define WGL_CONTEXT_FLAGS_ARB 0x2094
#define WGL_CONTEXT_PROFILE_MASK_ARB 0x9126
#define WGL_CONTEXT_CORE_PROFILE_BIT_ARB 0x00000001

typedef HGLRC(WINAPI* PFNWGLCREATECONTEXTATTRIBSARBPROC)(
    HDC hDC,
    HGLRC hShareContext,
    const int* attribList
);

HGLRC create_modern_gl_context(HDC dc) {
  HGLRC temp_context = wglCreateContext(dc);
  if (!temp_context) return nullptr;
  wglMakeCurrent(dc, temp_context);

  auto wglCreateContextAttribsARB =
      reinterpret_cast<PFNWGLCREATECONTEXTATTRIBSARBPROC>(
          wglGetProcAddress("wglCreateContextAttribsARB")
      );

  if (wglCreateContextAttribsARB) {
    const int attribs_33[] = {
        WGL_CONTEXT_MAJOR_VERSION_ARB, 3,
        WGL_CONTEXT_MINOR_VERSION_ARB, 3,
        WGL_CONTEXT_PROFILE_MASK_ARB, WGL_CONTEXT_CORE_PROFILE_BIT_ARB,
        0
    };
    HGLRC core_context = wglCreateContextAttribsARB(dc, nullptr, attribs_33);
    if (core_context) {
      wglMakeCurrent(nullptr, nullptr);
      wglDeleteContext(temp_context);
      wglMakeCurrent(dc, core_context);
      return core_context;
    }

    const int attribs_30[] = {
        WGL_CONTEXT_MAJOR_VERSION_ARB, 3,
        WGL_CONTEXT_MINOR_VERSION_ARB, 0,
        0
    };
    core_context = wglCreateContextAttribsARB(dc, nullptr, attribs_30);
    if (core_context) {
      wglMakeCurrent(nullptr, nullptr);
      wglDeleteContext(temp_context);
      wglMakeCurrent(dc, core_context);
      return core_context;
    }
  }

  return temp_context;
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

  surface->gl_context = create_modern_gl_context(surface->dc);
  if (!surface->gl_context) {
    std::fprintf(
        stderr,
        "[libmpv-native] surface_create: create_modern_gl_context failed (err %lu)\n",
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
      nullptr,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      SWP_NOACTIVATE | SWP_NOZORDER | SWP_SHOWWINDOW
  );
  surface_request_paint(surface);
}

void surface_reparent(NativeSurface* surface, void* parent_handle) {
  if (!surface || !surface->hwnd || !parent_handle) return;
  surface->parent = static_cast<HWND>(parent_handle);
  SetParent(surface->hwnd, surface->parent);
  SetWindowPos(
      surface->hwnd,
      nullptr,
      0,
      0,
      surface->bounds.width,
      surface->bounds.height,
      SWP_NOACTIVATE | SWP_NOZORDER | SWP_SHOWWINDOW
  );
  surface_request_paint(surface);
}

void surface_request_paint(NativeSurface* surface) {
  if (!surface || !surface->hwnd) return;
  PostMessageA(surface->hwnd, WM_USER + 101, 0, 0);
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

void* surface_get_proc_address(NativeSurface*, const char* name) {
  if (!name) return nullptr;
  void* address = reinterpret_cast<void*>(wglGetProcAddress(name));
  if (address &&
      address != reinterpret_cast<void*>(1) &&
      address != reinterpret_cast<void*>(2) &&
      address != reinterpret_cast<void*>(3) &&
      address != reinterpret_cast<void*>(-1)) {
    return address;
  }

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

int surface_blit_rgb0(NativeSurface* surface, const void* rgb0, size_t stride) {
  (void)stride;
  if (!surface || !surface->hwnd || !rgb0) return 0;
  const int width = surface->bounds.width;
  const int height = surface->bounds.height;
  if (width <= 0 || height <= 0) return 0;

  BITMAPINFO bitmap_info{};
  bitmap_info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
  bitmap_info.bmiHeader.biWidth = width;
  bitmap_info.bmiHeader.biHeight = -height;  // top-down
  bitmap_info.bmiHeader.biPlanes = 1;
  bitmap_info.bmiHeader.biBitCount = 32;
  bitmap_info.bmiHeader.biCompression = BI_RGB;

  HDC dc = GetDC(surface->hwnd);
  if (!dc) return 0;
  const int lines = SetDIBitsToDevice(
      dc,
      0,
      0,
      width,
      height,
      0,
      0,
      0,
      height,
      rgb0,
      &bitmap_info,
      DIB_RGB_COLORS
  );
  ReleaseDC(surface->hwnd, dc);
  if (lines != height) {
    std::fprintf(
        stderr,
        "[libmpv-native] surface_blit_rgb0: SetDIBitsToDevice failed "
        "(lines=%d/%d err %lu)\n",
        lines,
        height,
        static_cast<unsigned long>(GetLastError())
    );
    return 0;
  }
  return 1;
}

#endif
