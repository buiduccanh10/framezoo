const PRERELEASE_KEYWORDS = new Set([
  "alpha",
  "beta",
  "rc",
  "pre",
  "dev",
  "canary",
  "nightly",
  "snapshot",
]);

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:\+.*)?$/i;
const VERSION_WITH_SUFFIX_RE =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+)|([A-Za-z][0-9A-Za-z]*))(?:\+.*)?$/i;

type VersionTier = 0 | 1 | 2; // 0 = prerelease, 1 = base, 2 = subrelease

export interface ParsedDesktopVersion {
  major: number;
  minor: number;
  patch: number;
  tier: VersionTier;
  letterSuffix: string;
  tokens: Array<number | string>;
}

function parseTokenList(raw: string): Array<number | string> {
  return raw
    .split(".")
    .filter(Boolean)
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part.toLowerCase()));
}

function isClassicPrerelease(suffix: string): boolean {
  const firstSegment = suffix.split(".")[0]?.toLowerCase() ?? "";
  if (PRERELEASE_KEYWORDS.has(firstSegment)) return true;
  const match = firstSegment.match(/^([a-z]+)\d+$/);
  return Boolean(match && PRERELEASE_KEYWORDS.has(match[1]));
}

export function parseDesktopVersion(raw: string): ParsedDesktopVersion | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const baseMatch = trimmed.match(VERSION_RE);
  if (baseMatch) {
    return {
      major: Number(baseMatch[1]),
      minor: Number(baseMatch[2]),
      patch: Number(baseMatch[3]),
      tier: 1,
      letterSuffix: "",
      tokens: [],
    };
  }

  const suffixMatch = trimmed.match(VERSION_WITH_SUFFIX_RE);
  if (!suffixMatch) return null;

  const major = Number(suffixMatch[1]);
  const minor = Number(suffixMatch[2]);
  const patch = Number(suffixMatch[3]);
  const hyphenSuffix = suffixMatch[4];
  const attachedSuffix = suffixMatch[5];
  const suffix = hyphenSuffix ?? attachedSuffix ?? "";

  if (hyphenSuffix && isClassicPrerelease(hyphenSuffix)) {
    return {
      major,
      minor,
      patch,
      tier: 0,
      letterSuffix: "",
      tokens: parseTokenList(hyphenSuffix),
    };
  }

  const dotParts = suffix.split(".").filter(Boolean);
  const firstPart = dotParts[0] ?? "";
  const leadingLettersMatch = firstPart.match(/^([A-Za-z]+)(.*)$/);

  if (leadingLettersMatch) {
    const letters = leadingLettersMatch[1].toLowerCase();
    const remainder = leadingLettersMatch[2];
    const restTokens = [
      ...(remainder
        ? [
            /^\d+$/.test(remainder)
              ? Number(remainder)
              : remainder.toLowerCase(),
          ]
        : []),
      ...parseTokenList(dotParts.slice(1).join(".")),
    ];

    return {
      major,
      minor,
      patch,
      tier: 2,
      letterSuffix: letters,
      tokens: restTokens,
    };
  }

  return {
    major,
    minor,
    patch,
    tier: 2,
    letterSuffix: "",
    tokens: parseTokenList(suffix),
  };
}

function compareTokenLists(
  a: Array<number | string>,
  b: Array<number | string>,
): number {
  const maxLen = Math.max(a.length, b.length);
  for (let i = 0; i < maxLen; i += 1) {
    if (i >= a.length) return -1;
    if (i >= b.length) return 1;

    const left = a[i];
    const right = b[i];
    if (left === right) continue;

    if (typeof left === "number" && typeof right === "number") {
      return left < right ? -1 : 1;
    }
    if (typeof left === "number") return -1;
    if (typeof right === "number") return 1;
    return left < right ? -1 : 1;
  }
  return 0;
}

export function compareDesktopVersions(a: string, b: string): number {
  const parsedA = parseDesktopVersion(a);
  const parsedB = parseDesktopVersion(b);
  if (!parsedA || !parsedB) {
    if (a === b) return 0;
    return a < b ? -1 : 1;
  }

  if (parsedA.major !== parsedB.major) {
    return parsedA.major < parsedB.major ? -1 : 1;
  }
  if (parsedA.minor !== parsedB.minor) {
    return parsedA.minor < parsedB.minor ? -1 : 1;
  }
  if (parsedA.patch !== parsedB.patch) {
    return parsedA.patch < parsedB.patch ? -1 : 1;
  }
  if (parsedA.tier !== parsedB.tier) {
    return parsedA.tier < parsedB.tier ? -1 : 1;
  }
  if (parsedA.letterSuffix.length !== parsedB.letterSuffix.length) {
    return parsedA.letterSuffix.length < parsedB.letterSuffix.length ? -1 : 1;
  }
  if (parsedA.letterSuffix !== parsedB.letterSuffix) {
    return parsedA.letterSuffix < parsedB.letterSuffix ? -1 : 1;
  }

  return compareTokenLists(parsedA.tokens, parsedB.tokens);
}

export function isNewerDesktopVersion(
  candidate: string,
  current: string,
): boolean {
  const parsedCandidate = parseDesktopVersion(candidate);
  const parsedCurrent = parseDesktopVersion(current);
  if (!parsedCandidate || !parsedCurrent) return false;
  return compareDesktopVersions(candidate, current) > 0;
}
