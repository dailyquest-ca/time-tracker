/**
 * Self-applying schema for the TickTick sync.
 *
 * The sync runs on Vercel where there is no deploy hook to run migrations, and
 * the operator may have no local database access at all. Every statement here is
 * additive and idempotent, so applying it on the request path is safe and a
 * re-run is a no-op.
 *
 * This mirrors drizzle/0007_ticktick_integration.sql — keep the two in step. The
 * SQL file remains the record for anyone applying migrations conventionally.
 */
import { sql } from 'drizzle-orm';
import { db } from './db';

/**
 * Applied at most once per process. Serverless instances are short-lived, so
 * this runs occasionally on cold start rather than on every request.
 */
let applied: Promise<void> | null = null;

const STATEMENTS = [
  sql`CREATE TABLE IF NOT EXISTS "integration_tokens" (
    "provider" text PRIMARY KEY NOT NULL,
    "access_token" text NOT NULL,
    "refresh_token" text,
    "expires_at" timestamp with time zone,
    "token_type" text,
    "scope" text,
    "client_id" text,
    "client_secret" text,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
  )`,
  sql`ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "source_etag" text`,
  sql`CREATE INDEX IF NOT EXISTS "events_source_type_date_idx" ON "events" ("source_type", "date")`,
];

/**
 * Ensure the TickTick tables and columns exist. Safe to call concurrently — the
 * promise is memoised, and the statements tolerate losing a race anyway.
 */
export function ensureTickTickSchema(): Promise<void> {
  if (applied) return applied;

  applied = (async () => {
    for (const statement of STATEMENTS) {
      await db.execute(statement);
    }
    console.log('[ticktick-migrate] Schema verified.');
  })().catch((err) => {
    // Let the next call retry rather than caching a transient failure.
    applied = null;
    throw err;
  });

  return applied;
}

/** Testing seam: forget that the schema was applied. */
export function resetSchemaCacheForTests(): void {
  applied = null;
}
