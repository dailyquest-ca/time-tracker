---
paths:
  - "lib/google*.ts"
  - "app/api/webhooks/**/*.ts"
  - "app/api/sync/**/*.ts"
  - "app/api/cron/**/*.ts"
---

# Google Calendar sync

Loads when working on sync, the webhook handlers, or the watch lifecycle.

## At-least-once delivery

Google delivers webhook notifications at least once, sometimes several times for one change, and sometimes out of order. Every handler must be **idempotent**: upsert by a stable key, never delete-then-insert, and never assume a notification corresponds to exactly one unseen change.

Retries use backoff. A handler that is slow enough to be redelivered while still running will be redelivered.

## Two streams, deliberately separate

| Endpoint | Traffic | Behaviour |
| --- | --- | --- |
| `/api/webhooks/google-calendar-v2` | Trusted, current watch | Validates, then syncs |
| `/api/webhooks/google-calendar` | Legacy, stale channels | Always ACK, **never** sync |

The legacy endpoint exists because stopped channels keep delivering for a while. It must keep returning 200 so Google stops retrying, and it must never trigger a sync. Do not consolidate these two handlers.

## Watch lifecycle

`channels.stop` returning `403` or `404` means the channel is already gone. That is a **recoverable** outcome — log it and continue to create the replacement watch. Treating it as fatal leaves the app with no active watch, which fails silently until someone notices events are stale.

Watches expire. Recreation must be safe to run repeatedly.

## Identity

`userId = 'default'`. This is a single-user application. Do not add user scoping to queries or handlers without an explicit migration introducing multi-user support.

## Database

Use `DATABASE_URL`. Never add `POSTGRES_URL` fallback logic in app code — one source for the connection string keeps environment drift diagnosable.

## Tests

Sync helpers and API validation have regression suites under `lib/__tests__/`. Changes to debounce logic, watch lifecycle, or webhook validation need a test that would fail against the old behaviour. See the `testing-standards` skill on guarding against silent regression.
