#pragma once

#include "mpv_abi.h"

struct NativeSurface;
using SurfacePaintCallback = void (*)(void* user, NativeSurface* surface);

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
void surface_disable_paint(NativeSurface* surface);
void surface_destroy(NativeSurface* surface);
void* surface_get_proc_address(NativeSurface* surface, const char* name);
void surface_make_current(NativeSurface* surface);
void surface_swap_buffers(NativeSurface* surface);
int surface_width(NativeSurface* surface);
int surface_height(NativeSurface* surface);
void surface_configure_window(void* parent_handle);
