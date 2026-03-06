# Overtime carryover at start of 2026

The app tracks time and overtime **from 2026 onwards**. Pre-2026 data has been removed; only 2026+ data is stored.

**Carryover:** The running overtime balance at the start of 2026 is assumed to be **19.5 hours** (1170 minutes). This value is used when recomputing daily totals for any date on or after 2026-01-01 when there is no earlier row in `daily_totals`. Defined in `lib/overtime.ts` as `CARRYOVER_OT_MINUTES_BEFORE_2026`.
