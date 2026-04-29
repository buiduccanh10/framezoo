import { isExtensionActiveCached } from "@/backend/extension/messaging";
import {
  makeExtensionFetcher,
  makeLoadBalancedSimpleProxyFetcher,
  setupM3U8Proxy,
} from "@/backend/providers/fetchers";
import {
  buildProviders,
  flags,
  makeStandardFetcher,
  targets,
} from "@/lib/providers";

import {
  scrape111MoviesMovie,
  scrape111MoviesShow,
} from "./custom/sources/111moviesSource";
import {
  scrapeKKPhimMovie,
  scrapeKKPhimShow,
} from "./custom/sources/kkphimSource";
import { scrapeOpenMovieEmbed } from "./custom/sources/openMovieEmbed";
import {
  scrapeOpenMovieMovie,
  scrapeOpenMovieShow,
} from "./custom/sources/openMovieSource";
import {
  scrapeOPhimMovie,
  scrapeOPhimShow,
} from "./custom/sources/ophimSource";
import {
  scrapeVidlinkMovie,
  scrapeVidlinkShow,
} from "./custom/sources/vidlinkSource";
import {
  scrapeVidSrcRuMovie,
  scrapeVidSrcRuShow,
} from "./custom/sources/vidsrcRuSource";
import {
  scrapeVidSrcMovie,
  scrapeVidSrcShow,
} from "./custom/sources/vidsrcSource";
import {
  scrapeVidSrcWtfMovie,
  scrapeVidSrcWtfShow,
} from "./custom/sources/vidsrcWtfSource";

// Initialize M3U8 proxy on module load
setupM3U8Proxy();

// Custom 111Movies source definition
const movies111Source = {
  id: "alphaflix-111movies",
  name: "Server 1 (111Movies) 🔥",
  rank: 5,
  disabled: true,
  externalSource: false,
  type: "source" as const,
  flags: [flags.CORS_ALLOWED],
  mediaTypes: ["movie" as const, "show" as const],
  scrapeMovie: scrape111MoviesMovie,
  scrapeShow: scrape111MoviesShow,
};

// Custom Vidlink source definition
const vidlinkSource = {
  id: "alphaflix-vidlink",
  name: "Server 2 (VidLink) 🔥",
  rank: 10,
  disabled: false,
  externalSource: false,
  type: "source" as const,
  flags: [flags.CORS_ALLOWED],
  mediaTypes: ["movie" as const, "show" as const],
  scrapeMovie: scrapeVidlinkMovie,
  scrapeShow: scrapeVidlinkShow,
};

// Custom VidSrc.wtf source definition
const vidsrcWtfSource = {
  id: "alphaflix-vidsrcwtf",
  name: "Server 3 (VidSrc.wtf) 🔥",
  rank: 20,
  disabled: false,
  externalSource: false,
  type: "source" as const,
  flags: [flags.CORS_ALLOWED],
  mediaTypes: ["movie" as const, "show" as const],
  scrapeMovie: scrapeVidSrcWtfMovie,
  scrapeShow: scrapeVidSrcWtfShow,
};

// Custom OpenMovie source definition
const openMovieSource = {
  id: "openmovie",
  name: "Server 4 (Vixsrc) 🔥",
  rank: 30,
  disabled: false,
  externalSource: false,
  type: "source" as const,
  flags: [flags.CORS_ALLOWED],
  mediaTypes: ["movie" as const, "show" as const],
  scrapeMovie: scrapeOpenMovieMovie,
  scrapeShow: scrapeOpenMovieShow,
};

// Custom VidSrc.ru source definition
const vidsrcRuSource = {
  id: "alphaflix-vidsrc-ru",
  name: "Server 5 (Vidsrc.ru) 🔥",
  rank: 40,
  disabled: true,
  externalSource: false,
  type: "source" as const,
  flags: [flags.CORS_ALLOWED],
  mediaTypes: ["movie" as const, "show" as const],
  scrapeMovie: scrapeVidSrcRuMovie,
  scrapeShow: scrapeVidSrcRuShow,
};

