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
#include <dlfcn.h>
#include <string>

struct NativeSurface;
@class FrameZooOpenGLLayer;

@interface FrameZooOpenGLLayer : CAOpenGLLayer
@property(nonatomic, assign) NativeSurface* surface;
@property(nonatomic, assign) CGLContextObj glContext;
@property(nonatomic, assign) CGLPixelFormatObj glPixelFormat;
@end

@interface FrameZooMpvView : NSView
@property(nonatomic, assign) NativeSurface* surface;
@property(nonatomic, retain) FrameZooOpenGLLayer* glLayer;
@property(atomic, assign) double cachedMaxPotentialEdr;
@property(atomic, assign) uint32_t cachedDisplayId;
- (void)updateScreenEdrProperties;
@end

struct NativeSurface {
  FrameZooMpvView* view = nil;
  NSView* anchor = nil;
  NSView* host = nil;
  SurfaceBounds bounds{};
  std::atomic<double> backing_scale_factor{1.0};
  std::atomic<uint64_t> paint_count{0};
  std::atomic<bool> paint_requested{false};
  bool is_float_format = false;
  GLint current_fbo = 0;
  CGLContextObj gl_context = nullptr;
  CGLPixelFormatObj gl_pixel_format = nullptr;
  SurfacePaintCallback paint_callback = nullptr;
  void* user = nullptr;
};

