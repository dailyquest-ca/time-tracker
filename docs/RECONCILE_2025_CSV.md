# 2025 CSV reconciliation

## Summary

- **Don’t show future days:** Implemented. The dashboard only shows dates up to today (local date).
- **Daily totals vs sheet:** The app’s daily totals come from **Google Calendar** (synced events). The sheet “Overtime Logbook - 2025 Hours.csv” is a **manual logbook** with its own totals. They can differ.
- **End-of-2025 OT = 19.5:** The sheet’s **19.5** is the **sum of the “Overtime” column** (each row’s OT delta). The script confirms: `Sum of CSV "Overtime" column = 19.5`.

## Where discrepancies come from

1. **Duplicate date rows in the CSV**  
   Some dates appear twice (e.g. Apr 22, May 7, Jun 18) with the same or similar “Daily Total” (e.g. 8.5 and 8.5).  
   - If we **sum** “Daily Total” by date we get 17h for Apr 22 → our “8h work-day” running OT is **35.5** at end of 2025 (about **16h higher** than 19.5).  
   - The sheet’s 19.5 is the **sum of the “Overtime” column** (each row counted once). So the sheet is using **per-row** OT, not “one delta per day” from summed daily total.  
   - So: **sheet OT** = sum of “Overtime” cells; **our formula** = (sum of “Daily Total” per date − 8h on work days). Those only match if there’s exactly one row per day or the sheet’s “Overtime” was filled to match that.

2. **Work days / holidays**  
   We use **BC statutory holidays** (see `lib/workdays-bc.ts`). Days like Jun 19–23 (Camping), Aug 29 (Out of Office), Nov 24–26 (Holidays) have 0 or reduced hours; we don’t apply −8h on those days. The sheet may have used the same or different rules.

3. **Data source**  
   - **App:** Only events that exist in **Google Calendar** (after sync).  
   - **Sheet:** Manual logbook; can include weekend work, late-night blocks, or notes that were never on the calendar.  
   So app totals can be **lower** than the sheet if some work wasn’t on the calendar.

4. **Rounding**  
   CSV uses decimal hours; the app stores minutes and displays decimal hours — small differences can accumulate.

## Category mapping (CSV → app)

We map the sheet’s columns to app categories as follows (used in the script and for backfill/import):

| CSV column (simplified)     | App category              |
|----------------------------|---------------------------|
| WSBC General Meetings      | General tasks/meetings     |
| WSBC General Tasks         | General tasks/meetings     |
| WOR 2                      | WOR 2                     |
| WOR 3                      | WOR 3                     |
| PIS Enhance                | PIS Enhance               |
| Recovery Tracking         | Recovery Tracking         |
| AI & PDM Growing           | Learning                  |
| DocUploader & PXT          | DocUploader               |
| PIS & PIH                  | PIS                       |
| F5                         | F5                        |
| (anything else / from Notes) | General tasks/meetings  |

Entries that don’t match a column above are treated as **General tasks/meetings**.

## How to run the reconciliation script

```bash
npx tsx scripts/reconcile-2025-csv.ts "path/to/Overtime Logbook - 2025 Hours.csv"
```

Optional: add `--compare-db` to compare with DB (script documents the option; DB comparison can be extended later).

The script:

- Parses the CSV and aggregates by date (sum “Daily Total” and “Overtime” per date).
- Computes running OT using BC work days (8h standard).
- Reports sum of daily totals (1171.5), computed end-of-2025 OT (35.5 when summing daily total per date), and sum of “Overtime” column (19.5).
- Prints sample days and category mapping.

## Making the app match 19.5

- **If the sheet is the source of truth for OT:** The sheet’s 19.5 is “sum of Overtime column”. The app currently uses “(daily total − 8h) on work days” and does **one** total per day from calendar. So to align:
  - Either **import** the sheet (e.g. backfill) so we have the same daily totals and then either store “OT delta” per row or recompute so that running OT ends at 19.5, or
  - Keep app logic as-is and accept that app OT can differ from the sheet when calendar data and sheet data differ (and when duplicate-date rows are summed).
- **If duplicate dates in the sheet are mistakes:** Use **one** entry per day (e.g. take **max** “Daily Total” per date when importing). Then our 8h/work-day formula can get closer to 19.5, depending on how the sheet originally filled “Overtime”.
