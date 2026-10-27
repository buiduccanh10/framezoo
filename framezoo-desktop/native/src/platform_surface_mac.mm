#if defined(__APPLE__)

#define GL_SILENCE_DEPRECATION 1

#include "platform_surface.h"

#import <Cocoa/Cocoa.h>
#import <CoreGraphics/CoreGraphics.h>
#import <OpenGL/OpenGL.h>
#import <OpenGL/gl3.h>
#import <QuartzCore/QuartzCore.h>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <dlfcn.h>
#include <memory>

struct NativeSurface;

@interface FrameZooOpenGLLayer : CAOpenGLLayer
@property(nonatomic, assign) NativeSurface* surface;
@end

@interface FrameZooMpvView : NSView
@property(nonatomic, assign) NativeSurface* surface;
@end

struct NativeSurface {
  FrameZooMpvView* view = nil;
  FrameZooOpenGLLayer* gl_layer = nil;
  NSView* anchor = nil;
  NSView* host = nil;
  CGLPixelFormatObj pixel_format = nullptr;
  CGLContextObj gl_context = nullptr;
  SurfaceBounds bounds{};
  bool float_pixel_format = false;
  std::atomic<int> current_fbo{0};
  std::atomic<int> drawable_width{0};
  std::atomic<int> drawable_height{0};
  std::atomic<double> backing_scale_factor{1.0};
  std::atomic<double> max_potential_edr{1.0};
  std::atomic<uint32_t> display_id{0};
  std::atomic<uint64_t> paint_count{0};
  std::shared_ptr<std::atomic<bool>> paint_requested =
      std::make_shared<std::atomic<bool>>(false);
  SurfacePaintCallback paint_callback = nullptr;
  void* user = nullptr;
  std::atomic<SurfaceDisplayChangeCallback> display_change_callback{nullptr};
  std::atomic<void*> display_change_user{nullptr};
};

void update_backing_scale_factor(NativeSurface* surface) {
  if (!surface || !surface->view) return;

  double scale = 1.0;
  NSWindow* window = surface->view.window;
  if (window) {
    scale = std::max<CGFloat>(1.0, window.backingScaleFactor);
  } else if (NSScreen* screen = NSScreen.mainScreen) {
    scale = std::max<CGFloat>(1.0, screen.backingScaleFactor);
  }
  surface->backing_scale_factor.store(scale, std::memory_order_relaxed);
  surface->drawable_width.store(0, std::memory_order_relaxed);
  surface->drawable_height.store(0, std::memory_order_relaxed);
  if (surface->gl_layer && surface->gl_layer.contentsScale != scale) {
    surface->gl_layer.contentsScale = scale;
  }
}

void update_display_hdr_capabilities(NativeSurface* surface) {
  if (!surface || !surface->view) return;

  NSScreen* screen = surface->view.window
      ? surface->view.window.screen
      : NSScreen.mainScreen;
  double max_potential_edr = 1.0;
  if (
      screen &&
      [screen respondsToSelector:@selector(
          maximumPotentialExtendedDynamicRangeColorComponentValue)]
  ) {
    max_potential_edr = std::max(
        1.0,
        screen.maximumPotentialExtendedDynamicRangeColorComponentValue
    );
  }
  NSDictionary* description = screen ? screen.deviceDescription : nil;
  NSNumber* screen_number = description
      ? [description objectForKey:@"NSScreenNumber"]
      : nil;
  const double previous_max_potential_edr = surface->max_potential_edr.load(
      std::memory_order_relaxed
  );
  const uint32_t previous_display_id = surface->display_id.load(
      std::memory_order_relaxed
  );
  const uint32_t display_id =
      screen_number ? screen_number.unsignedIntValue : 0;
  surface->max_potential_edr.store(
      max_potential_edr,
      std::memory_order_relaxed
  );
  surface->display_id.store(
      display_id,
      std::memory_order_relaxed
  );
  const auto callback = surface->display_change_callback.load(
      std::memory_order_acquire
  );
  if (
      (previous_max_potential_edr != max_potential_edr ||
       previous_display_id != display_id) &&
      callback
  ) {
    callback(
        surface->display_change_user.load(std::memory_order_acquire)
    );
  }
}

