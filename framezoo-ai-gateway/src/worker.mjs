/**
 * Framezoo AI Gateway — Cloudflare Worker
 *
 * Converts natural-language movie/TV search queries (Vietnamese, English, etc.)
 * into structured TMDB-ready search intents using Cloudflare Workers AI.
 *
 * Can be deployed with `wrangler deploy` OR pasted directly into
 * Cloudflare Dashboard -> Workers & Pages -> framezoo-ai-gateway -> Edit code.
 */

const MAX_QUERY_LENGTH = 300;
const MAX_TOKENS = 350;
const CURRENT_YEAR = 2026;
const PROMPT_VERSION = "v5";

const DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const DEFAULT_FAST_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8-fast";
const DEFAULT_ACCURATE_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const ALLOWED_INTENTS = new Set(["discover", "title_lookup", "hybrid"]);
const ALLOWED_MEDIA_TYPES = new Set(["movie", "tv", "all"]);
const ALLOWED_SORT_BY = new Set(["popularity", "rating", "release_date"]);
const ALLOWED_GENRES = new Set([
  "action",
  "adventure",
  "animation",
  "comedy",
  "crime",
  "documentary",
  "drama",
  "family",
  "fantasy",
  "history",
  "horror",
  "music",
  "mystery",
  "romance",
  "science-fiction",
  "thriller",
  "war",
  "western",
  "action-adventure",
  "kids",
  "reality",
  "sci-fi-fantasy",
  "soap",
]);

const SEARCH_INTENT_SCHEMA = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: ["discover", "title_lookup", "hybrid"],
    },
    mediaType: {
      type: "string",
      enum: ["movie", "tv", "all"],
    },
    candidateTitles: {
      type: "array",
      items: { type: "string" },
    },
    keywords: {
      type: "array",
      items: { type: "string" },
    },
    genres: {
      type: "array",
      items: { type: "string" },
    },
    originCountries: {
      type: "array",
      items: { type: "string" },
    },
    originalLanguages: {
      type: "array",
      items: { type: "string" },
    },
    yearFrom: { type: "integer" },
    yearTo: { type: "integer" },
    minRating: { type: "number" },
    sortBy: {
      type: "string",
      enum: ["popularity", "rating", "release_date"],
    },
    summary: { type: "string" },
  },
  required: [
    "intent",
    "mediaType",
    "candidateTitles",
    "keywords",
    "genres",
    "originCountries",
    "sortBy",
    "summary",
  ],
  additionalProperties: false,
};

const SYSTEM_PROMPT = [
  "You are a movie and TV search intent parser for TMDB (current year: " + CURRENT_YEAR + ").",
  "Understand natural-language queries in ANY language (English, Vietnamese, Japanese, Korean, Chinese, Spanish, French, etc.).",
  "Return ONLY valid JSON matching the schema. Rules:",
  "- intent:",
  '  * "title_lookup": user describes a plot, scene, character, quote, actor, or remembers a specific title without naming it.',
  '  * "discover": user asks for recommendations by mood, genre, country, era, rating, or "similar to X / giống X".',
  '  * "hybrid": both specific title candidates AND discovery filters help.',
  '- mediaType: "movie", "tv" (series/anime/drama/show), or "all".',
  "- candidateTitles: up to 6 exact real international/English TMDB titles when user describes a plot/scene OR asks for titles similar to another movie/show. Never invent fake titles; use [] only for broad genre/mood queries with no specific match.",
  "- keywords: up to 5 concise ENGLISH-ONLY search terms/themes (never non-English words).",
  "- genres: subset of [action, adventure, animation, comedy, crime, documentary, drama, family, fantasy, history, horror, music, mystery, romance, science-fiction, thriller, war, western, action-adventure, sci-fi-fantasy].",
  '- originCountries: uppercase ISO 3166-1 alpha-2 codes (e.g. ["KR"], ["JP"], ["US"], ["VN"], ["CN"], ["TH"], ["GB"]).',
  '- originalLanguages: lowercase ISO 639-1 codes (e.g. ["ko"], ["ja"], ["vi"], ["en"]) only when clearly implied.',
  "- yearFrom / yearTo: OMIT both fields completely unless the user explicitly mentions a year, decade, or recency (like 'recent' or 'gần đây'). Never infer a movie's release year on your own.",
  "- minRating: OMIT completely unless the user explicitly asks for top-rated/highly rated titles.",
  '- sortBy: "popularity" (default), "rating", or "release_date".',
  "- summary: one concise sentence in the user's language explaining what will be searched.",
].join("\n");

/**
 * Constant-time string comparison to avoid timing leaks on shared secret checks.
 */
function timingSafeEqualString(a, b) {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  const maxLen = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < maxLen; i += 1) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

