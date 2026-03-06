-- Overtime notes per day in a separate table (one row per date).
CREATE TABLE IF NOT EXISTS "daily_overtime_notes" (
  "date" text PRIMARY KEY NOT NULL,
  "note" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Migrate existing notes from daily_totals into daily_overtime_notes
INSERT INTO daily_overtime_notes (date, note, updated_at)
SELECT date, note, updated_at
FROM daily_totals
WHERE note IS NOT NULL AND trim(note) <> ''
ON CONFLICT (date) DO UPDATE SET
  note = EXCLUDED.note,
  updated_at = EXCLUDED.updated_at;

-- Drop note from daily_totals (notes live in daily_overtime_notes only)
ALTER TABLE "daily_totals" DROP COLUMN IF EXISTS "note";