NSRect surface_frame_in_host(NativeSurface* surface) {
  NSRect local_frame = NSMakeRect(
      surface->bounds.x,
      surface->bounds.y,
      surface->bounds.width,
      surface->bounds.height
  );
  if (surface->anchor && surface->host) {
    return [surface->anchor convertRect:local_frame toView:surface->host];
  }
  return local_frame;
}

void attach_surface(NativeSurface* surface, NSView* anchor) {
  if (!surface || !surface->view || !anchor) return;

  surface->anchor = anchor;
  // Electron returns the content view on macOS. Attach inside that view so
  // the Chromium view remains above the native playback surface.
  surface->host = anchor;
  NSView* chromium_view = nil;
  for (NSView* sibling in anchor.subviews) {
    if (sibling != surface->view) {
      chromium_view = sibling;
      break;
    }
  }
  [anchor addSubview:surface->view
         positioned:NSWindowBelow
         relativeTo:chromium_view];
  update_backing_scale_factor(surface);
  [surface->view setFrame:surface_frame_in_host(surface)];
  const NSRect backing_frame =
      [surface->view convertRectToBacking:surface->view.bounds];
  std::fprintf(
      stderr,
      "[libmpv-native] surface_attach anchor=%p host=%p superview=%p subviews=%lu "
      "frame=(%.0f,%.0f %.0fx%.0f) backing=(%d,%d) scale=%.2f\n",
      static_cast<void*>(anchor),
      static_cast<void*>(surface->host),
      static_cast<void*>([anchor superview]),
      static_cast<unsigned long>(anchor.subviews.count),
      surface->view.frame.origin.x,
      surface->view.frame.origin.y,
      surface->view.frame.size.width,
      surface->view.frame.size.height,
      static_cast<int>(std::ceil(backing_frame.size.width)),
      static_cast<int>(std::ceil(backing_frame.size.height)),
      surface->backing_scale_factor.load(std::memory_order_relaxed)
  );
}

@implementation FrameZooOpenGLLayer

- (CGLPixelFormatObj)copyCGLPixelFormatForDisplayMask:(uint32_t)mask {
  NativeSurface* surface = self.surface;
  if (surface && surface->pixel_format) {
    CGLRetainPixelFormat(surface->pixel_format);
    return surface->pixel_format;
  }
  return [super copyCGLPixelFormatForDisplayMask:mask];
}

- (CGLContextObj)copyCGLContextForPixelFormat:(CGLPixelFormatObj)pf {
  NativeSurface* surface = self.surface;
  if (surface && surface->gl_context) {
    CGLRetainContext(surface->gl_context);
    return surface->gl_context;
  }
  return [super copyCGLContextForPixelFormat:pf];
}

- (BOOL)canDrawInCGLContext:(CGLContextObj)ctx
                pixelFormat:(CGLPixelFormatObj)pf
               forLayerTime:(CFTimeInterval)t
                displayTime:(const CVTimeStamp*)ts {
  (void)ctx;
  (void)pf;
  (void)t;
  (void)ts;
  NativeSurface* surface = self.surface;
  return (surface && surface->paint_callback && surface->user) ? YES : NO;
}

