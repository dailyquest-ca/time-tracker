# TickTick polling

How scheduled work in the **WSBC** TickTick folder gets into the time tracker.

## Why the poller is a Claude session, not a Vercel cron

TickTick is read through the **TickTick MCP connector**. That connector is
OAuth-bound to the owner's Claude account (`isAuthless: false`) — it is reachable
from a Claude session, but there is no credential this app could hold to call it
from Vercel. The app therefore never talks to TickTick directly. A scheduled
Claude session does the reading and pushes batches in:

```
Claude session (scheduled)
  → TickTick MCP: list_projects  → lists whose groupId is the WSBC folder
  → TickTick MCP: filter_tasks   → tasks in those lists, today onward
  → POST /api/ingest/ticktick    → upsert into events, recompute daily totals
```

## IDs

| Thing | ID |
|---|---|
| WSBC folder (project group) | `6a7a7032e42bdd11f74ff016` |
| `🤖ELAN` list | `6a7a6ff28f08f1b21296dc98` |

Resolve lists by **folder id**, not by a hardcoded list id — new lists added to
the WSBC folder are then picked up automatically.

## Setup

1. Generate a secret and set it in Vercel as `INGEST_SECRET`:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. Deploy, so `/api/ingest/ticktick` is live.
3. Schedule the poller with the prompt below.

## Poller prompt

Use this as the scheduled prompt. It is written to be standalone — each firing
starts from nothing.

> Sync the WSBC TickTick folder into the time tracker.
>
> 1. Call the TickTick MCP `list_projects`. Keep every list whose `groupId` is
>    `6a7a7032e42bdd11f74ff016` (the WSBC folder) and whose `kind` is `TASK`.
> 2. For those list ids, call `filter_tasks` with `projectIds` set to them and
>    `startDate` set to 00:00 today in America/Vancouver. Also call
>    `list_completed_tasks_by_date` for the same ids and date range, so completed
>    work is included.
> 3. POST the result to `https://<your-app>/api/ingest/ticktick` with header
>    `Authorization: Bearer $INGEST_SECRET` and body:
>    ```json
>    {
>      "lists": [
>        { "id": "<listId>", "name": "<list name>", "tasks": [ ...tasks... ] }
>      ],
>      "prune": true
>    }
>    ```
>    Send the raw task objects through unchanged — the endpoint does its own
>    filtering (timed tasks only, today onward) and de-duplication.
> 4. Report only the counts returned (`ingested`, `pruned`, `dates`). If nothing
>    changed, say nothing further.

## Cadence

Durable scheduled sessions run **at most hourly**. A 10-minute loop is only
possible inside a live session, which ends when the session does. Practical
options:

| Option | Interval | Survives session end |
|---|---|---|
| Scheduled routine | hourly | yes |
| In-session loop | 10 min | no |

Hourly is the durable choice. Because the endpoint is idempotent, a missed or
duplicated run is harmless.

## Verifying

```bash
curl -s -X POST https://<your-app>/api/ingest/ticktick \
  -H "Authorization: Bearer $INGEST_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"lists":[{"id":"6a7a6ff28f08f1b21296dc98","name":"🤖ELAN","tasks":[]}]}'
```

Expect `{"ok":true,"ingested":0,"pruned":0,"dates":[],"today":"..."}`. A 401 means
the secret does not match; a 500 with `Server misconfigured` means `INGEST_SECRET`
is not set on the deployment.