function extractGatewayToken(request) {
  const headerToken = request.headers.get("x-ai-gateway-secret");
  if (headerToken) return headerToken.trim();

  const auth = request.headers.get("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return "";
}

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

function extractTextFromAiResult(result) {
  if (!result) return null;
  if (typeof result === "string") return result;

  if (typeof result.response === "object" && result.response !== null) {
    return result.response;
  }
  if (typeof result.response === "string") {
    return result.response;
  }
  const choiceContent = result?.choices?.[0]?.message?.content;
  if (typeof choiceContent === "string") {
    return choiceContent;
  }
  return null;
}

function parseJsonLoose(raw) {
  if (raw && typeof raw === "object") return raw;
  if (typeof raw !== "string") {
    throw new Error("Empty AI response");
  }

  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Strip markdown code fences or prose wrapping JSON if a fallback model adds them.
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced && fenced[1]) {
      return JSON.parse(fenced[1].trim());
    }
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("Model did not return valid JSON");
  }
}

function sanitizeStringArray(value, limit, transform = (v) => v) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const normalized = transform(item.trim());
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= limit) break;
  }
  return out;
}

function sanitizeYear(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  if (!Number.isInteger(num) || num < 1888 || num > CURRENT_YEAR + 5) return null;
  return num;
}

function sanitizeRating(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0 || num > 10) return null;
  return Math.round(num * 10) / 10;
}

export function sanitizeIntent(raw, fallbackQuery, forcedMediaType = "all") {
  const intent = ALLOWED_INTENTS.has(raw?.intent) ? raw.intent : "hybrid";
  let mediaType = ALLOWED_MEDIA_TYPES.has(raw?.mediaType) ? raw.mediaType : "all";
  if (forcedMediaType === "movie" || forcedMediaType === "tv") {
    mediaType = forcedMediaType;
  }

  let yearFrom = sanitizeYear(raw?.yearFrom);
  let yearTo = sanitizeYear(raw?.yearTo);
  if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) {
    [yearFrom, yearTo] = [yearTo, yearFrom];
  }

  const candidateTitles = sanitizeStringArray(raw?.candidateTitles, 6);
  const keywords = sanitizeStringArray(raw?.keywords, 5);
  const genres = sanitizeStringArray(raw?.genres, 5, (g) => g.toLowerCase()).filter((g) =>
    ALLOWED_GENRES.has(g),
  );
  const originCountries = sanitizeStringArray(raw?.originCountries, 5, (c) =>
    c.toUpperCase(),
  ).filter((c) => /^[A-Z]{2}$/.test(c));
  const originalLanguages = sanitizeStringArray(raw?.originalLanguages, 4, (l) =>
    l.toLowerCase(),
  ).filter((l) => /^[a-z]{2}$/.test(l));

  const sortBy = ALLOWED_SORT_BY.has(raw?.sortBy) ? raw.sortBy : "popularity";
  const summary =
    typeof raw?.summary === "string" && raw.summary.trim()
      ? raw.summary.trim().slice(0, 200)
      : fallbackQuery;

  return {
    intent,
    mediaType,
    candidateTitles,
    keywords,
    genres,
    originCountries,
    originalLanguages,
    yearFrom,
    yearTo,
    minRating: sanitizeRating(raw?.minRating),
    sortBy,
    summary,
  };
}

function resolveModelList(env, mode) {
  const balanced = env.AI_MODEL || DEFAULT_MODEL;
  const fast = env.AI_FAST_MODEL || DEFAULT_FAST_MODEL;
  const accurate = env.AI_ACCURATE_MODEL || DEFAULT_ACCURATE_MODEL;

  if (mode === "fast") return [fast, balanced];
  if (mode === "accurate") return [accurate, balanced, fast];
  return [balanced, fast];
}

function isFormatOrJsonError(error) {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    msg.includes("json") ||
    msg.includes("response_format") ||
    msg.includes("schema") ||
    msg.includes("empty ai response")
  );
}

async function runSingleModel(env, model, userPrompt) {
  const baseInput = {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    max_tokens: MAX_TOKENS,
    temperature: 0.1,
  };

  // Prefer strict json_schema; only downgrade format if the error is format/JSON related.
  const attempts = [
    { format: "json_schema", input: { ...baseInput, response_format: { type: "json_schema", json_schema: SEARCH_INTENT_SCHEMA } } },
    { format: "json_object", input: { ...baseInput, response_format: { type: "json_object" } } },
    { format: "plain", input: baseInput },
  ];

  let lastError;
  for (let i = 0; i < attempts.length; i += 1) {
    const attempt = attempts[i];
    try {
      const result = await env.AI.run(model, attempt.input);
      const extracted = extractTextFromAiResult(result);
      const parsed = parseJsonLoose(extracted);
      return { parsed, result, formatUsed: attempt.format, attempts: i + 1 };
    } catch (error) {
      lastError = error;
      if (!isFormatOrJsonError(error)) {
        break;
      }
    }
  }
  throw lastError;
}

