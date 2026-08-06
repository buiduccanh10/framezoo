import { jwtDecode } from "jwt-decode";
import { ofetch } from "ofetch";

import { getBackendAuthHeaders } from "@/utils/backendAuth";

type P<T> = Parameters<typeof ofetch<T, any>>;
type R<T> = ReturnType<typeof ofetch<T, any>>;

const baseFetch = ofetch.create({
  retry: 0,
  credentials: "include",
});
let apiToken: string | null = null;

function getValidApiToken() {
  if (!apiToken) return null;
  try {
    const body = jwtDecode(apiToken);
    if (!body.exp || Date.now() / 1000 < body.exp) {
      return `jwt|${apiToken}`;
    }
  } catch {
    // Ignore malformed tokens and continue without one.
  }
  return null;
}

export function makeUrl(url: string, data: Record<string, string>) {
  let parsedUrl: string = url;
  Object.entries(data).forEach(([k, v]) => {
    parsedUrl = parsedUrl.replace(`{${k}}`, encodeURIComponent(v));
  });
  return parsedUrl;
}

export function mwFetch<T>(url: string, ops: P<T>[1] = {}): R<T> {
  return baseFetch<T>(url, {
    ...ops,
    headers: getBackendAuthHeaders(url, ops.headers, ops.baseURL),
  });
}

export async function singularProxiedFetch<T>(
  proxyUrl: string,
  url: string,
  ops: P<T>[1] = {},
): R<T> {
  let combinedUrl = ops?.baseURL ?? "";
  if (
    combinedUrl.length > 0 &&
    combinedUrl.endsWith("/") &&
    url.startsWith("/")
  )
    combinedUrl += url.slice(1);
  else if (
    combinedUrl.length > 0 &&
    !combinedUrl.endsWith("/") &&
    !url.startsWith("/")
  )
    combinedUrl += `/${url}`;
  else combinedUrl += url;

  const parsedUrl = new URL(combinedUrl);
  Object.entries(ops?.params ?? {}).forEach(([k, v]) => {
    parsedUrl.searchParams.set(k, v);
  });
  Object.entries(ops?.query ?? {}).forEach(([k, v]) => {
    parsedUrl.searchParams.set(k, v);
  });

  let headers = ops.headers ?? {};
  const token = getValidApiToken();
  if (token)
    headers = {
      ...headers,
      "X-Token": token,
    };

  return baseFetch<T>(proxyUrl, {
    ...ops,
    baseURL: undefined,
    params: {
      destination: parsedUrl.toString(),
    },
    query: {},
    headers,
    onResponse(context) {
      const tokenHeader = context.response.headers.get("X-Token");
      if (tokenHeader) {
        apiToken = tokenHeader.replace(/^jwt\|/, "");
      }

      if (Array.isArray(ops.onResponse)) {
        ops.onResponse.forEach((hook) => hook(context));
      } else {
        ops.onResponse?.(context);
      }
    },
  });
}

export function proxiedFetch<T>(url: string, ops: P<T>[1] = {}): R<T> {
  return singularProxiedFetch<T>("", url, ops);
}
