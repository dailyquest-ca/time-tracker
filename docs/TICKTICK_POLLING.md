# TickTick → time tracker sync

Status: **Phase 0 (gate) — not yet built.** The sync route, migration and workflow
below are the agreed design; none of it ships until the OAuth spike passes.

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

## Phases after the gate

1. **Migration** — only `integration_tokens` is genuinely new. `events` already
   has `source_type` / `source_id` / `source_group` with a unique constraint on
   `(source_type, source_id)`, so no discriminator migration is needed.
2. **Sync route** — `app/api/cron/ticktick-sync/route.ts`, Bearer `CRON_SECRET`,
   mirroring `app/api/cron/sync/route.ts`. Window `[now − LOOKBACK_DAYS, now + 2d]`.
   Skip writes when the task `etag` is unchanged. Reconcile deletions inside the
   window only. Recompute affected dates via `recomputeDailyTotalsForDates`.
3. **GitHub Action** — `*/10`, offset off the hour, plus a keepalive job to dodge
   the 60-day inactivity auto-disable on scheduled workflows.

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
