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
  scrapeVidlinkMovie,
  scrapeVidlinkShow,
} from "./custom/sources/vidlinkSource";
import {
  scrapeVidrockMovie,
  scrapeVidrockShow,
} from "./custom/sources/vidrockSource";
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

// Custom Vidlink source definition
const vidlinkSource = {
  id: "alphaflix-vidlink",
  name: "Server 1 (VidLink) 🔥",
  rank: 1,
  disabled: true,
  externalSource: false,
  type: "source" as const,
  flags: [flags.CORS_ALLOWED],
  mediaTypes: ["movie" as const, "show" as const],
  scrapeMovie: scrapeVidlinkMovie,
  scrapeShow: scrapeVidlinkShow,
};

// Custom OpenMovie source definition
const openMovieSource = {
  id: "openmovie",
  name: "Server 2 (Vixsrc) 🔥",
  rank: 2,
  disabled: false,
  externalSource: false,
  type: "source" as const,
  flags: [flags.CORS_ALLOWED],
  mediaTypes: ["movie" as const, "show" as const],
  scrapeMovie: scrapeOpenMovieMovie,
  scrapeShow: scrapeOpenMovieShow,
};

// Custom Vidrock source definition
const vidrockSource = {
  id: "alphaflix-vidrock",
  name: "Server 3 (Vidrock) 🔥",
  rank: 3,
  disabled: false,
  externalSource: false,
  type: "source" as const,
  flags: [flags.CORS_ALLOWED],
  mediaTypes: ["movie" as const, "show" as const],
  scrapeMovie: scrapeVidrockMovie,
  scrapeShow: scrapeVidrockShow,
};

// Custom VidSrc.wtf source definition
const vidsrcWtfSource = {
  id: "alphaflix-vidsrcwtf",
  name: "Server 4 (VidSrc.wtf) 🔥",
  rank: 4,
  disabled: false,
  externalSource: false,
  type: "source" as const,
  flags: [flags.CORS_ALLOWED],
  mediaTypes: ["movie" as const, "show" as const],
  scrapeMovie: scrapeVidSrcWtfMovie,
  scrapeShow: scrapeVidSrcWtfShow,
};

// Custom 111Movies source definition
const movies111Source = {
  id: "alphaflix-111movies",
  name: "Server 5 (111Movies) 🔥",
  rank: 5,
  disabled: false,
  externalSource: false,
  type: "source" as const,
  flags: [flags.CORS_ALLOWED],
  mediaTypes: ["movie" as const, "show" as const],
  scrapeMovie: scrape111MoviesMovie,
  scrapeShow: scrape111MoviesShow,
};

// Custom VidSrc.ru source definition
const vidsrcRuSource = {
  id: "alphaflix-vidsrc-ru",
  name: "Server 6 (Vidsrc.ru) 🔥",
  rank: 6,
  disabled: false,
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
  name: "Server 7 (Vidsrc) 🔥",
  rank: 7,
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
  name: "Server 8 (KKPhim Vietsub + Lồng tiếng)",
  rank: 8,
  disabled: false,
  externalSource: false,
  type: "source" as const,
  flags: [flags.CORS_ALLOWED],
  mediaTypes: ["movie" as const, "show" as const],
  scrapeMovie: scrapeKKPhimMovie,
  scrapeShow: scrapeKKPhimShow,
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
      .addSource(vidrockSource)
      .addSource(movies111Source)
      .addSource(vidlinkSource)
      .addSource(vidsrcWtfSource)
      .addSource(openMovieSource)
      .addSource(vidsrcRuSource)
      .addSource(vidsrcSource)
      .addSource(kkphimSource)
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
      .addSource(vidrockSource)
      .addSource(movies111Source)
      .addSource(vidlinkSource)
      .addSource(vidsrcWtfSource)
      .addSource(openMovieSource)
      .addSource(vidsrcRuSource)
      .addSource(vidsrcSource)
      .addSource(kkphimSource)
      .addEmbed(openMovieEmbed)
      .build();
  }

  setupM3U8Proxy();

  return buildProviders()
    .setFetcher(makeStandardFetcher(fetch))
    .setProxiedFetcher(makeLoadBalancedSimpleProxyFetcher())
    .setTarget(targets.BROWSER)
    .addBuiltinProviders()
    .addSource(vidrockSource)
    .addSource(movies111Source)
    .addSource(vidlinkSource)
    .addSource(vidsrcWtfSource)
    .addSource(openMovieSource)
    .addSource(vidsrcRuSource)
    .addSource(vidsrcSource)
    .addSource(kkphimSource)
    .addEmbed(openMovieEmbed)
    .build();
}

export function getAllProviders() {
  return buildProviders()
    .setFetcher(makeStandardFetcher(fetch))
    .setTarget(targets.BROWSER_EXTENSION)
    .enableConsistentIpForRequests()
    .addBuiltinProviders()
    .addSource(vidrockSource)
    .addSource(movies111Source)
    .addSource(vidlinkSource)
    .addSource(vidsrcWtfSource)
    .addSource(openMovieSource)
    .addSource(vidsrcRuSource)
    .addSource(vidsrcSource)
    .addSource(kkphimSource)
    .addEmbed(openMovieEmbed)
    .build();
}