- (void)drawInCGLContext:(CGLContextObj)ctx
             pixelFormat:(CGLPixelFormatObj)pf
            forLayerTime:(CFTimeInterval)t
             displayTime:(const CVTimeStamp*)ts {
  NativeSurface* surface = self.surface;
  if (!surface || !surface->paint_callback || !surface->user) {
    return;
  }
  surface->paint_requested->store(false, std::memory_order_relaxed);

  CGLSetCurrentContext(ctx);
  GLint bound_fbo = 0;
  glGetIntegerv(GL_DRAW_FRAMEBUFFER_BINDING, &bound_fbo);
  GLint viewport[4] = {0, 0, 0, 0};
  glGetIntegerv(GL_VIEWPORT, viewport);
  surface->current_fbo.store(bound_fbo, std::memory_order_relaxed);
  if (viewport[2] > 0 && viewport[3] > 0) {
    surface->drawable_width.store(viewport[2], std::memory_order_relaxed);
    surface->drawable_height.store(viewport[3], std::memory_order_relaxed);
  }

  const uint64_t paint_number = surface->paint_count.fetch_add(1) + 1;
  if (paint_number <= 5 || paint_number % 60 == 0) {
    std::fprintf(
        stderr,
        "[libmpv-native] paint count=%llu fbo=%d frame=(%.0f,%.0f %.0fx%.0f) "
        "backing=%dx%d\n",
        static_cast<unsigned long long>(paint_number),
        bound_fbo,
        surface->view ? surface->view.frame.origin.x : 0.0,
        surface->view ? surface->view.frame.origin.y : 0.0,
        surface->view ? surface->view.frame.size.width : 0.0,
        surface->view ? surface->view.frame.size.height : 0.0,
        surface_width(surface),
        surface_height(surface)
    );
  }

  surface->paint_callback(surface->user, surface);

  glBindFramebuffer(GL_FRAMEBUFFER, static_cast<GLuint>(bound_fbo));
  [super drawInCGLContext:ctx pixelFormat:pf forLayerTime:t displayTime:ts];
}

@end

@implementation FrameZooMpvView

- (BOOL)isFlipped {
  return YES;
}

- (NSView*)hitTest:(NSPoint)point {
  (void)point;
  return nil;
}

- (void)viewDidChangeBackingProperties {
  [super viewDidChangeBackingProperties];
  update_backing_scale_factor(self.surface);
  update_display_hdr_capabilities(self.surface);
  if (self.surface && self.surface->gl_layer) {
    [self.surface->gl_layer setNeedsDisplay];
  }
}

- (void)viewDidMoveToWindow {
  [super viewDidMoveToWindow];
  [NSNotificationCenter.defaultCenter removeObserver:self];
  if (self.window) {
    [NSNotificationCenter.defaultCenter addObserver:self
                                           selector:@selector(windowDidChangeScreen:)
                                               name:NSWindowDidChangeScreenNotification
                                             object:self.window];
    [NSNotificationCenter.defaultCenter addObserver:self
                                           selector:@selector(windowDidChangeScreen:)
                                               name:NSApplicationDidChangeScreenParametersNotification
                                             object:nil];
  }
  update_backing_scale_factor(self.surface);
  update_display_hdr_capabilities(self.surface);
  if (self.surface && self.surface->gl_layer) {
    [self.surface->gl_layer setNeedsDisplay];
  }
}

- (void)windowDidChangeScreen:(NSNotification*)note {
  (void)note;
  update_backing_scale_factor(self.surface);
  update_display_hdr_capabilities(self.surface);
  if (self.surface && self.surface->gl_layer) {
    [self.surface->gl_layer setNeedsDisplay];
  }
}

- (void)dealloc {
  [NSNotificationCenter.defaultCenter removeObserver:self];
  [super dealloc];
}

@end

