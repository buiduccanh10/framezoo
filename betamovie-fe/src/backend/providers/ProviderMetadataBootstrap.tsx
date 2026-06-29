import { useEffect } from "react";

import { useBackendUrl } from "@/hooks/auth/useBackendUrl";

import { loadProviderMetadata } from "./runtimeMetadata";

export function ProviderMetadataBootstrap() {
  const backendUrl = useBackendUrl();

  useEffect(() => {
    void loadProviderMetadata(true);
  }, [backendUrl]);

  return null;
}
