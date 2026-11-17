import assert from "node:assert/strict";
import test from "node:test";

import worker, { sanitizeIntent } from "../src/worker.mjs";

function makeEnv(overrides = {}) {
  return {
    GATEWAY_SECRET: "test-secret-123",
    AI_MODEL: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    AI_FAST_MODEL: "@cf/meta/llama-3.1-8b-instruct-fp8-fast",
    AI_ACCURATE_MODEL: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    CACHE_TTL_SECONDS: "0",
    AI: {
      async run() {
        return {
          response: JSON.stringify({
            intent: "discover",
            mediaType: "movie",
            candidateTitles: ["Parasite", "Memories of Murder"],
            keywords: ["plot twist", "psychological"],
            genres: ["thriller", "drama", "non-existent-genre"],
            originCountries: ["kr", "invalid"],
            originalLanguages: ["KO", "toolong"],
            yearFrom: 2018,
            yearTo: 2026,
            minRating: 7.54,
            sortBy: "rating",
            summary: "Phim tâm lý Hàn Quốc có plot twist từ 2018.",
          }),
          usage: { prompt_tokens: 200, completion_tokens: 90 },
        };
      },
    },
    ...overrides,
  };
}

test("GET /health reports status without leaking secret", async () => {
  const res = await worker.fetch(new Request("https://example.workers.dev/health"), makeEnv());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, "framezoo-ai-gateway");
  assert.equal(body.hasAiBinding, true);
  assert.equal(body.authConfigured, true);
  assert.equal(body.GATEWAY_SECRET, undefined);
});

test("POST fails closed with 503 if GATEWAY_SECRET is unset", async () => {
  const res = await worker.fetch(
    new Request("https://example.workers.dev/v1/search-intent", {
      method: "POST",
      body: JSON.stringify({ query: "phim hay" }),
    }),
    makeEnv({ GATEWAY_SECRET: "" }),
  );
  assert.equal(res.status, 503);
});

test("POST rejects missing or wrong secret with 401", async () => {
  const res = await worker.fetch(
    new Request("https://example.workers.dev/v1/search-intent", {
      method: "POST",
      headers: { authorization: "Bearer wrong" },
      body: JSON.stringify({ query: "phim hay" }),
    }),
    makeEnv(),
  );
  assert.equal(res.status, 401);
});

test("POST parses and sanitizes Workers AI response", async () => {
  const res = await worker.fetch(
    new Request("https://example.workers.dev/v1/search-intent", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-secret-123",
      },
      body: JSON.stringify({
        query: "phim tâm lý Hàn Quốc có plot twist từ 2018",
        language: "vi",
      }),
    }),
    makeEnv(),
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.model, "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
  assert.deepEqual(body.intent.genres, ["thriller", "drama"]);
  assert.deepEqual(body.intent.originCountries, ["KR"]);
  assert.deepEqual(body.intent.originalLanguages, ["ko"]);
  assert.equal(body.intent.minRating, 7.5);
  assert.equal(body.intent.yearFrom, 2018);
});

test("POST falls back to AI_FAST_MODEL when primary model fails", async () => {
  const calls = [];
  const env = makeEnv({
    AI: {
      async run(model, input) {
        calls.push({ model, format: input.response_format?.type ?? "plain" });
        if (model === "@cf/meta/llama-3.3-70b-instruct-fp8-fast") {
          throw new Error("model unavailable");
        }
        if (input.response_format?.type === "json_schema") {
          throw new Error("json_schema unsupported");
        }
        return {
          response: '```json\n{"intent":"title_lookup","mediaType":"movie","candidateTitles":["Memento"],"keywords":["memory loss"],"genres":["mystery","thriller"],"originCountries":["US"],"sortBy":"popularity","summary":"Tìm phim Memento"}\n```',
        };
      },
    },
  });

  const res = await worker.fetch(
    new Request("https://example.workers.dev/v1/search-intent", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ai-gateway-secret": "test-secret-123",
      },
      body: JSON.stringify({ query: "phim anh chàng mất trí nhớ mỗi 10 phút" }),
    }),
    env,
  );

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.model, "@cf/meta/llama-3.1-8b-instruct-fp8-fast");
  assert.deepEqual(body.intent.candidateTitles, ["Memento"]);
  assert.equal(calls.length, 3);
});

test("sanitizeIntent swaps inverted years and enforces forced mediaType", () => {
  const result = sanitizeIntent(
    {
      intent: "bad",
      mediaType: "movie",
      yearFrom: 2022,
      yearTo: 2010,
      minRating: 15,
    },
    "test query",
    "tv",
  );
  assert.equal(result.intent, "hybrid");
  assert.equal(result.mediaType, "tv");
  assert.equal(result.yearFrom, 2010);
  assert.equal(result.yearTo, 2022);
  assert.equal(result.minRating, null);
});
