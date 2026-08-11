-- TickTick integration: OAuth token storage + an upstream version marker on events.
-- Additive and idempotent; safe to re-run.

CREATE TABLE IF NOT EXISTS "integration_tokens" (
	"provider" text PRIMARY KEY NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" timestamp with time zone,
	"token_type" text,
	"scope" text,
	"client_id" text,
	"client_secret" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Lets a sync skip rows whose upstream version is unchanged, so a no-op run
-- performs zero writes.
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "source_etag" text;

-- Reconciliation scans TickTick rows by source and date on every run.
CREATE INDEX IF NOT EXISTS "events_source_type_date_idx"
	ON "events" ("source_type", "date");
