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

// Initialize M3U8 proxy on module load
setupM3U8Proxy();

// Custom OPhim source definition
const ophimSource = {
  id: "ophim",
  name: "Server 4",
  rank: 40,
  disabled: false,
  externalSource: false,
  type: "source" as const,
  flags: [flags.CORS_ALLOWED],
  mediaTypes: ["movie" as const, "show" as const],
  scrapeMovie: scrapeOPhimMovie,
  scrapeShow: scrapeOPhimShow,
};

// Custom KKPhim source definition
const kkphimSource = {
  id: "kkphim",
  name: "Server 3",
  rank: 30,
  disabled: false,
  externalSource: false,
  type: "source" as const,
  flags: [flags.CORS_ALLOWED],
  mediaTypes: ["movie" as const, "show" as const],
  scrapeMovie: scrapeKKPhimMovie,
  scrapeShow: scrapeKKPhimShow,
};

// Custom OpenMovie source definition
const openMovieSource = {
  id: "openmovie",
  name: "Server 1 🔥",
  rank: 10,
  disabled: false,
  externalSource: false,
  type: "source" as const,
  flags: [flags.CORS_ALLOWED],
  mediaTypes: ["movie" as const, "show" as const],
  scrapeMovie: scrapeOpenMovieMovie,
  scrapeShow: scrapeOpenMovieShow,
};

// Custom Vidlink source definition
const vidlinkSource = {
  id: "alphaflix-vidlink",
  name: "Server 2 🔥",
  rank: 20,
  disabled: false,
  externalSource: false,
  type: "source" as const,
  flags: [flags.CORS_ALLOWED],
  mediaTypes: ["movie" as const, "show" as const],
  scrapeMovie: scrapeVidlinkMovie,
  scrapeShow: scrapeVidlinkShow,
};

// Custom OpenMovie embed definition
const openMovieEmbed = {
  id: "openmovie-embed",
  name: "OpenMovie Stream",
  rank: 50,
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
      .addSource(openMovieSource)
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
      .addSource(openMovieSource)
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
    .addSource(openMovieSource)
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
    .addSource(openMovieSource)
    .addEmbed(openMovieEmbed)
    .build();
}
