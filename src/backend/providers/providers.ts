import {
  buildProviders,
  flags,
  makeProviders,
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
      .build();
  }

  setupM3U8Proxy();

  return buildProviders()
    .setFetcher(makeStandardFetcher(fetch))
    .setProxiedFetcher(makeLoadBalancedSimpleProxyFetcher())
    .setTarget(targets.BROWSER)
    .addBuiltinProviders()
    .addSource(ophimSource)
    .build();
}

export function getAllProviders() {
  return makeProviders({
    fetcher: makeStandardFetcher(fetch),
    target: targets.BROWSER_EXTENSION,
    consistentIpForRequests: true,
  });
}
