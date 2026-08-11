# CLAUDE.md — time-tracker

Guidance for Claude Code working in this repo, including Claude Code on the web.

## Operating doctrine comes from a plugin

Safety, autonomy, git workflow, code quality, TDD, naming, task tracking, TypeScript and React standards, API and persistence conventions, testing standards, accessibility, and UX craft all come from the **`dq-standard`** plugin, installed from [`dailyquest-ca/claude-standards`](https://github.com/dailyquest-ca/claude-standards) and declared in [`.claude/settings.json`](.claude/settings.json).

Do not restate those rules here. To change a shared rule, change it in `claude-standards` — every Daily Quest repo picks it up.

This replaces the `.cursor/rules/` directory this file used to index, and it closes the gap that directory left: the old `global-playbook-link.mdc` pointed at `C:\dev\cursor-playbook`, a local Windows path that no cloud session could ever reach. That guidance is now installable and versioned instead of unreachable.

**The safety policy is an enforced `PreToolUse` hook, not prose.** `DROP`, `TRUNCATE`, unscoped `DELETE`/`UPDATE`, recursive force-delete, `git reset --hard`, and force-push are refused by the client. `git push`, deploys, migrations, direct SQL, and edits to `.env*` or applied migrations prompt with an impact summary. Those prompts are the design working.

Path-scoped rules for the sync and webhook code live in [`.claude/rules/`](.claude/rules/) and load automatically when those files are opened.

## Cloud session setup

The remote container clones the repo **without `node_modules`**, so `npm test`, `npm run lint`, and `tsc` all fail until dependencies are installed.

`.claude/hooks/session-start.sh` (registered in `.claude/settings.json`) runs `npm install` at session start to fix this. It is remote-only and idempotent. If you are ever in a session where tests fail with missing modules, run `npm install` before concluding anything is broken.

## Non-negotiables

**TDD.** A hard requirement, not a preference — see the `tdd-workflow` skill. Run `npm test` to confirm green *before* changing anything, write or update the failing test *first*, then implement. Do not write the implementation and backfill tests that merely assert what the code already does.

**Verify, don't assume.** Report what actually ran. If you did not run the suite, say so. If a step was skipped, say so.

**Secrets.** `.env.example` holds variable *names* only, never values. Never log or return an env var's name or value in an error path — a generic "Server misconfigured" 500 is the pattern (`app/api/cron/sync/route.ts` is the reference implementation).

**Idempotent writes.** Every sync path must be safe to re-run. Use `onConflictDoUpdate` against a natural key, and recompute affected aggregates in the same flow (`recomputeDailyTotalsForDates`).

## Project quick reference

Next.js 15 App Router + React 19 + TypeScript, Drizzle ORM on Postgres (`DATABASE_URL` only — never add a `POSTGRES_URL` fallback), Vercel hosting + Vercel Cron, Vitest, npm.

```
lib/schema.ts                  Drizzle schema. `events` is the canonical fact
                               table for all tracked time; unique on
                               (sourceType, sourceId).
lib/google-calendar-sync.ts    Sync orchestration, watch lifecycle, debounce.
                               The reference pattern for any new source.
lib/google.ts                  Google Calendar API wrappers.
lib/categorize.ts              Title -> category. Leading 3+ char acronym wins,
                               then fuzzy (Levenshtein <= 1), then keywords,
                               then "General tasks/meetings".
lib/ticktick.ts                Pure helpers for TickTick items. TickTick items
                               are categorized by their *list name*, not their
                               title, so they bypass lib/categorize.ts.
scripts/ticktick-mcp-spike.ts  Phase 0 gate for the TickTick sync. See
                               docs/TICKTICK_POLLING.md.
lib/overtime.ts                Daily totals + overtime balance.
lib/workdays-bc.ts             BC statutory holiday / workday calendar.
app/api/cron/sync/route.ts     Vercel Cron entrypoint (Bearer CRON_SECRET).
lib/__tests__/                 All tests. Vitest, `@/*` aliased to repo root.
```

**Conventions that bite if missed:**

- Single-user app: `userId = 'default'` throughout.
- Dates bucket by **`America/Vancouver`**, not UTC. `eventDateKey()` in `lib/google-calendar-sync.ts` is the reference; a UTC `toISOString().slice(0,10)` is a bug (fixed in commit `5fea58f`).
- Durations round to the nearest 15 minutes (`roundToNearest15`).
- Google webhooks are two streams: trusted current traffic on `/api/webhooks/google-calendar-v2`, legacy noise on `/api/webhooks/google-calendar` (always ACK, never sync).
- **TickTick is read from its official MCP server** (`https://mcp.ticktick.com`) via a programmatic JSON-RPC client — no LLM. Do **not** reach for TickTick's REST Open API (it cannot return completed tasks) or its unofficial `api/v2` endpoints; if MCP auth breaks, stop and report rather than falling back. Lists are selected by **WSBC folder membership**, never a hardcoded id table. See `docs/TICKTICK_POLLING.md`.

## Commands

```bash
npm test                                    # full suite, run before finishing
npm run test:watch                          # during development
npx vitest run lib/__tests__/<file>.test.ts # targeted
npm run lint                                # ESLint
npm run dev                                 # local dev server
```

## Git

Work on the branch you were assigned; never push to `main` without being asked. Commit messages follow the existing log: `feat:`, `fix:`, `chore:` + imperative summary.
