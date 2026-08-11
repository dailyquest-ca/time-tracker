# CLAUDE.md — time-tracker

Guidance for Claude Code working in this repo, including Claude Code on the web.

This repo's standards already live in `.cursor/rules/*.mdc`. Cursor loads those
automatically; **Claude Code does not**. This file is the entry point that makes
them apply here too. Treat `.cursor/rules/` as the source of truth and this file
as the index — when the two disagree, the rule file wins, and you should fix the
drift here.

## Read these rules before you work

Always-on (read at the start of any non-trivial task):

| File | Covers |
|---|---|
| `.cursor/rules/project-context.mdc` | Stack, entrypoints, integration conventions |
| `.cursor/rules/core/tdd-workflow.mdc` | Tests-first loop (**not optional** — see below) |
| `.cursor/rules/core/continuous-learning-and-efficiency.mdc` | Rule maintenance, focused reads |
| `.cursor/rules/core/cursor-behavior-constraints.mdc` | Design guardrails; applies to Claude too |

Load by area of work (these are `globs`-scoped in Cursor):

| Working on | Read |
|---|---|
| `lib/*.ts`, `scripts/**/*.ts` | `.cursor/rules/data-and-persistence.mdc` |
| `app/api/**/route.ts` | `.cursor/rules/api-routes.mdc` |
| `app/**/*.tsx` | `.cursor/rules/react-nextjs-patterns.mdc`, `.cursor/rules/frontend/*.mdc` |
| Any `.ts`/`.tsx` | `.cursor/rules/typescript-standards.mdc` |
| Tests | `.cursor/rules/testing-standards.mdc` |
| Secrets, env, OAuth | `.cursor/rules/security-and-env.mdc` |
| Google Cloud / Calendar | `.cursor/rules/gcp-patterns.mdc` |
| Design, IA, a11y depth | `.cursor/rules/core/design-core.mdc`, `.cursor/rules/binders/` |

## Known gap: the global playbook is unreachable

`.cursor/rules/core/global-playbook-link.mdc` points at `C:\dev\cursor-playbook`
and `C:\dev\project-template`. Those are **local Windows paths on the author's
machine**. In Claude Code on the web the container only has this repo, so that
guidance is unavailable — it is not on GitHub either.

What this means in practice:

- Do **not** claim to have followed the global playbook in a cloud session. You
  have not read it.
- The contribution loop in that rule (push learnings up to the playbook) cannot
  be completed from the cloud. When you learn something reusable, write it into
  this repo's `.cursor/rules/` and **tell the user** it still needs promoting to
  the global playbook by hand.
- If the playbook is ever pushed to GitHub, add it as a source and delete this
  section.

## Cloud session setup

The remote container clones the repo **without `node_modules`**, so `npm test`,
`npm run lint`, and `tsc` all fail until dependencies are installed.

`.claude/hooks/session-start.sh` (registered in `.claude/settings.json`) runs
`npm install` at session start to fix this. It is remote-only and idempotent.
If you are ever in a session where tests fail with missing modules, run
`npm install` before concluding anything is broken.

## Non-negotiables

**TDD.** `.cursor/rules/core/tdd-workflow.mdc` is a hard requirement, not a
preference. Run `npm test` to confirm green *before* changing anything, write or
update the failing test *first*, then implement. Do not write the implementation
and backfill tests that merely assert what the code already does.

**Verify, don't assume.** Report what actually ran. If you did not run the
suite, say so. If a step was skipped, say so.

**Secrets.** `.env.example` holds variable *names* only, never values. Never log
or return an env var's name or value in an error path — a generic
"Server misconfigured" 500 is the pattern (`app/api/cron/sync/route.ts` is the
reference implementation).

**Idempotent writes.** Every sync path must be safe to re-run. Use
`onConflictDoUpdate` against a natural key, and recompute affected aggregates in
the same flow (`recomputeDailyTotalsForDates`).

## Project quick reference

Next.js 15 App Router + React 19 + TypeScript, Drizzle ORM on Postgres
(`DATABASE_URL` only — never add a `POSTGRES_URL` fallback), Vercel hosting +
Vercel Cron, Vitest, npm.

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
- Dates bucket by **`America/Vancouver`**, not UTC. `eventDateKey()` in
  `lib/google-calendar-sync.ts` is the reference; a UTC `toISOString().slice(0,10)`
  is a bug (fixed in commit `5fea58f`).
- Durations round to the nearest 15 minutes (`roundToNearest15`).
- Google webhooks are two streams: trusted current traffic on
  `/api/webhooks/google-calendar-v2`, legacy noise on
  `/api/webhooks/google-calendar` (always ACK, never sync).
- **TickTick is read from its official MCP server** (`https://mcp.ticktick.com`)
  via a programmatic JSON-RPC client — no LLM. Do **not** reach for TickTick's
  REST Open API (it cannot return completed tasks) or its unofficial `api/v2`
  endpoints; if MCP auth breaks, stop and report rather than falling back.
  Lists are selected by **WSBC folder membership**, never a hardcoded id table.
  See `docs/TICKTICK_POLLING.md`.

## Commands

```bash
npm test                                    # full suite, run before finishing
npm run test:watch                          # during development
npx vitest run lib/__tests__/<file>.test.ts # targeted
npm run lint                                # ESLint
npm run dev                                 # local dev server
```

## Git

Work on the branch you were assigned; never push to `main` without being asked.
Commit messages follow the existing log: `feat:`, `fix:`, `chore:` + imperative
summary.
