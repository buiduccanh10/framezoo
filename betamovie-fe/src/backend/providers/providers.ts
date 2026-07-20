import { isExtensionActiveCached } from "@/backend/extension/messaging";
import { makeExtensionFetcher } from "@/backend/providers/fetchers";
import { buildProviders, makeStandardFetcher, targets } from "@/lib/providers";

function isDesktopApp(): boolean {
  return Boolean(typeof window !== "undefined" && window.__ALPHAFLIX_DESKTOP__);
}

export function getProviders() {
  if (isDesktopApp()) {
    return buildProviders()
      .setFetcher(makeStandardFetcher(fetch))
      .setProxiedFetcher(makeExtensionFetcher())
      .setTarget(targets.NATIVE)
      .enableConsistentIpForRequests()
      .addBuiltinProviders()
      .build();
  }

  if (isExtensionActiveCached()) {
    return buildProviders()
      .setFetcher(makeStandardFetcher(fetch))
      .setProxiedFetcher(makeExtensionFetcher())
      .setTarget(targets.BROWSER_EXTENSION)
      .enableConsistentIpForRequests()
      .addBuiltinProviders()
      .build();
  }

  return buildProviders()
    .setFetcher(makeStandardFetcher(fetch))
    .setTarget(targets.BROWSER)
    .addBuiltinProviders()
    .build();
}

export function getAllProviders() {
  return buildProviders()
    .setFetcher(makeStandardFetcher(fetch))
    .setTarget(targets.BROWSER_EXTENSION)
    .enableConsistentIpForRequests()
    .addBuiltinProviders()
    .build();
}
