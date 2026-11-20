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
| `SELF` | Service binding to this worker (`meridian-desk`) so drive hops do not use same-zone public fetch |

Cron `15 8 * * *` calls the scheduled handler. It deletes customer rows and restores a fixed fictional desk: a quote waiting on CRM and email approval, a quote already approved into the sandbox outbox, a spam inquiry, a human review, CRM rows, one call, and audit rows. It does not call the model. `daily_counters` and `rate_buckets` are not deleted. Customer rows survive a normal redeploy, because they live in D1.

`worker/migrations/0003_step_model.sql` adds `agent_steps.model`. `worker/migrations/0004_step_times.sql` adds `agent_steps.started_at` and `agent_steps.finished_at`. `worker/migrations/0005_outbound.sql` adds opt-in, suppression, outbound call rows, and email provider status. `worker/migrations/0006_suppressions.sql` adds the address-level `suppressions` table. The worker applies them on the next request. No new D1 migration for the drive fix. Redeploy with the `SELF` service binding from `worker/wrangler.toml` / `worker/bindings.json`. Leave `OUTBOUND_EMAIL_ENABLED` unset until the public confirm and unsubscribe pages have been checked. After a lead confirms, the worker continues the run one step per request through `env.SELF.fetch` (in-process when `SELF` is missing). A confirmed inquiry with no run after one minute, or a run still `running` after two minutes, is picked up on the next request and by the daily cron.

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
| `LLM_PROVIDER` | var | `workers-ai` in production |
| `WORKERS_AI_MODEL` | var | `@cf/openai/gpt-oss-120b` |
| `WORKERS_AI_FALLBACK_MODEL` | var | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` |
| `GEMINI_API_KEY` | secret | Google Gemini API key (free tier). Used after Workers AI 4006, 5xx, or timeout. |
| `GEMINI_MODEL` | var | Default `gemini-2.5-flash`. Free Flash model id for the Gemini fallback. |
| `PUBLIC_ORIGIN` | var | `https://sales.quvantic.com` |
| `RESEND_API_KEY` | secret | Sending key for Resend. Do not commit it. |
| `EMAIL_FROM` | var | Default `Meridian Desk <desk@quvantic.com>` |
| `EMAIL_REPLY_TO` | var | Optional reply-to address |
| `OUTBOUND_EMAIL_ENABLED` | var | `true` sends through Resend for a verified public-form lead. Default `false`. |
| `OUTBOUND_CALLS_ENABLED` | var | `true` allows phone mode. Default `false`. |
| `VAPI_OUTBOUND_PHONE_NUMBER_ID` | secret | Vapi phone number id. Phone mode also needs `VAPI_PRIVATE_KEY`. |
| `FOLLOW_UP_AFTER_DAYS` | var | Days before one follow-up draft. Default `2`. |
| `CALL_WINDOW_TZ` | var | Default `Asia/Kuala_Lumpur`. Calls run 09:00–20:00 in that zone. |
| `SESSION_SECRET` | secret | Signs opt-in, unsubscribe, and call links. |

`wrangler.toml` already sets the non-secret vars for local `wrangler dev`.

Approved mail for seeded and unverified inquiries stays in the sandbox outbox. A public-form lead who confirms the opt-in link is sent through Resend when `OUTBOUND_EMAIL_ENABLED` is `true`. `EMAIL_API_URL` is only for the local mock email API used by `pnpm dev`, Docker, and CI. Do not set it on the worker.

The nightly cron restores the fixture inquiries described above. It does not delete `daily_counters` or `rate_buckets`.

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

Node.js is 22.x. The app still depends on `better-sqlite3`, which does not build on Vercel’s default Node. `apps/web/package.json` sets `engines.node` to `22.x`, and `.nvmrc` is `22`. Set the Vercel project Node version to 22.x.

Do not set `DATABASE_PATH` on Vercel. With `WORKER_URL` set, the console does not open SQLite. `DATABASE_PATH` is for local, Docker, and CI only. A previous stopgap used `DATABASE_PATH=/tmp/meridian.sqlite` because pages opened an empty database; that stopgap is not part of this deploy.

Forward the visitor IP as `x-visitor-ip` when the Next app calls the worker. The worker trusts that header only when the request has `Authorization: Bearer WORKER_AUTH_TOKEN`. A direct call is limited by `CF-Connecting-IP`.

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
