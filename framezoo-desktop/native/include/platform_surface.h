#pragma once

#include <cstdint>

#include "mpv_abi.h"

struct NativeSurface;
using SurfacePaintCallback = void (*)(void* user, NativeSurface* surface);
#if defined(__APPLE__)
using SurfaceDisplayChangeCallback = void (*)(void* user);
#endif

struct SurfaceBounds {
  int x;
  int y;
  int width;
  int height;
};

NativeSurface* surface_create(
    void* parent_handle,
    SurfaceBounds bounds,
    SurfacePaintCallback paint_callback,
    void* user
);
void surface_resize(NativeSurface* surface, SurfaceBounds bounds);
void surface_reparent(NativeSurface* surface, void* parent_handle);
void surface_request_paint(NativeSurface* surface);
// Re-sync the native surface after the OS (or its displays) wakes from sleep:
// clears stuck paint state, refreshes GL/EDR/window state and forces a redraw.
void surface_notify_system_wake(NativeSurface* surface);
void surface_disable_paint(NativeSurface* surface);
void surface_destroy(NativeSurface* surface);
void* surface_get_proc_address(NativeSurface* surface, const char* name);
void surface_make_current(NativeSurface* surface);
void surface_swap_buffers(NativeSurface* surface);
int surface_width(NativeSurface* surface);
int surface_height(NativeSurface* surface);
void* surface_native_handle(NativeSurface* surface);
void surface_configure_window(void* parent_handle);

#if defined(__APPLE__)
struct SurfaceHdrInfo {
  bool supported = false;
  bool float_pixel_format = false;
  double max_potential_edr = 1.0;
  uint32_t display_id = 0;
};

int surface_current_fbo(NativeSurface* surface);
int surface_fbo_internal_format(NativeSurface* surface);
int surface_fbo_depth(NativeSurface* surface);
SurfaceHdrInfo surface_hdr_info(NativeSurface* surface);
void surface_set_display_change_callback(
    NativeSurface* surface,
    SurfaceDisplayChangeCallback callback,
    void* user
);
void surface_set_hdr_mode(
    NativeSurface* surface,
    bool enabled,
    const char* gamma,
    const char* primaries
);
#endif

#if defined(_WIN32)
// Blit a packed top-down 32-bit RGB0 buffer into the surface window using GDI
// (works even with software-only display drivers, e.g. VMs/remote desktop).
// Returns 1 on success, 0 on failure.
int surface_blit_rgb0(NativeSurface* surface, const void* rgb0, size_t stride);
#endif
