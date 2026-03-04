import {
  buildProviders,
  flags,
  makeStandardFetcher,
  targets,
} from "@p-stream/providers";

import { isExtensionActiveCached } from "@/backend/extension/messaging";
import {
  makeExtensionFetcher,
  makeLoadBalancedSimpleProxyFetcher,
  setupM3U8Proxy,
} from "@/backend/providers/fetchers";

import {
  scrapeKKPhimMovie,
  scrapeKKPhimShow,
} from "./custom/sources/kkphimSource";
import {
  scrapeNguoncMovie,
  scrapeNguoncShow,
} from "./custom/sources/nguoncSource";
import {
  scrapeOPhimMovie,
  scrapeOPhimShow,
} from "./custom/sources/ophimSource";

// Initialize M3U8 proxy on module load
setupM3U8Proxy();

// Custom OPhim source definition
const ophimSource = {
  id: "ophim",
  name: "OPhim",
  rank: 200,
  disabled: false,
  externalSource: false,
  type: "source" as const,
  flags: [flags.CORS_ALLOWED],
  mediaTypes: ["movie" as const, "show" as const],
  scrapeMovie: scrapeOPhimMovie,
  scrapeShow: scrapeOPhimShow,
};

// Custom NguonC source definition
const nguoncSource = {
  id: "nguonc",
  name: "NguonC",
  rank: 205,
  disabled: false,
  externalSource: false,
  type: "source" as const,
  flags: [flags.CORS_ALLOWED],
  mediaTypes: ["movie" as const, "show" as const],
  scrapeMovie: scrapeNguoncMovie,
  scrapeShow: scrapeNguoncShow,
};

// Custom KKPhim source definition
const kkphimSource = {
  id: "kkphim",
  name: "KKPhim",
  rank: 210,
  disabled: false,
  externalSource: false,
  type: "source" as const,
  flags: [flags.CORS_ALLOWED],
  mediaTypes: ["movie" as const, "show" as const],
  scrapeMovie: scrapeKKPhimMovie,
  scrapeShow: scrapeKKPhimShow,
};

function isDesktopApp(): boolean {
  return Boolean(typeof window !== "undefined" && window.__PSTREAM_DESKTOP__);
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
      .addSource(nguoncSource)
      .addSource(kkphimSource)
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
      .addSource(nguoncSource)
      .addSource(kkphimSource)
      .build();
  }

  setupM3U8Proxy();

  return buildProviders()
    .setFetcher(makeStandardFetcher(fetch))
    .setProxiedFetcher(makeLoadBalancedSimpleProxyFetcher())
    .setTarget(targets.BROWSER)
    .addBuiltinProviders()
    .addSource(ophimSource)
    .addSource(nguoncSource)
    .addSource(kkphimSource)
    .build();
}

export function getAllProviders() {
  return buildProviders()
    .setFetcher(makeStandardFetcher(fetch))
    .setTarget(targets.BROWSER_EXTENSION)
    .enableConsistentIpForRequests()
    .addBuiltinProviders()
    .addSource(ophimSource)
    .addSource(nguoncSource)
    .addSource(kkphimSource)
    .build();
}
