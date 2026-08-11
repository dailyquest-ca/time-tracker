# Time Tracker — Claude Code guide

Syncs one selected Google Calendar into Postgres-backed time entries, category totals, and overtime notes.

## Operating doctrine lives in a plugin

Safety rules, autonomy boundaries, git workflow, code quality, TypeScript and React conventions, testing standards, and UX craft come from the **`dq-standard`** plugin, installed from `dailyquest-ca/claude-standards` and declared in [`.claude/settings.json`](.claude/settings.json).

Do not restate those rules here. This file holds only what is specific to *this* repo.

If the plugin is not loaded, run:

```bash
claude plugin marketplace add dailyquest-ca/claude-standards
claude plugin install dq-standard@daily-quest --scope project
```

Destructive database and git operations are blocked by a hook from `dq-core`, and `git push`, deploys, and migrations prompt for confirmation with an impact summary. That is intended behaviour, not a misconfiguration.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 15 (App Router), React 19, TypeScript |
| Database | Postgres via Drizzle ORM (`DATABASE_URL`) |
| Hosting | Vercel, plus a Vercel Cron endpoint at `/api/cron/sync` |
| External | Google Calendar OAuth and push watch (`events.watch`) |
| Testing | Vitest |
| Package manager | npm — `package-lock.json` is the source of truth |

## Commands

```bash
npm run dev            # dev server
npm run build          # production build
npm run lint           # eslint
npm test               # vitest, single run
npm run test:watch     # watch mode
npm run db:generate    # drizzle schema generation
npm run db:push        # push schema (gated — confirm first)
```

Migration scripts under `scripts/` are one-off and destructive by nature. Read one before running it, and never run one autonomously.

## Key locations

| Path | Purpose |
| --- | --- |
| `lib/google-calendar-sync.ts` | Sync orchestration, watch lifecycle, debounce, webhook diagnostics |
| `lib/google.ts` | Google Calendar API wrappers — `events`, `watch`, `channels.stop` |
| `lib/db.ts`, `lib/schema.ts` | Database client and schema |
| `app/api/webhooks/google-calendar-v2/route.ts` | Active trusted webhook handler |
| `app/api/webhooks/google-calendar/route.ts` | Legacy sink for stale channel noise |
| `app/api/sync/watch-status/route.ts` | Watch diagnostics and force-recreate |
| `lib/__tests__/` | API validation and sync regression tests |

## Repo conventions

- **Single-user identity.** `userId = 'default'` everywhere, unless an explicit migration introduces multi-user support. Do not add user-scoping speculatively.
- **`DATABASE_URL` only.** Never introduce `POSTGRES_URL` fallback logic in app code.
- **Two webhook streams, treated differently.** Trusted current-watch traffic goes to `/api/webhooks/google-calendar-v2` and syncs. Legacy and untrusted traffic goes to `/api/webhooks/google-calendar`, which always ACKs and never syncs. Do not merge them.
- **`channels.stop` failures are recoverable.** A `403` or `404` when stopping a channel must not block creating a replacement watch.
- **Sync is idempotent and retry-safe.** Google delivers at-least-once. Upsert by stable key; never delete-then-insert.

## Cursor rules

`.cursor/rules/` still exists and is what Cursor reads. Most of its content is now duplicated by the `dq-standard` plugin, so the two can drift. When a shared rule changes, change it in `claude-standards` and treat the `.cursor` copy as stale.

`.cursor/rules/gcp-patterns.mdc` looks dead — it covers Cloud Run, Firestore, Pub/Sub, and Secret Manager, none of which appear in `package.json`. This repo uses the Google Calendar API but is hosted on Vercel. Worth deleting.