NativeSurface* surface_create(
    void* parent_handle,
    SurfaceBounds bounds,
    SurfacePaintCallback paint_callback,
    void* user
) {
  auto* parent = static_cast<NSView*>(parent_handle);
  if (!parent) return nullptr;

  CGLPixelFormatObj pixel_format = nullptr;
  GLint num_pixel_formats = 0;
  const CGLPixelFormatAttribute hdr_attributes[] = {
      kCGLPFAOpenGLProfile,
      static_cast<CGLPixelFormatAttribute>(kCGLOGLPVersion_3_2_Core),
      kCGLPFAAccelerated,
      kCGLPFADoubleBuffer,
      kCGLPFAColorSize,
      static_cast<CGLPixelFormatAttribute>(64),
      kCGLPFAAlphaSize,
      static_cast<CGLPixelFormatAttribute>(16),
      kCGLPFAColorFloat,
      kCGLPFAAllowOfflineRenderers,
      static_cast<CGLPixelFormatAttribute>(0),
  };
  CGLError error = CGLChoosePixelFormat(
      hdr_attributes,
      &pixel_format,
      &num_pixel_formats
  );
  bool float_pixel_format = (error == kCGLNoError && pixel_format != nullptr);
  if (!float_pixel_format) {
    const CGLPixelFormatAttribute sdr_attributes[] = {
        kCGLPFAOpenGLProfile,
        static_cast<CGLPixelFormatAttribute>(kCGLOGLPVersion_3_2_Core),
        kCGLPFAAccelerated,
        kCGLPFADoubleBuffer,
        kCGLPFAColorSize,
        static_cast<CGLPixelFormatAttribute>(24),
        kCGLPFAAlphaSize,
        static_cast<CGLPixelFormatAttribute>(8),
        kCGLPFAAllowOfflineRenderers,
        static_cast<CGLPixelFormatAttribute>(0),
    };
    error = CGLChoosePixelFormat(
        sdr_attributes,
        &pixel_format,
        &num_pixel_formats
    );
    if (error != kCGLNoError || !pixel_format) {
      return nullptr;
    }
  }

  CGLContextObj gl_context = nullptr;
  error = CGLCreateContext(pixel_format, nullptr, &gl_context);
  if (error != kCGLNoError || !gl_context) {
    CGLReleasePixelFormat(pixel_format);
    return nullptr;
  }
  GLint swap_interval = 1;
  CGLSetParameter(gl_context, kCGLCPSwapInterval, &swap_interval);

  auto* surface = new NativeSurface();
  surface->bounds = bounds;
  surface->pixel_format = pixel_format;
  surface->gl_context = gl_context;
  surface->float_pixel_format = float_pixel_format;
  surface->paint_callback = paint_callback;
  surface->user = user;

  surface->view = [[FrameZooMpvView alloc] initWithFrame:NSZeroRect];
  if (!surface->view) {
    CGLReleaseContext(gl_context);
    CGLReleasePixelFormat(pixel_format);
    delete surface;
    return nullptr;
  }
  surface->view.surface = surface;
  surface->view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;

  surface->gl_layer = [[FrameZooOpenGLLayer alloc] init];
  surface->gl_layer.surface = surface;
  surface->gl_layer.opaque = YES;
  surface->gl_layer.asynchronous = NO;
  surface->gl_layer.needsDisplayOnBoundsChange = YES;
  surface->gl_layer.contentsFormat = float_pixel_format
      ? kCAContentsFormatRGBA16Float
      : kCAContentsFormatRGBA8Uint;
  CGColorSpaceRef srgb = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  if (srgb) {
    surface->gl_layer.colorspace = srgb;
    CGColorSpaceRelease(srgb);
  }
  if (
      [surface->gl_layer respondsToSelector:@selector(
          setWantsExtendedDynamicRangeContent:)]
  ) {
    surface->gl_layer.wantsExtendedDynamicRangeContent = NO;
  }

  surface->view.wantsLayer = YES;
  [surface->view setLayer:surface->gl_layer];

  attach_surface(surface, parent);
  update_display_hdr_capabilities(surface);
  std::fprintf(
      stderr,
      "[libmpv-native] surface_format layer=CAOpenGLLayer float=%d edr_max=%.2f\n",
      float_pixel_format ? 1 : 0,
      surface->max_potential_edr.load(std::memory_order_relaxed)
  );
  [surface->gl_layer setNeedsDisplay];
  return surface;
}

void surface_resize(NativeSurface* surface, SurfaceBounds bounds) {
  if (!surface || !surface->view) return;
  surface->bounds = bounds;
  surface->drawable_width.store(0, std::memory_order_relaxed);
  surface->drawable_height.store(0, std::memory_order_relaxed);
  update_backing_scale_factor(surface);
  update_display_hdr_capabilities(surface);
  [surface->view setFrame:surface_frame_in_host(surface)];
  if (surface->gl_layer) {
    [surface->gl_layer setNeedsDisplay];
  }
}

