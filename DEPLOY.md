# Deploy Meridian

You deploy. This file names every variable. It does not contain secret values.

The public site is https://sales.quvantic.com. The console is the same Next.js app. The agent, voice tools, and remote MCP run on one Cloudflare Worker.

## 1. D1

Create a D1 database named `meridian`. Apply the SQL files in order:

```bash
wrangler d1 execute meridian --file worker/migrations/0001_init.sql
wrangler d1 execute meridian --file worker/migrations/0002_calls.sql
```

Put the database id in `worker/wrangler.toml` and `worker/bindings.json`.

## 2. Worker bundle

```bash
pnpm --filter @meridian/worker build
```

The upload file is `worker/dist/worker.js`. It is one ESM module. The default export is `fetch`, and it also exports the `RateLimiter` Durable Object class.

Bindings, from `worker/bindings.json`:

| Binding | Kind |
| --- | --- |
| `DB` | D1 database `meridian` |
| `AI` | Workers AI |
| `RATE_LIMITER` | Durable Object class `RateLimiter` (SQLite backend, migration tag `v1`) |

Cron `15 8 * * *` calls the scheduled handler, which reseeds demo rows. Customer rows do not survive that reset. They do survive a normal redeploy, because they live in D1.

### Worker secrets and vars

Set these by name. Do not commit values.

| Name | Kind | Purpose |
| --- | --- | --- |
| `WORKER_AUTH_TOKEN` | secret | Bearer token the Vercel app sends to `/api/*` |
| `MCP_BEARER_TOKEN` | secret | Bearer token for `POST /mcp` |
| `VAPI_SECRET` | secret | Expected `x-vapi-secret` on `/vapi/tool` and `/vapi/events` |
| `VAPI_PRIVATE_KEY` | secret | Signs a 10-minute public Vapi JWT when present |
| `VAPI_ORG_ID` | secret | `orgId` claim for that JWT |
| `VAPI_PUBLIC_KEY` | secret | Returned to the browser only when the private key is absent |
| `VAPI_ASSISTANT_ID` | secret | Assistant the Web SDK starts |
| `RATE_LIMIT_SALT` | secret | Salt for hashed visitor IPs |
| `EMAIL_API_URL` | var | Mock email API base URL. The worker never opens an SMTP connection |
| `LLM_PROVIDER` | var | `workers-ai` in production |
| `WORKERS_AI_MODEL` | var | `@cf/openai/gpt-oss-120b` |
| `WORKERS_AI_FALLBACK_MODEL` | var | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` |
| `PUBLIC_ORIGIN` | var | `https://sales.quvantic.com` |

`wrangler.toml` already sets the non-secret vars for local `wrangler dev`.

## 3. Vapi assistant

`worker/vapi/assistant.json` is the assistant body. Replace `${WORKER_PUBLIC_URL}` with the worker origin, then create the assistant with the Vapi API. Point the tool server credential at header `x-vapi-secret` with the same value as `VAPI_SECRET`. `maxDurationSeconds` is 240.

## 4. Vercel

From `apps/web`, after the worker is up:

```bash
vercel deploy --prod
```

| Name | Kind | Purpose |
| --- | --- | --- |
| `WORKER_URL` | var | Worker origin. When set, the console reads and writes through the worker |
| `WORKER_AUTH_TOKEN` | secret | Same value as the worker secret |
| `SESSION_SECRET` | secret | Console cookie signing |
| `DEMO_MODE` | var | `true` shows the demo sign-in |
| `VAPI_SECRET` | secret | Local route `/api/vapi/events` if you are not proxying events to the worker |
| `VAPI_PRIVATE_KEY` | secret | Optional. Same key as the worker if the Next route mints the JWT |
| `VAPI_ORG_ID` | secret | Required only when minting the JWT on Vercel |
| `VAPI_PUBLIC_KEY` | secret | Fallback Web SDK key. Not written into the page source |
| `VAPI_ASSISTANT_ID` | secret | Assistant id |
| `PUBLIC_ORIGIN` | var | `https://sales.quvantic.com` |
| `RATE_LIMIT_SALT` | secret | Same salt if the Next route counts calls |
| `LLM_PROVIDER` | var | Leave `mock` on Vercel. The model runs in the worker |

Forward the visitor IP as `x-visitor-ip` when the Next app calls the worker. The worker also reads `CF-Connecting-IP` on direct requests.

Demo login stays `amina.okonkwo@meridian-facilities.example` / `meridian-demo`.

## 5. MCP clients

Claude Desktop and Cursor, after you set `MCP_BEARER_TOKEN`:

```json
{
  "mcpServers": {
    "meridian": {
      "url": "https://YOUR_WORKER_HOST/mcp",
      "headers": { "Authorization": "Bearer YOUR_MCP_BEARER_TOKEN" }
    }
  }
}
```

The stdio server is still `pnpm mcp` for a local database.
