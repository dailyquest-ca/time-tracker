-- Add optional overtime note to daily_totals (user-editable; default generated from events)
ALTER TABLE "daily_totals" ADD COLUMN IF NOT EXISTS "note" text;