void surface_reparent(NativeSurface* surface, void* parent_handle) {
  if (!surface || !surface->view || !parent_handle) return;
  auto* parent = static_cast<NSView*>(parent_handle);
  [surface->view removeFromSuperview];
  attach_surface(surface, parent);
  update_display_hdr_capabilities(surface);
  if (surface->gl_layer) {
    [surface->gl_layer setNeedsDisplay];
  }
}

void surface_request_paint(NativeSurface* surface) {
  if (
      !surface ||
      !surface->view ||
      !surface->gl_layer ||
      !surface->paint_callback ||
      !surface->user
  ) {
    return;
  }
  const auto paint_requested = surface->paint_requested;
  FrameZooMpvView* view = surface->view;
  FrameZooOpenGLLayer* gl_layer = surface->gl_layer;
  if (paint_requested->exchange(true, std::memory_order_relaxed)) {
    return;
  }
  [view retain];
  [gl_layer retain];
  dispatch_async(dispatch_get_main_queue(), ^{
    paint_requested->store(false, std::memory_order_relaxed);
    if (view.surface && gl_layer.surface) {
      [gl_layer setNeedsDisplay];
    }
    [gl_layer release];
    [view release];
  });
}

void surface_disable_paint(NativeSurface* surface) {
  if (!surface) return;
  surface->paint_callback = nullptr;
  surface->user = nullptr;
  surface->display_change_callback.store(nullptr, std::memory_order_release);
  surface->display_change_user.store(nullptr, std::memory_order_release);
}

void surface_destroy(NativeSurface* surface) {
  if (!surface) return;
  surface_disable_paint(surface);
  if (surface->gl_layer) {
    surface->gl_layer.surface = nullptr;
    [surface->gl_layer release];
    surface->gl_layer = nil;
  }
  if (surface->view) {
    surface->view.surface = nullptr;
    [surface->view removeFromSuperview];
    [surface->view release];
    surface->view = nil;
  }
  if (surface->gl_context) {
    if (CGLGetCurrentContext() == surface->gl_context) {
      CGLSetCurrentContext(nullptr);
    }
    CGLReleaseContext(surface->gl_context);
    surface->gl_context = nullptr;
  }
  if (surface->pixel_format) {
    CGLReleasePixelFormat(surface->pixel_format);
    surface->pixel_format = nullptr;
  }
  delete surface;
}

void* surface_get_proc_address(NativeSurface*, const char* name) {
  if (!name) return nullptr;
  static void* opengl_library = dlopen(
      "/System/Library/Frameworks/OpenGL.framework/Versions/A/OpenGL",
      RTLD_LAZY | RTLD_LOCAL
  );
  return opengl_library ? dlsym(opengl_library, name) : nullptr;
}

void surface_make_current(NativeSurface* surface) {
  if (surface && surface->gl_context) {
    CGLSetCurrentContext(surface->gl_context);
  }
}

void surface_swap_buffers(NativeSurface* surface) {
  if (surface && surface->gl_context) {
    glFlush();
  }
}

int surface_width(NativeSurface* surface) {
  if (!surface || !surface->view) return 0;
  const int drawable_w = surface->drawable_width.load(std::memory_order_relaxed);
  if (drawable_w > 0) return drawable_w;
  return std::max(
      1,
      static_cast<int>(
          std::ceil(
              surface->bounds.width *
              surface->backing_scale_factor.load(std::memory_order_relaxed)
          )
      )
  );
}

int surface_height(NativeSurface* surface) {
  if (!surface || !surface->view) return 0;
  const int drawable_h = surface->drawable_height.load(std::memory_order_relaxed);
  if (drawable_h > 0) return drawable_h;
  return std::max(
      1,
      static_cast<int>(
          std::ceil(
              surface->bounds.height *
              surface->backing_scale_factor.load(std::memory_order_relaxed)
          )
      )
  );
}

int surface_current_fbo(NativeSurface* surface) {
  return surface ? surface->current_fbo.load(std::memory_order_relaxed) : 0;
}

int surface_fbo_internal_format(NativeSurface* surface) {
  if (!surface) return 0;
  return surface->float_pixel_format ? GL_RGBA16F : GL_RGBA8;
}