void update_backing_scale_factor(NativeSurface* surface) {
  if (!surface || !surface->view) return;

  NSWindow* window = surface->view.window;
  if (window) {
    surface->backing_scale_factor.store(
        std::max<CGFloat>(1.0, window.backingScaleFactor),
        std::memory_order_relaxed
    );
  } else if (NSScreen* screen = NSScreen.mainScreen) {
    surface->backing_scale_factor.store(
        std::max<CGFloat>(1.0, screen.backingScaleFactor),
        std::memory_order_relaxed
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
  if (surface->view.glLayer) {
    surface->view.glLayer.contentsScale =
        surface->backing_scale_factor.load(std::memory_order_relaxed);
  }
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
  (void)mask;
  return self.glPixelFormat ? CGLRetainPixelFormat(self.glPixelFormat) : nullptr;
}

- (void)releaseCGLPixelFormat:(CGLPixelFormatObj)pixelFormat {
  if (pixelFormat) {
    CGLReleasePixelFormat(pixelFormat);
  }
}

- (CGLContextObj)copyCGLContextForPixelFormat:(CGLPixelFormatObj)pixelFormat {
  (void)pixelFormat;
  return self.glContext ? CGLRetainContext(self.glContext) : nullptr;
}

- (void)releaseCGLContext:(CGLContextObj)glContext {
  if (glContext) {
    CGLReleaseContext(glContext);
  }
}

- (BOOL)canDrawInCGLContext:(CGLContextObj)glContext
                pixelFormat:(CGLPixelFormatObj)pixelFormat
               forLayerTime:(CFTimeInterval)timeInterval
                displayTime:(const CVTimeStamp*)timeStamp {
  (void)glContext;
  (void)pixelFormat;
  (void)timeInterval;
  (void)timeStamp;
  NativeSurface* surface = self.surface;
  return (surface && surface->paint_callback && surface->user);
}

- (void)drawInCGLContext:(CGLContextObj)glContext
             pixelFormat:(CGLPixelFormatObj)pixelFormat
            forLayerTime:(CFTimeInterval)timeInterval
             displayTime:(const CVTimeStamp*)timeStamp {
  NativeSurface* surface = self.surface;
  if (!surface || !surface->paint_callback || !surface->user) return;
  surface->paint_requested.store(false, std::memory_order_relaxed);

  const uint64_t paint_number = surface->paint_count.fetch_add(1) + 1;
  CGLSetCurrentContext(glContext);
  GLint current_fbo = 0;
  glGetIntegerv(GL_FRAMEBUFFER_BINDING, &current_fbo);
  surface->current_fbo = current_fbo;

  const int width = surface_width(surface);
  const int height = surface_height(surface);
  if (paint_number <= 5 || paint_number % 60 == 0) {
    std::fprintf(
        stderr,
        "[libmpv-native] drawInCGLContext count=%llu fbo=%d backing=%dx%d bounds=(%.0f,%.0f %.0fx%.0f)\n",
        static_cast<unsigned long long>(paint_number),
        current_fbo,
        width,
        height,
        self.frame.origin.x,
        self.frame.origin.y,
        self.frame.size.width,
        self.frame.size.height
    );
  }

  glViewport(0, 0, width, height);
  surface->paint_callback(surface->user, surface);

  [super drawInCGLContext:glContext
              pixelFormat:pixelFormat
             forLayerTime:timeInterval
              displayTime:timeStamp];
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

- (void)updateScreenEdrProperties {
  NSScreen* screen = self.window ? self.window.screen : NSScreen.mainScreen;
  if (!screen) return;
  double max_edr = 1.0;
  if ([screen respondsToSelector:@selector(maximumPotentialExtendedDynamicRangeColorComponentValue)]) {
    max_edr = screen.maximumPotentialExtendedDynamicRangeColorComponentValue;
  }
  self.cachedMaxPotentialEdr = max_edr;
  NSDictionary* desc = screen.deviceDescription;
  NSNumber* screen_number = desc ? [desc objectForKey:@"NSScreenNumber"] : nil;
  self.cachedDisplayId = screen_number ? [screen_number unsignedIntValue] : 0;
}

- (void)viewDidMoveToWindow {
  [super viewDidMoveToWindow];
  [self updateScreenEdrProperties];
  if (self.glLayer) {
    self.glLayer.contentsScale =
        self.window ? self.window.backingScaleFactor : NSScreen.mainScreen.backingScaleFactor;
  }
  if (self.window) {
    [NSNotificationCenter.defaultCenter
        removeObserver:self
                  name:NSWindowDidChangeScreenNotification
                object:nil];
    [NSNotificationCenter.defaultCenter
        addObserver:self
           selector:@selector(windowDidChangeScreen:)
               name:NSWindowDidChangeScreenNotification
             object:self.window];
  }
}

- (void)windowDidChangeScreen:(NSNotification*)note {
  (void)note;
  [self updateScreenEdrProperties];
  if (self.glLayer) {
    self.glLayer.contentsScale =
        self.window ? self.window.backingScaleFactor : NSScreen.mainScreen.backingScaleFactor;
    [self.glLayer setNeedsDisplay];
  }
}

- (void)dealloc {
  [NSNotificationCenter.defaultCenter removeObserver:self];
  self.glLayer = nil;
  [super dealloc];
}

- (void)viewDidChangeBackingProperties {
  [super viewDidChangeBackingProperties];
  [self updateScreenEdrProperties];
  update_backing_scale_factor(self.surface);
  if (self.glLayer) {
    self.glLayer.contentsScale =
        self.window ? self.window.backingScaleFactor : NSScreen.mainScreen.backingScaleFactor;
    [self.glLayer setNeedsDisplay];
  }
}

@end

static uint32_t query_display_peak_nits(uint32_t display_id, double max_potential_edr) {
  uint32_t peak = 0;
  static void* core_display = dlopen(
      "/System/Library/Frameworks/CoreDisplay.framework/CoreDisplay",
      RTLD_LAZY | RTLD_LOCAL
  );
  if (core_display && display_id != 0) {
    using DisplayCreateInfoDictionaryFn = CFDictionaryRef (*)(uint32_t);
    static auto create_dict_fn = reinterpret_cast<DisplayCreateInfoDictionaryFn>(
        dlsym(core_display, "CoreDisplay_DisplayCreateInfoDictionary")
    );
    if (create_dict_fn) {
      CFDictionaryRef dict = create_dict_fn(display_id);
      if (dict) {
        CFNumberRef num = static_cast<CFNumberRef>(
            CFDictionaryGetValue(dict, CFSTR("NonReferencePeakHDRLuminance"))
        );
        if (!num) {
          num = static_cast<CFNumberRef>(
              CFDictionaryGetValue(dict, CFSTR("DisplayBacklight"))
          );
        }
        if (num) {
          int32_t val = 0;
          if (CFNumberGetValue(num, kCFNumberSInt32Type, &val) && val > 0) {
            peak = static_cast<uint32_t>(val);
          }
        }
        CFRelease(dict);
      }
    }
  }
  if (peak == 0) {
    if (max_potential_edr > 1.0) {
      peak = static_cast<uint32_t>(std::max(400.0, std::round(203.0 * max_potential_edr)));
    } else {
      peak = 203;
    }
  }
  return peak;
}

NativeSurface* surface_create(
    void* parent_handle,
    SurfaceBounds bounds,
    SurfacePaintCallback paint_callback,
    void* user
) {
  auto* parent = static_cast<NSView*>(parent_handle);
  if (!parent) return nullptr;

  CGLPixelFormatAttribute edr_attributes[] = {
      kCGLPFAOpenGLProfile,
      (CGLPixelFormatAttribute)kCGLOGLPVersion_3_2_Core,
      kCGLPFAAccelerated,
      kCGLPFADoubleBuffer,
      kCGLPFAColorSize,
      (CGLPixelFormatAttribute)64,
      kCGLPFAColorFloat,
      kCGLPFAAlphaSize,
      (CGLPixelFormatAttribute)16,
      (CGLPixelFormatAttribute)0,
  };
  GLint npix = 0;
  CGLPixelFormatObj pixel_format = nullptr;
  bool is_float = true;
  CGLError err = CGLChoosePixelFormat(edr_attributes, &pixel_format, &npix);
  if (err != kCGLNoError || !pixel_format) {
    CGLPixelFormatAttribute sdr_attributes[] = {
        kCGLPFAOpenGLProfile,
        (CGLPixelFormatAttribute)kCGLOGLPVersion_3_2_Core,
        kCGLPFAAccelerated,
        kCGLPFADoubleBuffer,
        kCGLPFAColorSize,
        (CGLPixelFormatAttribute)24,
        kCGLPFAAlphaSize,
        (CGLPixelFormatAttribute)8,
        (CGLPixelFormatAttribute)0,
    };
    CGLChoosePixelFormat(sdr_attributes, &pixel_format, &npix);
    is_float = false;
  }
  if (!pixel_format) return nullptr;

  CGLContextObj gl_context = nullptr;
  err = CGLCreateContext(pixel_format, nullptr, &gl_context);
  if (err != kCGLNoError || !gl_context) {
    CGLReleasePixelFormat(pixel_format);
    return nullptr;
  }

  GLint swap_interval = 1;
  CGLSetParameter(gl_context, kCGLCPSwapInterval, &swap_interval);

  auto* surface = new NativeSurface();
  surface->bounds = bounds;
  surface->paint_callback = paint_callback;
  surface->user = user;
  surface->is_float_format = is_float;
  surface->gl_context = gl_context;
  surface->gl_pixel_format = pixel_format;

  FrameZooOpenGLLayer* layer = [FrameZooOpenGLLayer layer];
  layer.surface = surface;
  layer.glContext = gl_context;
  layer.glPixelFormat = pixel_format;
  layer.asynchronous = NO;
  layer.contentsFormat = is_float ? kCAContentsFormatRGBA16Float : kCAContentsFormatRGBA8Uint;
  layer.needsDisplayOnBoundsChange = YES;
  layer.opaque = NO;
  layer.backgroundColor = NSColor.clearColor.CGColor;
  CGColorSpaceRef srgb = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  if (srgb) {
    layer.colorspace = srgb;
    CGColorSpaceRelease(srgb);
  }

  surface->view = [[FrameZooMpvView alloc] initWithFrame:NSZeroRect];
  surface->view.surface = surface;
  surface->view.glLayer = layer;
  surface->view.wantsLayer = YES;
  surface->view.layer = layer;
  surface->view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [surface->view updateScreenEdrProperties];

  attach_surface(surface, parent);
  [layer setNeedsDisplay];
  return surface;
}

void surface_resize(NativeSurface* surface, SurfaceBounds bounds) {
  if (!surface || !surface->view) return;
  surface->bounds = bounds;
  update_backing_scale_factor(surface);
  [surface->view setFrame:surface_frame_in_host(surface)];
  if (surface->view.glLayer) {
    surface->view.glLayer.contentsScale =
        surface->backing_scale_factor.load(std::memory_order_relaxed);
    [surface->view.glLayer setNeedsDisplay];
  }
}

void surface_reparent(NativeSurface* surface, void* parent_handle) {
  if (!surface || !surface->view || !parent_handle) return;
  auto* parent = static_cast<NSView*>(parent_handle);
  [surface->view removeFromSuperview];
  attach_surface(surface, parent);
  if (surface->view.glLayer) {
    [surface->view.glLayer setNeedsDisplay];
  }
}

void surface_request_paint(NativeSurface* surface) {
  if (!surface || !surface->view || !surface->view.glLayer || !surface->paint_callback || !surface->user) return;
  if (surface->paint_requested.exchange(true, std::memory_order_relaxed)) {
    return;
  }
  FrameZooOpenGLLayer* layer = surface->view.glLayer;
  [layer retain];
  auto run_block = ^{
    [layer setNeedsDisplay];
    [layer displayIfNeeded];
    [layer release];
  };
  if ([NSThread isMainThread]) {
    run_block();
  } else {
    dispatch_async(dispatch_get_main_queue(), run_block);
  }
}

void surface_disable_paint(NativeSurface* surface) {
  if (!surface) return;
  surface->paint_callback = nullptr;
  surface->user = nullptr;
}

void surface_destroy(NativeSurface* surface) {
  if (!surface) return;
  surface_disable_paint(surface);
  if (surface->view) {
    surface->view.surface = nullptr;
    if (surface->view.glLayer) {
      surface->view.glLayer.surface = nullptr;
      surface->view.glLayer = nil;
    }
    [surface->view removeFromSuperview];
    [surface->view release];
    surface->view = nil;
  }
  if (surface->gl_context) {
    CGLReleaseContext(surface->gl_context);
    surface->gl_context = nullptr;
  }
  if (surface->gl_pixel_format) {
    CGLReleasePixelFormat(surface->gl_pixel_format);
    surface->gl_pixel_format = nullptr;
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
  (void)surface;
}

int surface_width(NativeSurface* surface) {
  if (!surface || !surface->view) return 0;
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

SurfaceEdrInfo surface_query_edr(NativeSurface* surface) {
  SurfaceEdrInfo info{};
  if (!surface || !surface->view) return info;

  FrameZooMpvView* view = surface->view;
  double max_potential_edr = view.cachedMaxPotentialEdr;
  uint32_t display_id = view.cachedDisplayId;

  if (max_potential_edr <= 0.0) {
    NSScreen* screen = view.window ? view.window.screen : NSScreen.mainScreen;
    if (screen && [screen respondsToSelector:@selector(maximumPotentialExtendedDynamicRangeColorComponentValue)]) {
      max_potential_edr = screen.maximumPotentialExtendedDynamicRangeColorComponentValue;
    } else {
      max_potential_edr = 1.0;
    }
    NSDictionary* desc = screen ? screen.deviceDescription : nil;
    NSNumber* screen_number = desc ? [desc objectForKey:@"NSScreenNumber"] : nil;
    display_id = screen_number ? [screen_number unsignedIntValue] : 0;
  }

  info.max_potential_edr = max_potential_edr;
  info.edr_supported = (max_potential_edr > 1.0);
  info.peak_nits = query_display_peak_nits(display_id, max_potential_edr);
  return info;
}

void surface_set_hdr_mode(NativeSurface* surface, bool enable_hdr, const char* primaries) {
  if (!surface || !surface->view || !surface->view.glLayer) return;
  std::string prim = primaries ? primaries : "";
  FrameZooOpenGLLayer* layer = surface->view.glLayer;
  [layer retain];

  auto apply_block = ^{
    if (enable_hdr) {
      CGColorSpaceRef cs = nullptr;
      if (prim == "display-p3") {
        cs = CGColorSpaceCreateWithName(kCGColorSpaceDisplayP3_PQ);
      } else {
        cs = CGColorSpaceCreateWithName(kCGColorSpaceITUR_2100_PQ);
      }
      if (cs) {
        layer.colorspace = cs;
        CGColorSpaceRelease(cs);
      }
      if (surface->is_float_format) {
        layer.contentsFormat = kCAContentsFormatRGBA16Float;
      }
      @try {
        [layer setValue:@YES forKey:@"wantsExtendedDynamicRangeContent"];
      } @catch (id) {}
      std::fprintf(
          stderr,
          "[libmpv-native] surface_set_hdr_mode ENABLED primaries=%s cs=%s\n",
          prim.c_str(),
          prim == "display-p3" ? "DisplayP3_PQ" : "ITUR_2100_PQ"
      );
    } else {
      CGColorSpaceRef cs = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
      if (cs) {
        layer.colorspace = cs;
        CGColorSpaceRelease(cs);
      }
      @try {
        [layer setValue:@NO forKey:@"wantsExtendedDynamicRangeContent"];
      } @catch (id) {}
      std::fprintf(stderr, "[libmpv-native] surface_set_hdr_mode DISABLED (sRGB)\n");
    }
    [layer setNeedsDisplay];
    [layer release];
  };

  if ([NSThread isMainThread]) {
    apply_block();
  } else {
    dispatch_async(dispatch_get_main_queue(), apply_block);
  }
}

int surface_fbo_internal_format(NativeSurface* surface) {
  if (!surface) return 0;
  return surface->is_float_format ? 0x881A /* GL_RGBA16F */ : 0;
}

int surface_depth(NativeSurface* surface) {
  if (!surface) return 0;
  return surface->is_float_format ? 16 : 8;
}

int surface_current_fbo(NativeSurface* surface) {
  return surface ? surface->current_fbo : 0;
}

#endif