// Custom VidSrc source definition
const vidsrcSource = {
  id: "alphaflix-vidsrc",
  name: "Server 6 (Vidsrc) 🔥",
  rank: 50,
  disabled: false,
  externalSource: false,
  type: "source" as const,
  flags: [flags.CORS_ALLOWED],
  mediaTypes: ["movie" as const, "show" as const],
  scrapeMovie: scrapeVidSrcMovie,
  scrapeShow: scrapeVidSrcShow,
};

// Custom KKPhim source definition
const kkphimSource = {
  id: "kkphim",
  name: "Server 7 (KKPhim)",
  rank: 60,
  disabled: false,
  externalSource: false,
  type: "source" as const,
  flags: [flags.CORS_ALLOWED],
  mediaTypes: ["movie" as const, "show" as const],
  scrapeMovie: scrapeKKPhimMovie,
  scrapeShow: scrapeKKPhimShow,
};

// Custom OPhim source definition
const ophimSource = {
  id: "ophim",
  name: "Server 8 (OPhim)",
  rank: 70,
  disabled: false,
  externalSource: false,
  type: "source" as const,
  flags: [flags.CORS_ALLOWED],
  mediaTypes: ["movie" as const, "show" as const],
  scrapeMovie: scrapeOPhimMovie,
  scrapeShow: scrapeOPhimShow,
};

// Custom OpenMovie embed definition
const openMovieEmbed = {
  id: "openmovie-embed",
  name: "OpenMovie Stream",
  rank: 80,
  disabled: false,
  type: "embed" as const,
  flags: [flags.CORS_ALLOWED],
  mediaTypes: undefined as undefined,
  scrape: scrapeOpenMovieEmbed,
};

function isDesktopApp(): boolean {
  return Boolean(typeof window !== "undefined" && window.__ALPHAFLIX_DESKTOP__);
}

export function getProviders() {
  // Desktop app has extension built in and can play MKV; use NATIVE target.
  if (isDesktopApp()) {
    return buildProviders()
      .setFetcher(makeStandardFetcher(fetch))
      .setProxiedFetcher(makeExtensionFetcher())
      .setTarget(targets.NATIVE)
      .enableConsistentIpForRequests()
      .addBuiltinProviders()
      .addSource(ophimSource)
      .addSource(kkphimSource)
      .addSource(vidlinkSource)
      .addSource(vidsrcWtfSource)
      .addSource(vidsrcSource)
      .addSource(vidsrcRuSource)
      .addSource(openMovieSource)
      .addSource(movies111Source)
      .addEmbed(openMovieEmbed)
      .build();
  }

  if (isExtensionActiveCached()) {
    return buildProviders()
      .setFetcher(makeStandardFetcher(fetch))
      .setProxiedFetcher(makeExtensionFetcher())
      .setTarget(targets.BROWSER_EXTENSION)
      .enableConsistentIpForRequests()
      .addBuiltinProviders()
      .addSource(ophimSource)
      .addSource(kkphimSource)
      .addSource(vidlinkSource)
      .addSource(vidsrcWtfSource)
      .addSource(vidsrcSource)
      .addSource(vidsrcRuSource)
      .addSource(openMovieSource)
      .addSource(movies111Source)
      .addEmbed(openMovieEmbed)
      .build();
  }

  setupM3U8Proxy();

  return buildProviders()
    .setFetcher(makeStandardFetcher(fetch))
    .setProxiedFetcher(makeLoadBalancedSimpleProxyFetcher())
    .setTarget(targets.BROWSER)
    .addBuiltinProviders()
    .addSource(ophimSource)
    .addSource(kkphimSource)
    .addSource(vidlinkSource)
    .addSource(vidsrcWtfSource)
    .addSource(vidsrcSource)
    .addSource(vidsrcRuSource)
    .addSource(openMovieSource)
    .addSource(movies111Source)
    .addEmbed(openMovieEmbed)
    .build();
}

export function getAllProviders() {
  return buildProviders()
    .setFetcher(makeStandardFetcher(fetch))
    .setTarget(targets.BROWSER_EXTENSION)
    .enableConsistentIpForRequests()
    .addBuiltinProviders()
    .addSource(ophimSource)
    .addSource(kkphimSource)
    .addSource(vidlinkSource)
    .addSource(vidsrcWtfSource)
    .addSource(vidsrcSource)
    .addSource(vidsrcRuSource)
    .addSource(openMovieSource)
    .addSource(movies111Source)
    .addEmbed(openMovieEmbed)
    .build();
}
