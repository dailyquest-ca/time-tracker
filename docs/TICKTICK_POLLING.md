# TickTick → time tracker sync

Status: **Built, pending deploy.** The Phase 0 gate passed on 2026-08-10 (headless
run succeeded without a browser). Remaining work is operational — run the
migration, seed the tokens, add the Actions secret.

## Deploy checklist

```bash
# 1. Local: authorize once and prove headless refresh works
npm run ticktick:spike
npm run ticktick:spike -- --headless

# 2. Create integration_tokens + events.source_etag
npm run db:migrate:ticktick

# 3. Copy the spike's credentials into the database
npm run ticktick:seed
```

4. Add `CRON_SECRET` to the repo's **Actions secrets** (reuse the Vercel value).
5. Optionally set an `APP_URL` Actions **variable**; the workflow falls back to
   `https://time-tracker-cyan-tau.vercel.app`.
6. Deploy, then trigger `ticktick-sync` manually from the Actions tab to confirm
   a 200 and a sane summary before relying on the schedule.

## Design

TickTick becomes a second, additive source of time entries. The Google Calendar
pipeline is untouched and keeps running in parallel.

```
GitHub Action (*/10)  →  GET /api/cron/ticktick-sync  (Bearer CRON_SECRET)
                              │
                              └─ MCP client → https://mcp.ticktick.com
                                 (JSON-RPC 2.0 over Streamable HTTP, no LLM)
                              └─ upsert events, recompute daily totals
```

TickTick has no webhooks, so this polls. Vercel Hobby cron is daily-only, hence
the GitHub Action — the repo is public, so Actions minutes are free. Total cost
of the schedule: $0.

**A time entry from TickTick** = a task with both a start and a due time.
Duration is `due − start`. All-day and undated tasks are excluded, matching the
existing hour-log convention and how the calendar sync skips all-day events.

## Which lists are synced

Lists are resolved by **folder membership**, not by a hardcoded id table:
every list whose `groupId` is the WSBC folder is in scope, so lists added to the
folder later are picked up with no code change.

| Thing | ID |
|---|---|
| WSBC folder (project group) | `6a7a7032e42bdd11f74ff016` |
| `🤖ELAN` list (only member as of 2026-08-10) | `6a7a6ff28f08f1b21296dc98` |

The category is the list name with its leading emoji stripped, so `🤖ELAN` files
under the existing `ELAN` category. This matters because task titles often carry
no acronym — "Wrapping up Product Planning tasks" would otherwise land in
"General tasks/meetings". `lib/ticktick.ts` holds these rules.

## Phase 0 — headless OAuth spike (GATE)

Everything waits on this. All TickTick access so far has ridden an authenticated
Claude connector session; this proves a standalone client can authenticate with
no browser and no Claude involvement.

```bash
npm run ticktick:spike              # Run 1 — approve in a browser
npm run ticktick:spike -- --headless # Run 2 — must succeed cold, no browser
```

**Acceptance:** Run 2 passes in a fresh process without opening a browser.

**Stop conditions** — report rather than work around:

- No refresh token is issued.
- Dynamic registration is refused with no manual app-registration alternative.
- Tokens are bound to session lifetime.

Do **not** fall back to TickTick's unofficial `api/v2` endpoints without
discussing it first.

### What discovery already tells us (probed 2026-08-10)

```
/.well-known/oauth-protected-resource
  authorization_servers : https://ticktick.com/
  scopes_supported      : tasks:read, tasks:write

/.well-known/oauth-authorization-server
  authorization_endpoint            : https://ticktick.com/oauth/authorize
  token_endpoint                    : https://api.ticktick.com/oauth/token
  registration_endpoint             : https://api.ticktick.com/oauth/register
  client_registration_types_supported: dynamic
  grant_types_supported             : authorization_code
  code_challenge_methods_supported  : plain, S256
```

- ✅ Dynamic client registration is offered.
- ⚠️ `refresh_token` is **not** advertised in `grant_types_supported`. TickTick's
  classic OAuth did honour the refresh grant (see `lib/ticktick.ts` at commit
  `abb6f44`), and the endpoints above are that same OAuth system, so it may work
  regardless — but this is the gate's real risk. The spike asks for the refresh
  grant by default; if registration is rejected as invalid client metadata,
  re-run with `TICKTICK_SPIKE_NO_REFRESH_GRANT=1` to see whether a refresh token
  is issued anyway.

## What was built

| File | Role |
|---|---|
| `lib/ticktick.ts` | Pure rules: folder selection, timed-task filter, Vancouver bucketing, list-name categories |
| `lib/ticktick-client.ts` | MCP client; OAuth backed by `integration_tokens` |
| `lib/ticktick-sync.ts` | Window maths, upsert, etag skip, deletion reconciliation |
| `app/api/cron/ticktick-sync/route.ts` | Bearer `CRON_SECRET` entrypoint |
| `.github/workflows/ticktick-sync.yml` | `3-59/10 * * * *` schedule + keepalive |
| `drizzle/0007_ticktick_integration.sql` | `integration_tokens`, `events.source_etag`, `(source_type, date)` index |

Only `integration_tokens` and `source_etag` were genuinely new — `events` already
had `source_type` / `source_id` / `source_group` with a unique constraint on
`(source_type, source_id)`, so no discriminator migration was needed.

Each run reconciles `[now − LOOKBACK_DAYS, now + 2 days]`, clamped to the cutover
date. Rows outside that window are frozen history and are never deleted.

## Known limitation: no refresh token

The Phase 0 spike confirmed TickTick issues **no refresh token** to a
dynamically registered client. Consequences:

- A headless run only proves the *current* access token still works. It does not
  prove the sync survives expiry.
- When the access token expires, the sync stops and **only a human can restart
  it**. There is no unattended recovery.

Mitigations in place:

- Every run reports `tokenState` and `tokenExpiresInDays`. The workflow raises a
  GitHub `::warning::` once inside the 14-day window, so the deadline is visible
  in the Actions tab before it bites.
- An expired token fails with `TickTickNotConnectedError` naming the fix, rather
  than an opaque 401.

**Worth trying:** register an app in the TickTick developer portal and re-run the
spike with `TICKTICK_CLIENT_ID` / `TICKTICK_CLIENT_SECRET` set. The spike prefers
static credentials over dynamic registration when they are present. Statically
registered clients have historically been issued refresh tokens (see
`refreshAccessToken` in `lib/ticktick.ts` at commit `abb6f44`), so this may remove
the limitation entirely.

## Re-authorizing

The sync route cannot open a browser. If the refresh token stops working it fails
with `TickTickNotConnectedError`, and the fix is to re-run the spike locally and
re-seed:

```bash
npm run ticktick:spike && npm run ticktick:seed
```

## Environment

| Var | Where | Notes |
|---|---|---|
| `CRON_SECRET` | Vercel + Actions secret | reuse the existing value |
| `TICKTICK_MCP_SERVER_URL` | Vercel | defaults to `https://mcp.ticktick.com` |
| `TICKTICK_CUTOVER_DATE` | Vercel | entries starting earlier are ignored |
| `TICKTICK_LOOKBACK_DAYS` | Vercel | default 7 |
| OAuth client + tokens | `integration_tokens` table | seeded from the spike output |

Vercel functions have no persistent disk, so tokens live in the database, not on
the filesystem. The spike's `.ticktick-tokens.json` is local-only and gitignored.
