import { nanoid } from "nanoid";
import { ofetch } from "ofetch";

import { conf } from "@/setup/config";

function getCaptchaMetricsEndpoint(): string | null {
  const config = conf();
  const backendUrl = config.BACKEND_URLS[0] ?? config.BACKEND_URL ?? null;
  return backendUrl ? `${backendUrl}/metrics/captcha` : null;
}

export function reportCaptchaSolve(success: boolean) {
  const endpoint = getCaptchaMetricsEndpoint();
  if (!endpoint) return;

  ofetch(endpoint, {
    method: "POST",
    credentials: "include",
    body: {
      success,
      batchId: nanoid(32),
    },
  }).catch(() => {});
}
