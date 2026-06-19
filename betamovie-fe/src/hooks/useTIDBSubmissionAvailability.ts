import { useEffect, useState } from "react";

import { getBackendMeta } from "@/backend/accounts/meta";
import { conf } from "@/setup/config";
import { usePreferencesStore } from "@/stores/preferences";

export function useTIDBSubmissionAvailability() {
  const config = conf();
  const backendUrl = config.BACKEND_URL?.trim() ?? "";
  const tidbKeyFromStore = usePreferencesStore((s) => s.tidbKey);
  const hasClientKey = !!config.TIDB_API_KEY?.trim();
  const hasStoredKey = !!tidbKeyFromStore?.trim();
  const [hasBackendKey, setHasBackendKey] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!backendUrl) {
      setHasBackendKey(false);
      return;
    }

    getBackendMeta(backendUrl)
      .then((meta) => {
        if (!cancelled) {
          setHasBackendKey(!!meta.hasTIDBSubmission);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHasBackendKey(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [backendUrl]);

  return {
    hasBackendKey,
    hasClientKey,
    hasStoredKey,
    canSubmit: hasBackendKey || hasClientKey || hasStoredKey,
  };
}
