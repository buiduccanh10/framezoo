export function resolvePublicUrl(
  path: string | null | undefined,
): string | undefined {
  if (!path) return undefined;
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  if (typeof document === "undefined") return path;

  return new URL(path.slice(1), document.baseURI).toString();
}
