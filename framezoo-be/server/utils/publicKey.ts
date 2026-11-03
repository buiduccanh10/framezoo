export function isValidPublicKey(value: string): boolean {
  if (!/^[A-Za-z0-9_-]{43,44}$/.test(value)) return false;

  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    return Buffer.from(padded, 'base64').length === 32;
  } catch {
    return false;
  }
}
