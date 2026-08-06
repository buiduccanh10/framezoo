function formatCompactCountValue(value: number): string {
  const absoluteValue = Math.abs(value);
  const decimals = absoluteValue >= 100 ? 0 : 1;

  return Number(value.toFixed(decimals)).toString();
}

export function formatCompactCount(value: number): string {
  const absoluteValue = Math.abs(value);

  if (absoluteValue >= 1_000_000_000) {
    return `${formatCompactCountValue(value / 1_000_000_000)}B`;
  }
  if (absoluteValue >= 1_000_000) {
    return `${formatCompactCountValue(value / 1_000_000)}M`;
  }
  if (absoluteValue >= 1_000) {
    return `${formatCompactCountValue(value / 1_000)}K`;
  }

  return value.toLocaleString();
}
