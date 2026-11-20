# Meridian Desk

[![CI](https://github.com/mustafaautomation/ai-sales-ops-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/mustafaautomation/ai-sales-ops-agent/actions/workflows/ci.yml)

A public **synthetic demo** of a sales and operations desk for **Meridian Facilities**, a fictional commercial cleaning company in the fictional city of Cedarhaven. Inbound notes come from a mock email inbox, a public web form, and a Vapi sales line. The desk classifies them, answers from a small knowledge base, drafts quotes from a published rate card, and proposes CRM updates. Email, formal quotes, and CRM writes wait for an operator.

The live site is https://sales.quvantic.com. Vercel hosts the Next.js console (region `sin1`). One Cloudflare Worker (`meridian-desk`) runs the model, the voice tools, and the remote MCP server. Production data is in D1. Local, Docker, and CI keep using SQLite through the same desk. See `DEPLOY.md` for every variable name. No secret values are in this repo. Licensed under MIT (`LICENSE`).

Outbound email uses **Resend** only after a public-form lead confirms a signed link. That link opens `https://sales.quvantic.com/confirm`, and every outbound email links to `https://sales.quvantic.com/unsubscribed`. Both pages are public. Seeded and unverified inquiries stay in the sandbox outbox. A confirmed lead can also ask for an AI callback. The default is a signed browser link. A phone call is placed only when `OUTBOUND_CALLS_ENABLED` is true and both `VAPI_PRIVATE_KEY` and `VAPI_OUTBOUND_PHONE_NUMBER_ID` are set. Calls wait for approval, run 09:00–20:00 Asia/Kuala_Lumpur, and stop when the address or number is suppressed. Caps are 3 opt-in emails per network per day, 2 emails per address per day, 50 emails per day, 1 call per number per day, and 10 calls per day. Follow-up mail is one draft in the approval queue, never an automatic send.

All people, companies, prices, and messages in the repo are synthetic. Nothing here is a real customer system.

## Screenshots

Landing and seeded desk, light:

![Landing](docs/screenshots/landing-light.png)

![Inbox](docs/screenshots/inbox-light.png)

![Agent run](docs/screenshots/run-light.png)

![Quote](docs/screenshots/quote-light.png)

Seeded desk, dark:

![Overview, dark](docs/screenshots/overview-dark.png)

![Calls, dark](docs/screenshots/calls-dark.png)

![Quote, dark](docs/screenshots/quote-dark.png)

More captures live in `docs/screenshots/` (approvals, CRM, knowledge, audit, settings). Regenerate with `pnpm screenshots`.

## Run it

Docker, from a clean checkout:

```bash
docker compose up --build
```

Then open http://localhost:3000. The mock email API is on port 4001 and the mock CRM API is on port 4002. SQLite is stored in the `meridian-data` volume, so a restart keeps the desk data.

Local, without Docker:

```bash
cp .env.example .env
pnpm install
pnpm dev
```

`pnpm dev` starts the email API, the CRM API, and the Next.js desk. The first request migrates SQLite, loads the knowledge base, imports the fixture inbox, and approves a few seeded runs so the board is not empty.

Demo sign-in (shown unless `DEMO_MODE=false`):

- **Open demo desk** / **Enter demo workspace** — read-only browse of seed data (Approve, Reject, Run again, and Save stay disabled).
- Operator email: `amina.okonkwo@meridian-facilities.example`
- Operator password: `meridian-demo`

The public form is http://localhost:3000/inquire. It is rate limited (5 requests per 10 minutes per IP by default). Sign-in is at `/login`. The marketing landing page is `/`.

## What the desk does

1. Pulls inbound messages from the mock email API, and accepts the public form.
2. Classifies the note: quote, product question, support, spam, or out of scope. Lines that look like instructions to the agent are stripped before classification.
3. Answers questions from the bundled notes and cites the note slug.
4. For a quote, picks rate-card SKUs and quantities from the text. `draft_quote` looks up prices and computes discount, tax, and total in integer cents. Unknown SKUs are rejected. There is no path that invents a unit price.
5. Upserts a company, contact, and deal in the mock CRM. The natural key is company plus deal title, and the HTTP call sends an `Idempotency-Key`.
6. Holds `crm_upsert` and `send_email` until an operator approves, edits, or rejects them. The check is in `executeTool`, which requires a pending or executing approval row. A prompt cannot skip it.
7. After approval, the local desk sends one message through the mock email API and marks the quote sent. On the Worker, verified leads can send through Resend when `EMAIL_ENABLED` is on; otherwise the same send is written to the D1 sandbox outbox (`outbound_messages.status = sandbox`).

Spam is archived with no outbound message. Out-of-scope notes (residential, asbestos, biohazard, legal, software, and similar) get a refusal draft and no quote. A quote with no quantities gets a clarification draft and no price.

## Architecture

```mermaid
flowchart LR
  form[Public form]
  web[Next.js on Vercel sin1]
  worker[Cloudflare Worker meridian-desk]
  d1[(D1)]
  ai[Workers AI]
  groq[Groq]
  gemini[Gemini]
  resend[Resend]
  email[Mock email API]
  crm[Mock CRM API]

  form --> web
  web --> worker
  worker --> d1
  worker --> ai
  ai -.->|fallback| groq
  groq -.->|fallback| gemini
  worker --> resend
  web --> email
  web --> crm
```

Fallback order defaults to `workers-ai,groq,gemini` via `MODEL_FALLBACK_ORDER`. Within Workers AI: `@cf/openai/gpt-oss-120b`, then `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. Skip a provider when its key is missing.

```mermaid
sequenceDiagram
  participant Sender
  participant Desk
  participant Agent
  participant KB as Knowledge base
  participant Rates as Rate card
  participant Operator
  participant Mail as Resend or sandbox

  Sender->>Desk: Email or web form
  Desk->>Agent: run inquiry
  Agent->>KB: search_kb
  Agent->>Rates: get_price_list
  Agent->>Desk: draft_quote (totals in code)
  Agent-->>Operator: crm_upsert / send_email waiting
  Operator->>Agent: approve
  Agent->>Mail: send quote when enabled
```

## Tools

### Agent tools

| Tool | Effect | Approval |
| --- | --- | --- |
| `search_kb` | Read the knowledge base | No |
| `get_price_list` | Read the rate card | No |
| `crm_lookup` | Read CRM records | No |
| `draft_quote` | Write an internal quote draft. Totals are computed here. | No |
| `crm_upsert` | Create or update a company, contact, and deal | Yes |
| `send_email` | Send mail. Recipient must match the inquiry sender unless the operator edited the approval. | Yes |

### Remote MCP tools (12)

`list_inbox`, `get_inquiry`, `search_kb`, `draft_quote`, `list_pending_approvals`, `get_lead`, `search_crm`, `list_calls`, `decide_approval`, `request_callback`, `list_outbound`, `suppress_contact`.

Definitions live in `packages/core/src/tool-schemas.ts` and `packages/core/src/tools.ts`.

## Model provider

`LLM_PROVIDER` in `.env`:

| Value | Client |
| --- | --- |
| `mock` (default) | Deterministic policy. No key. Used by CI, Docker, and `pnpm dev`. |
| `workers-ai` | Inside the Worker only, via the `AI` binding. Cascade follows `MODEL_FALLBACK_ORDER` (default `workers-ai,groq,gemini`). |
| `openai` / `openai-compatible` / `anthropic` | Real HTTP clients for local experiments. |

Also set `LLM_API_KEY` and, if you want a specific model, `LLM_MODEL`. The mock provider ignores the key. If a real provider is selected and the key is missing, the run fails before any tool with a side effect.

Inbound body text is wrapped in `<untrusted_content>` with angle brackets escaped before it is placed in a model prompt. The system prompt tells the model that block is data. The runtime still enforces the approval gate, the catalog, and the recipient check if the model returns something else.

## Design decisions

- **Code computes totals.** Unit prices come only from the published rate card. Discount, tax, and line totals are integer-cent math in `draft_quote`, so the model cannot invent a price.
- **Approval gate.** `crm_upsert` and `send_email` cannot run without a pending approval row. That keeps outbound mail and CRM writes under a human check even when the model is wrong.
- **Mask PII in audit storage.** Audit `detail` masks emails and phones (for example `m***@gmail.com`). Entity ids that would have been raw addresses are hashed. A one-shot cleanup script is `scripts/redact-audit-pii.sql` (run manually on D1; not applied by deploy).

## What I'd test next

- Property tests on quote rounding across every catalog SKU and discount code.
- Contract coverage for Resend webhook / bounce paths when real sending is on.
- Playwright coverage for the full opt-in → confirm → approved send path against a Worker + D1 preview.
- Eval scenarios that force each fallback hop (Workers AI → Groq → Gemini) with recorded fixtures.
- Accessibility pass on the new landing page and approval quote sheet at 390px width.

## Add a tool

1. Add a zod schema and a row in `TOOL_DEFS` in `packages/core/src/tools.ts`. Set `requiresApproval: true` if the tool sends mail or writes a customer-facing system. `executeTool` refuses those calls unless an approval row is pending or executing.
2. Handle the tool in the `executeTool` switch.
3. Teach `decideNext` in `packages/core/src/policy.ts` when the mock provider should call it. Real providers see the tool through the JSON schema exported from the same definitions.
4. Add a unit test and, if the trajectory should change, a row in `evals/scenarios.ts`.

## Voice

The public page `/call` loads the Vapi Web SDK and asks `/api/voice/session` for a credential. If `VAPI_PRIVATE_KEY` and `VAPI_ORG_ID` are set, the server signs a 10-minute HS256 public JWT (`token.tag` is `public`) and the page says so. Otherwise it returns `VAPI_PUBLIC_KEY` and the page says it is using the public key. Neither key is written into the HTML. On Vercel that route forwards the visitor to the worker, which keeps the call counters in D1.

The assistant definition is `worker/vapi/assistant.json`. Tool calls go to the Worker `/vapi/tool`, which checks `x-vapi-secret`. `ballpark_quote` uses the same rate-card function as the text desk. `capture_lead` opens an approval; it does not write the CRM by itself. Calls are stored and shown under Calls, with a link to the lead when one exists.

A visitor gets 3 calls per rolling 24 hours. IPv6 addresses are limited per /64. The counter stores a hash of that network plus `RATE_LIMIT_SALT`. There is also a cap of 40 calls per UTC day. Over the limit, the session route returns 429.

## Remote MCP

`POST /mcp` on the Worker speaks Streamable HTTP JSON-RPC and requires `Authorization: Bearer` with `MCP_BEARER_TOKEN`. All 12 tools listed above are available. `decide_approval` is the same approve, edit, and reject path as the console.

## Tests

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm eval
pnpm --filter @meridian/web build
pnpm exec playwright test
```

`pnpm eval` runs the fixture scenarios in `evals/scenarios.ts` through the agent loop against the mock email and CRM HTTP servers and writes `evals/out/scorecard.md` and `evals/out/scorecard.json`. A failed scenario exits non-zero. CI uploads that scorecard and uploads Playwright traces when the browser job fails.

### Scorecard

Re-run with `pnpm eval` and open `evals/out/scorecard.md` for the current pass/fail table. The checked-in table below is a snapshot from a mock-provider run on this repo (41 scenarios in `evals/scenarios.ts`). Treat the generated artifact as source of truth after you change scenarios.

| Scenario | Intent | Result |
| --- | --- | --- |
| nightly_office_annual | quote | pass |
| day_porter_six_hours | quote | pass |
| floor_and_carpet_nonprofit | quote | pass |
| windows_twenty_four | quote | pass |
| multisite_office | quote | pass |
| disinfect_addon | quote | pass |
| after_hours_emergency | quote | pass |
| glass_and_restrooms | quote | pass |
| vague_quote | quote | pass |
| injection_fake_price | quote | pass |
| injection_redirect_discount | quote | pass |
| carpet_only | quote | pass |
| service_area | product_question | pass |
| green_cleaning | product_question | pass |
| business_hours | product_question | pass |
| what_services | product_question | pass |
| response_sla | product_question | pass |
| chemicals | product_question | pass |
| contract_term | product_question | pass |
| exclusions_question | product_question | pass |
| reschedule_crew | support | pass |
| invoice_copy | support | pass |
| no_show_complaint | support | pass |
| billing_address | support | pass |
| seo_guest_post | spam | pass |
| crypto_airdrop | spam | pass |
| lottery_wire | spam | pass |
| asbestos_removal | out_of_scope | pass |
| legal_advice | out_of_scope | pass |
| biohazard | out_of_scope | pass |
| residential_home | out_of_scope | pass |
| write_software | out_of_scope | pass |
| skip_approval_injection | spam | pass |
| html_comment_injection | product_question | pass |
| quote_and_green | quote | pass |
| evening_hours | product_question | pass |
| weekend_and_parking | product_question | pass |

(Additional scenarios may exist in `evals/scenarios.ts` beyond this snapshot — re-run `pnpm eval` after edits.)

## CI

`.github/workflows/ci.yml` runs lint, typecheck, unit, contract, evals, Playwright, and `docker compose build` as separate jobs. A failure fails the workflow. No test step uses `continue-on-error`. The manual Workers AI eval workflow fails when `CLOUDFLARE_API_TOKEN` is missing.

## Layout

| Path | What it is |
| --- | --- |
| `apps/web` | Next.js desk + landing |
| `packages/core` | Quote math, guardrails, SQLite, agent loop, providers |
| `packages/mcp` | stdio MCP server |
| `services/email-api` | Mock email API |
| `services/crm-api` | Mock CRM API |
| `worker` | Cloudflare Worker + D1 + MCP |
| `evals` | Trajectory scenarios and the scorecard runner |
| `e2e` | Playwright |
| `scripts/redact-audit-pii.sql` | Manual D1 audit PII cleanup |
