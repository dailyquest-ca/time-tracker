-- Notes are in daily_overtime_notes; OT and totals are computed at read time from events.
-- Drop daily_totals so the app no longer reads or writes it.
DROP TABLE IF EXISTS "daily_totals";
