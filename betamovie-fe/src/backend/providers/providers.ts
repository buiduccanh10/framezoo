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
  scrapeVidkingMovie,
  scrapeVidkingShow,
} from "./custom/sources/vidkingSource";
import {
  scrapeVidlinkMovie,
  scrapeVidlinkShow,
} from "./custom/sources/vidlinkSource";
import {
  scrapeVidSrcToMovie,
  scrapeVidSrcToShow,
} from "./custom/sources/vidsrcToSource";
import { applyProviderMetadataOverride } from "./runtimeMetadata";
// Initialize M3U8 proxy on module load
setupM3U8Proxy();

// Custom Vidlink source definition
const vidlinkSource = {
  id: "alphaflix-vidlink",
  name: "Server 3 (VidLink) 🔥",
  rank: 3,
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
  disabled: true,
  externalSource: false,
  type: "source" as const,
  flags: [flags.CORS_ALLOWED],
  mediaTypes: ["movie" as const, "show" as const],
  scrapeMovie: scrapeOpenMovieMovie,
  scrapeShow: scrapeOpenMovieShow,
};

// Custom KKPhim source definition
const kkphimSource = {
  id: "kkphim",
  name: "Server 4 (KKPhim Vietsub + Lồng tiếng) 🔥",
  rank: 4,
  disabled: true,
  externalSource: false,
  type: "source" as const,
  flags: [flags.CORS_ALLOWED],
  mediaTypes: ["movie" as const, "show" as const],
  scrapeMovie: scrapeKKPhimMovie,
  scrapeShow: scrapeKKPhimShow,
};

// Custom 111Movies source definition
const movies111Source = {
  id: "alphaflix-111movies",
  name: "Server 6 (111Movies)",
  rank: 6,
  disabled: true,
  externalSource: false,
  type: "source" as const,
  flags: [flags.CORS_ALLOWED],
  mediaTypes: ["movie" as const, "show" as const],
  scrapeMovie: scrape111MoviesMovie,
  scrapeShow: scrape111MoviesShow,
};

// Custom VidSrc.to source definition
const vidsrcToSource = {
  id: "alphaflix-vidsrcto",
  name: "Server 5 (Vidsrc.to)",
  rank: 5,
  disabled: true,
  externalSource: false,
  type: "source" as const,
  flags: [flags.CORS_ALLOWED],
  mediaTypes: ["movie" as const, "show" as const],
  scrapeMovie: scrapeVidSrcToMovie,
  scrapeShow: scrapeVidSrcToShow,
};

// Custom Vidking source definition
const vidkingSource = {
  id: "alphaflix-vidking",
  name: "Server 1 (Vidking) 🔥",
  rank: 1,
  disabled: true,
  externalSource: false,
  type: "source" as const,
  flags: [flags.CORS_ALLOWED],
  mediaTypes: ["movie" as const, "show" as const],
  scrapeMovie: scrapeVidkingMovie,
  scrapeShow: scrapeVidkingShow,
};

// Custom OpenMovie embed definition
const openMovieEmbed = {
  id: "openmovie-embed",
  name: "OpenMovie Stream",
  rank: 80,
  disabled: true,
  type: "embed" as const,
  flags: [flags.CORS_ALLOWED],
  mediaTypes: undefined as undefined,
  scrape: scrapeOpenMovieEmbed,
};

const sourceDefinitions = [
  movies111Source,
  vidlinkSource,
  openMovieSource,
  vidsrcToSource,
  vidkingSource,
  kkphimSource,
];

const embedDefinitions = [openMovieEmbed];

function isDesktopApp(): boolean {
  return Boolean(typeof window !== "undefined" && window.__ALPHAFLIX_DESKTOP__);
}

function withConfiguredProviders(builder: ReturnType<typeof buildProviders>) {
  sourceDefinitions.forEach((source) => {
    const overridden = applyProviderMetadataOverride(source);
    if (overridden) {
      builder.addSource(overridden);
    }
  });
  embedDefinitions.forEach((embed) => {
    const overridden = applyProviderMetadataOverride(embed);
    if (overridden) {
      builder.addEmbed(overridden);
    }
  });

  return builder;
}

export function getProviders() {
  // Desktop app has extension built in and can play MKV; use NATIVE target.
  if (isDesktopApp()) {
    return withConfiguredProviders(
      buildProviders()
        .setFetcher(makeStandardFetcher(fetch))
        .setProxiedFetcher(makeExtensionFetcher())
        .setTarget(targets.NATIVE)
        .enableConsistentIpForRequests()
        .addBuiltinProviders(),
    ).build();
  }

  if (isExtensionActiveCached()) {
    return withConfiguredProviders(
      buildProviders()
        .setFetcher(makeStandardFetcher(fetch))
        .setProxiedFetcher(makeExtensionFetcher())
        .setTarget(targets.BROWSER_EXTENSION)
        .enableConsistentIpForRequests()
        .addBuiltinProviders(),
    ).build();
  }

  setupM3U8Proxy();

  return withConfiguredProviders(
    buildProviders()
      .setFetcher(makeStandardFetcher(fetch))
      .setProxiedFetcher(makeLoadBalancedSimpleProxyFetcher())
      .setTarget(targets.BROWSER)
      .addBuiltinProviders(),
  ).build();
}

export function getAllProviders() {
  return withConfiguredProviders(
    buildProviders()
      .setFetcher(makeStandardFetcher(fetch))
      .setTarget(targets.BROWSER_EXTENSION)
      .enableConsistentIpForRequests()
      .addBuiltinProviders(),
  ).build();
}