async function parseIntentWithAi(env, { query, language, mediaType, mode }) {
  const models = [...new Set(resolveModelList(env, mode))];
  const userPrompt = [
    `Query: ${query}`,
    language ? `UI Language: ${language}` : "",
    mediaType && mediaType !== "all" ? `Preferred mediaType: ${mediaType}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  let lastError;
  for (const model of models) {
    try {
      const { parsed, result, formatUsed, attempts } = await runSingleModel(env, model, userPrompt);
      return {
        model,
        intent: sanitizeIntent(parsed, query, mediaType),
        usage: result?.usage ?? null,
        formatUsed,
        attempts,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("All AI models failed");
}

function getCacheTtl(env) {
  const parsed = Number(env.CACHE_TTL_SECONDS ?? 1800);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function buildCacheRequest(requestUrl, env, { query, language, mediaType, mode }) {
  const primaryModel = resolveModelList(env, mode)[0] || DEFAULT_MODEL;
  const url = new URL(requestUrl);
  url.pathname = `/__cache/${PROMPT_VERSION}/search-intent`;
  url.search = "";
  url.searchParams.set("q", query.toLowerCase());
  url.searchParams.set("lang", (language || "").toLowerCase());
  url.searchParams.set("type", mediaType || "all");
  url.searchParams.set("mode", mode || "balanced");
  url.searchParams.set("model", primaryModel);
  return new Request(url.toString(), { method: "GET" });
}

export default {
  async fetch(request, env, ctx) {
    const startedAt = Date.now();
    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
      return jsonResponse({
        ok: true,
        service: "framezoo-ai-gateway",
        model: env.AI_MODEL || DEFAULT_MODEL,
        hasAiBinding: Boolean(env.AI),
        authConfigured: Boolean(env.GATEWAY_SECRET),
      });
    }

    if (request.method !== "POST" || (url.pathname !== "/v1/search-intent" && url.pathname !== "/")) {
      return jsonResponse({ ok: false, error: "Not found" }, 404);
    }

    // Fail closed when GATEWAY_SECRET is missing so an open workers.dev URL cannot drain quota.
    if (!env.GATEWAY_SECRET) {
      return jsonResponse(
        { ok: false, error: "GATEWAY_SECRET is not configured on Worker" },
        503,
      );
    }

    const token = extractGatewayToken(request);
    if (!token || !timingSafeEqualString(token, env.GATEWAY_SECRET)) {
      return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
    }

    if (!env.AI) {
      return jsonResponse({ ok: false, error: "Workers AI binding `AI` is missing" }, 500);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400);
    }

    const query = typeof body?.query === "string" ? body.query.trim().replace(/\s+/g, " ") : "";
    if (!query) {
      return jsonResponse({ ok: false, error: "`query` is required" }, 400);
    }
    if (query.length > MAX_QUERY_LENGTH) {
      return jsonResponse(
        { ok: false, error: `\`query\` must be at most ${MAX_QUERY_LENGTH} characters` },
        400,
      );
    }

    const language = typeof body?.language === "string" ? body.language.trim().slice(0, 16) : "";
    const mediaType = ALLOWED_MEDIA_TYPES.has(body?.mediaType) ? body.mediaType : "all";
    const mode =
      body?.mode === "fast" || body?.mode === "accurate" || body?.mode === "balanced"
        ? body.mode
        : "balanced";

    const cacheTtl = getCacheTtl(env);
    const cache = typeof caches !== "undefined" ? caches.default : null;
    const cacheKey = cache && cacheTtl > 0
      ? buildCacheRequest(request.url, env, { query, language, mediaType, mode })
      : null;

    if (cache && cacheKey) {
      const cached = await cache.match(cacheKey);
      if (cached) {
        const data = await cached.json();
        return jsonResponse({
          ...data,
          cached: true,
          meta: { ...data.meta, latencyMs: Date.now() - startedAt },
        });
      }
    }

    try {
      const aiResult = await parseIntentWithAi(env, { query, language, mediaType, mode });
      const payload = {
        ok: true,
        model: aiResult.model,
        cached: false,
        intent: aiResult.intent,
        meta: {
          latencyMs: Date.now() - startedAt,
          formatUsed: aiResult.formatUsed,
          attempts: aiResult.attempts,
          usage: aiResult.usage,
        },
      };

      if (cache && cacheKey && ctx?.waitUntil) {
        const cacheable = new Response(JSON.stringify(payload), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": `public, max-age=${cacheTtl}`,
          },
        });
        ctx.waitUntil(cache.put(cacheKey, cacheable));
      }

      return jsonResponse(payload, 200);
    } catch (error) {
      return jsonResponse(
        {
          ok: false,
          error: "Workers AI inference failed",
          detail: error instanceof Error ? error.message : String(error),
        },
        502,
      );
    }
  },
};
