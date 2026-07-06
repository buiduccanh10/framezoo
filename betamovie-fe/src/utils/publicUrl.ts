function getResolvedPublicPath(path: string): string {
  const baseUrl = import.meta.env.BASE_URL || "/";
  const assetPath = path.replace(/^\/+/, "");

  if (baseUrl === "/") {
    return `/${assetPath}`;
  }

  if (baseUrl.startsWith("./") || baseUrl.startsWith("../")) {
    const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    return `${normalizedBaseUrl}${assetPath}`;
  }

  const normalizedBaseUrl = `/${baseUrl.replace(/^\/+|\/+$/g, "")}/`;
  return `${normalizedBaseUrl}${assetPath}`;
}

export function resolvePublicUrl(
  path: string | null | undefined,
): string | undefined {
  if (!path) return undefined;
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  if (typeof document === "undefined") return path;

  return new URL(getResolvedPublicPath(path), document.baseURI).toString();
}