int surface_fbo_depth(NativeSurface* surface) {
  if (!surface) return 8;
  return surface->float_pixel_format ? 16 : 8;
}

void* surface_native_handle(NativeSurface* surface) {
  return surface ? static_cast<void*>(surface->view) : nullptr;
}

void surface_configure_window(void* parent_handle) {
  if (!parent_handle) return;
  NSView* anchor = static_cast<NSView*>(parent_handle);
  NSWindow* window = anchor.window;
  if (!window) return;

  [window setBackgroundColor:[NSColor colorWithSRGBRed:9.0 / 255.0
                                                 green:9.0 / 255.0
                                                  blue:11.0 / 255.0
                                                 alpha:1.0]];
  [window setHasShadow:YES];
}

SurfaceHdrInfo surface_hdr_info(NativeSurface* surface) {
  SurfaceHdrInfo info{};
  if (!surface || !surface->view) return info;
  info.float_pixel_format = surface->float_pixel_format;
  info.max_potential_edr = surface->max_potential_edr.load(
      std::memory_order_relaxed
  );
  info.display_id = surface->display_id.load(std::memory_order_relaxed);
  info.supported = info.float_pixel_format && info.max_potential_edr > 1.0;
  return info;
}

void surface_set_display_change_callback(
    NativeSurface* surface,
    SurfaceDisplayChangeCallback callback,
    void* user
) {
  if (!surface) return;
  surface->display_change_user.store(user, std::memory_order_release);
  surface->display_change_callback.store(callback, std::memory_order_release);
}

void surface_set_hdr_mode(
    NativeSurface* surface,
    bool enabled,
    const char* gamma,
    const char* primaries
) {
  if (!surface || !surface->view || !surface->gl_layer) return;

  FrameZooMpvView* view = surface->view;
  FrameZooOpenGLLayer* gl_layer = surface->gl_layer;
  const double max_potential_edr = surface->max_potential_edr.load(
      std::memory_order_relaxed
  );
  [view retain];
  [gl_layer retain];
  const bool use_display_p3 =
      primaries &&
      (std::strcmp(primaries, "display-p3") == 0 ||
       std::strcmp(primaries, "display-p3-pq") == 0);
  const bool use_hlg = gamma && std::strcmp(gamma, "hlg") == 0;
  void (^apply_mode)(void) = ^{
    if (!view.surface || !gl_layer.surface) {
      [gl_layer release];
      [view release];
      return;
    }

    CGColorSpaceRef color_space = nullptr;
    if (enabled) {
      if (use_hlg) {
        color_space = CGColorSpaceCreateWithName(
            use_display_p3 ? kCGColorSpaceDisplayP3_HLG
                           : kCGColorSpaceITUR_2100_HLG
        );
      } else {
        color_space = CGColorSpaceCreateWithName(
            use_display_p3 ? kCGColorSpaceDisplayP3_PQ
                           : kCGColorSpaceITUR_2100_PQ
        );
      }
    } else {
      color_space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    }

    if (color_space) {
      gl_layer.colorspace = color_space;
      CGColorSpaceRelease(color_space);
    }
    if (
        [gl_layer respondsToSelector:@selector(
            setWantsExtendedDynamicRangeContent:)]
    ) {
      gl_layer.wantsExtendedDynamicRangeContent = enabled ? YES : NO;
    }
    [gl_layer setNeedsDisplay];
    std::fprintf(
        stderr,
        "[libmpv-native] surface_hdr_mode enabled=%d colorspace=%s edr_max=%.2f\n",
        enabled ? 1 : 0,
        enabled
            ? (use_hlg
                   ? (use_display_p3 ? "display-p3-hlg" : "itur-2100-hlg")
                   : (use_display_p3 ? "display-p3-pq" : "itur-2100-pq"))
            : "srgb",
        max_potential_edr
    );
    [gl_layer release];
    [view release];
  };

  if ([NSThread isMainThread]) {
    apply_mode();
  } else {
    dispatch_async(dispatch_get_main_queue(), apply_mode);
  }
}

#endif
