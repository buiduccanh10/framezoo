import { useEffect } from "react";

import { refreshCachedMetadata } from "@/backend/helpers/providerApi";
import { useBackendUrl } from "@/hooks/auth/useBackendUrl";

import { loadProviderMetadata } from "./runtimeMetadata";

export function ProviderMetadataBootstrap() {
  const backendUrl = useBackendUrl();

  useEffect(() => {
    void (async () => {
      await loadProviderMetadata(true);
      refreshCachedMetadata();
    })();
  }, [backendUrl]);

  return null;
}
