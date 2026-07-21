export function isValidTmdbId(id: string | number | null | undefined): boolean {
  return typeof id === "number"
    ? Number.isInteger(id) && id > 0
    : typeof id === "string" && /^[1-9]\d*$/.test(id);
}
