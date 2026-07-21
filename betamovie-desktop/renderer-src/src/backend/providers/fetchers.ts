import { sendExtensionRequest } from "@/backend/extension/messaging";
import { Fetcher } from "@/lib/providers";

import { convertBodyToObject, getBodyTypeFromBody } from "../extension/request";

function makeFinalHeaders(
  readHeaders: string[],
  headers: Record<string, string>,
): Headers {
  const lowercasedHeaders = readHeaders.map((v) => v.toLowerCase());
  return new Headers(
    Object.entries(headers).filter((entry) =>
      lowercasedHeaders.includes(entry[0].toLowerCase()),
    ),
  );
}

export function makeExtensionFetcher() {
  const fetcher: Fetcher = async (url, ops) => {
    const safeOps = ops ?? {};
    const result = await sendExtensionRequest<any>({
      url,
      method: safeOps.method ?? "GET",
      ...safeOps,
      body: convertBodyToObject(safeOps.body),
      bodyType: getBodyTypeFromBody(safeOps.body),
    });
    if (!result?.success) throw new Error(`extension error: ${result?.error}`);
    const res = result.response;
    return {
      body: res.body,
      finalUrl: res.finalUrl,
      statusCode: res.statusCode,
      headers: makeFinalHeaders(safeOps.readHeaders ?? [], res.headers),
    };
  };
  return fetcher;
}

export const getLoadbalancedProxyUrl = () => {
  return "";
};
export const getLoadbalancedM3U8ProxyUrl = () => {
  return "";
};
