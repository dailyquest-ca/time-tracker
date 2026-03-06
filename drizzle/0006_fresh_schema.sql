-- Fresh schema: drop all old tables and rebuild from scratch.
-- This is a destructive migration for a clean start.

DROP TABLE IF EXISTS "events" CASCADE;
DROP TABLE IF EXISTS "daily_totals" CASCADE;
DROP TABLE IF EXISTS "daily_overtime_notes" CASCADE;
DROP TABLE IF EXISTS "categories" CASCADE;
DROP TABLE IF EXISTS "work_segments" CASCADE;

-- 1. categories
CREATE TABLE "categories" (
  "id" serial PRIMARY KEY,
  "name" text UNIQUE NOT NULL,
  "kind" text NOT NULL DEFAULT 'manual',
  "archived" boolean NOT NULL DEFAULT false,
  "display_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- 2. events
CREATE TABLE "events" (
  "id" serial PRIMARY KEY,
  "date" date NOT NULL,
  "name" text NOT NULL,
  "category_id" integer NOT NULL REFERENCES "categories"("id"),
  "length_hours" numeric(6,2) NOT NULL,
  "source_type" text NOT NULL DEFAULT 'manual',
  "source_id" text NOT NULL,
  "source_group" text,
  "start_time" timestamptz,
  "end_time" timestamptz,
  "raw_title" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "events_source_type_source_id_unique" UNIQUE("source_type", "source_id")
);

CREATE INDEX "events_date_idx" ON "events" ("date");
CREATE INDEX "events_date_category_idx" ON "events" ("date", "category_id");
CREATE INDEX "events_source_type_idx" ON "events" ("source_type");

-- 3. daily_overtime_notes
CREATE TABLE "daily_overtime_notes" (
  "date" date PRIMARY KEY,
  "note" text,
  "note_source" text,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- 4. google_tokens (recreate only if missing)
CREATE TABLE IF NOT EXISTS "google_tokens" (
  "user_id" text DEFAULT 'default' NOT NULL,
  "access_token" text NOT NULL,
  "refresh_token" text,
  "expires_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "google_tokens_pkey" PRIMARY KEY("user_id")
);

-- 5. calendar_watch (recreate only if missing)
CREATE TABLE IF NOT EXISTS "calendar_watch" (
  "user_id" text DEFAULT 'default' NOT NULL,
  "calendar_id" text NOT NULL,
  "channel_id" text NOT NULL,
  "resource_id" text NOT NULL,
  "expiration" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "calendar_watch_pkey" PRIMARY KEY("user_id")
);

-- 6. app_config (recreate only if missing)
CREATE TABLE IF NOT EXISTS "app_config" (
  "key" text PRIMARY KEY,
  "value" jsonb NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- Seed built-in categories
INSERT INTO "categories" ("name", "kind", "display_order") VALUES
  ('General tasks/meetings', 'system', 0),
  ('Learning', 'system', 1),
  ('1:1s', 'system', 2)
ON CONFLICT ("name") DO NOTHING;

-- Seed app config defaults
INSERT INTO "app_config" ("key", "value") VALUES
  ('app_first_tracking_date', '"2026-01-01"'),
  ('overtime_carryover_hours_before_2026', '19.5'),
  ('workday_standard_hours', '8')
ON CONFLICT ("key") DO NOTHING;

-- Seed the 2025 summary event (27.5h of carryover work under General)
INSERT INTO "events" ("date", "name", "category_id", "length_hours", "source_type", "source_id")
VALUES (
  '2025-12-31',
  'Summary of time from 2025',
  (SELECT "id" FROM "categories" WHERE "name" = 'General tasks/meetings'),
  27.5,
  'system',
  '2025-summary'
)
ON CONFLICT ("source_type", "source_id") DO NOTHING;
