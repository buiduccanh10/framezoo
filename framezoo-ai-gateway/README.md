# Framezoo AI Gateway (Cloudflare Workers AI)

Cloudflare Worker converting natural-language movie & TV queries (Vietnamese / English) into structured TMDB-ready search intents.

## Endpoints

- `GET /health` — Health & configuration check (does not expose secrets).
- `POST /v1/search-intent` (or `POST /`) — Parses a natural-language query into structured JSON.
  - Headers: `Authorization: Bearer <GATEWAY_SECRET>` (or `X-AI-Gateway-Secret: <GATEWAY_SECRET>`)
  - Body:
    ```json
    {
      "query": "phim tâm lý Hàn Quốc có plot twist giống Parasite khoảng 2018 trở lại",
      "language": "vi",
      "mediaType": "all",
      "mode": "balanced"
    }
    ```

## Setup & Deploy

### Option A — Deploy via Wrangler CLI (Recommended)
```bash
cd framezoo-ai-gateway
pnpm install
npx wrangler login
npx wrangler secret put GATEWAY_SECRET
npx wrangler deploy
```

### Option B — Quick Edit in Cloudflare Dashboard
1. Open **Workers & Pages -> `framezoo-ai-gateway` -> Settings -> Variables and Secrets**.
2. Add **Secret** `GATEWAY_SECRET` (random 32+ char string).
3. Add **Environment Variables** (optional, defaults exist in code):
   - `AI_MODEL` = `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
   - `AI_FAST_MODEL` = `@cf/meta/llama-3.1-8b-instruct-fp8-fast`
   - `AI_ACCURATE_MODEL` = `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
4. Ensure **Bindings** has `AI` -> **Workers AI** (already configured).
5. Click **Edit code** and paste the contents of `src/worker.mjs`, then **Deploy**.

## Test

```bash
curl -sS -X POST "https://framezoo-ai-gateway.buiduccanh10.workers.dev/v1/search-intent" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_GATEWAY_SECRET" \
  -d '{"query":"phim có anh chàng bị mất trí nhớ sau mỗi vài phút","language":"vi"}' | jq
```
