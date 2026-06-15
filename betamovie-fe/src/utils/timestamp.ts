// Convert `t` param to time. Supports having only seconds (like `?t=192`), but also `3:30` or `1:30:02`
export function parseTimestamp(str: string | undefined | null): number | null {
  const input = str ?? "";
  const isValid = !!input.match(/^\d+(:\d+)*$/);
  if (!isValid) return null;

  const timeArr = input.split(":").map(Number).reverse();
  const hours = timeArr[2] ?? 0;
  const minutes = Math.min(timeArr[1] ?? 0, 59);
  const seconds = Math.min(timeArr[0] ?? 0, minutes > 0 ? 59 : Infinity);

  const timeInSeconds = hours * 60 * 60 + minutes * 60 + seconds;
  return timeInSeconds;
}

export function formatDateDDMMYY(
  input: string | number | Date | undefined | null,
): string | null {
  if (!input) return null;

  if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [year, month, day] = input.split("-");
    return `${day}/${month}/${year.slice(-2)}`;
  }

  const parsedDate = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(parsedDate.getTime())) return null;

  const day = String(parsedDate.getDate()).padStart(2, "0");
  const month = String(parsedDate.getMonth() + 1).padStart(2, "0");
  const year = String(parsedDate.getFullYear()).slice(-2);

  return `${day}/${month}/${year}`;
}
