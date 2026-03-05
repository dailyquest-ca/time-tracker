'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

/* ── Types ─────────────────────────────────────────────────────────── */

interface DailyRow {
  date: string;
  totalMinutes: number;
  minutesByCategory: Record<string, number>;
  overtimeBalanceAfter: number;
}

interface DayTask {
  id: number;
  taskTitle: string;
  category: string;
  projectName: string;
  durationMinutes: number;
  source: string;
}

interface DayDetail {
  date: string;
  totalMinutes: number;
  byCategory: Record<string, number>;
  overtimeBalanceAfter: number;
  tasks: DayTask[];
  overtimeDrivers: DayTask[];
}

/* ── Helpers ───────────────────────────────────────────────────────── */

function fmt(minutes: number): string {
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const sign = minutes < 0 ? '-' : '';
  if (m === 0) return `${sign}${h}h`;
  return `${sign}${h}h ${m}m`;
}

function fmtDecimal(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

function dateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  const day = d.toLocaleDateString('en-CA', { weekday: 'short', timeZone: 'UTC' });
  const mon = d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${day}, ${mon}`;
}

function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr + 'T12:00:00Z');
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

function rangeStr(from: string, to: string): string {
  return `${from} to ${to}`;
}

function getPageRange(page: number, pageSize: number): { from: string; to: string } {
  const to = new Date();
  to.setDate(to.getDate() - page * pageSize);
  const from = new Date(to);
  from.setDate(to.getDate() - pageSize + 1);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

function getYearRange(year: number): { from: string; to: string } {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

function topCategories(mins: Record<string, number>, limit: number): { shown: [string, number][]; extra: number } {
  const sorted = Object.entries(mins).sort(([, a], [, b]) => b - a);
  const shown = sorted.slice(0, limit);
  const extra = sorted.length - shown.length;
  return { shown, extra };
}

/* ── Pay period helpers ────────────────────────────────────────────── */

function getPayPeriods(rows: DailyRow[], year: number, month: number): {
  first: { from: string; to: string; rows: DailyRow[] };
  second: { from: string; to: string; rows: DailyRow[] };
} {
  const mm = String(month).padStart(2, '0');
  const lastDay = new Date(year, month, 0).getDate();
  const from1 = `${year}-${mm}-01`;
  const to1 = `${year}-${mm}-15`;
  const from2 = `${year}-${mm}-16`;
  const to2 = `${year}-${mm}-${lastDay}`;
  return {
    first: { from: from1, to: to1, rows: rows.filter((r) => r.date >= from1 && r.date <= to1) },
    second: { from: from2, to: to2, rows: rows.filter((r) => r.date >= from2 && r.date <= to2) },
  };
}

function sumByCategory(rows: DailyRow[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const r of rows) {
    for (const [cat, mins] of Object.entries(r.minutesByCategory ?? {})) {
      totals[cat] = (totals[cat] ?? 0) + mins;
    }
  }
  return totals;
}

/* ── Component ─────────────────────────────────────────────────────── */

const PAGE_SIZE = 14;

export default function HomePage() {
  const [page, setPage] = useState(0);
  const [view, setView] = useState<'recent' | 'year'>('recent');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<DailyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  // Day detail modal
  const [modalDate, setModalDate] = useState<string | null>(null);
  const [dayDetail, setDayDetail] = useState<DayDetail | null>(null);
  const [dayLoading, setDayLoading] = useState(false);

  // Pay period
  const [ppMonth, setPpMonth] = useState(new Date().getMonth() + 1);
  const [ppYear, setPpYear] = useState(new Date().getFullYear());
  const [ppData, setPpData] = useState<DailyRow[]>([]);

  const range = useMemo(() => {
    if (view === 'year') return getYearRange(selectedYear);
    return getPageRange(page, PAGE_SIZE);
  }, [view, selectedYear, page]);

  const fetchHours = useCallback(async (from: string, to: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/hours?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setData(json.data ?? []);
    } catch {
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHours(range.from, range.to);
  }, [range.from, range.to, fetchHours]);

  // Fetch pay period data
  useEffect(() => {
    const mm = String(ppMonth).padStart(2, '0');
    const lastDay = new Date(ppYear, ppMonth, 0).getDate();
    const from = `${ppYear}-${mm}-01`;
    const to = `${ppYear}-${mm}-${lastDay}`;
    fetch(`/api/hours?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .then((res) => res.json())
      .then((json) => setPpData(json.data ?? []))
      .catch(() => setPpData([]));
  }, [ppMonth, ppYear]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncError(null);
    setSyncMsg(null);
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Sync failed');
      setSyncMsg(`Synced ${json.segmentsProcessed ?? 0} task(s)`);
      await fetchHours(range.from, range.to);
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const openDay = async (date: string) => {
    setModalDate(date);
    setDayLoading(true);
    setDayDetail(null);
    try {
      const res = await fetch(`/api/day?date=${encodeURIComponent(date)}`);
      if (!res.ok) throw new Error(await res.text());
      const json: DayDetail = await res.json();
      setDayDetail(json);
    } catch {
      setDayDetail(null);
    } finally {
      setDayLoading(false);
    }
  };

  const closeModal = () => {
    setModalDate(null);
    setDayDetail(null);
  };

  // Derived
  const totalMinutesRange = data.reduce((s, r) => s + r.totalMinutes, 0);
  const latestOT = data.length > 0 ? data[data.length - 1].overtimeBalanceAfter : 0;

  // Compute OT delta for each row
  const dataWithDelta = useMemo(() => {
    return data.map((r, i) => {
      const delta = r.overtimeBalanceAfter - (i > 0 ? data[i - 1].overtimeBalanceAfter : r.overtimeBalanceAfter - computeOTDelta(r));
      return { ...r, otDelta: delta };
    });
  }, [data]);

  // Pay period computed
  const pp = useMemo(() => getPayPeriods(ppData, ppYear, ppMonth), [ppData, ppYear, ppMonth]);
  const ppFirstByCat = useMemo(() => sumByCategory(pp.first.rows), [pp.first.rows]);
  const ppSecondByCat = useMemo(() => sumByCategory(pp.second.rows), [pp.second.rows]);
  const ppFirstTotal = pp.first.rows.reduce((s, r) => s + r.totalMinutes, 0);
  const ppSecondTotal = pp.second.rows.reduce((s, r) => s + r.totalMinutes, 0);
  const allPPCategories = useMemo(() => {
    const set = new Set([...Object.keys(ppFirstByCat), ...Object.keys(ppSecondByCat)]);
    return [...set].sort();
  }, [ppFirstByCat, ppSecondByCat]);

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  return (
    <main className="min-h-screen bg-gray-50 p-3 sm:p-5">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <header className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">Time Tracker</h1>
          <div className="flex items-center gap-3 text-sm">
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing}
              className="rounded bg-blue-600 px-3 py-1 text-white hover:bg-blue-700 disabled:opacity-50 text-xs font-medium"
            >
              {syncing ? 'Syncing...' : 'Sync'}
            </button>
            <Link href="/settings" className="text-gray-500 hover:text-gray-800 underline text-xs">
              Settings
            </Link>
          </div>
        </header>

        {syncError && (
          <p className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">{syncError}</p>
        )}
        {syncMsg && (
          <p className="mb-2 text-xs text-green-600">{syncMsg}</p>
        )}

        {/* View switcher */}
        <div className="mb-3 flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => { setView('recent'); setPage(0); }}
            className={`rounded px-2 py-1 ${view === 'recent' ? 'bg-blue-100 text-blue-700 font-medium' : 'text-gray-500 hover:bg-gray-100'}`}
          >
            Recent
          </button>
          {[new Date().getFullYear(), new Date().getFullYear() - 1].map((yr) => (
            <button
              key={yr}
              type="button"
              onClick={() => { setView('year'); setSelectedYear(yr); }}
              className={`rounded px-2 py-1 ${view === 'year' && selectedYear === yr ? 'bg-blue-100 text-blue-700 font-medium' : 'text-gray-500 hover:bg-gray-100'}`}
            >
              {yr}
            </button>
          ))}
        </div>

        {/* Summary cards */}
        {!loading && data.length > 0 && (
          <div className="mb-3 grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">Total</p>
              <p className="text-lg font-semibold text-gray-900">{fmt(totalMinutesRange)}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">OT Balance</p>
              <p className={`text-lg font-semibold ${latestOT > 0 ? 'text-green-600' : 'text-gray-900'}`}>
                {fmt(latestOT)}
              </p>
            </div>
          </div>
        )}

        {/* Paging (recent view only) */}
        {view === 'recent' && (
          <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              className="rounded px-2 py-1 hover:bg-gray-100"
            >
              &larr; Older
            </button>
            <span>{rangeStr(range.from, range.to)}</span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded px-2 py-1 hover:bg-gray-100 disabled:opacity-30"
            >
              Newer &rarr;
            </button>
          </div>
        )}

        {/* Main table */}
        {loading ? (
          <p className="text-gray-400 text-sm py-6 text-center">Loading...</p>
        ) : data.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white px-5 py-8 text-center text-sm text-gray-500 shadow-sm">
            No hours in this range.{' '}
            <Link href="/settings" className="underline text-blue-600">Connect Google and choose a work calendar</Link>
            {' '}in Settings, then click Sync.
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-gray-600">
                  <th className="px-3 py-2 text-left font-semibold">Date</th>
                  <th className="px-2 py-2 text-right font-semibold">Total</th>
                  <th className="px-2 py-2 text-left font-semibold">Categories</th>
                  <th className="px-2 py-2 text-right font-semibold">OT &Delta;</th>
                  <th className="px-3 py-2 text-right font-semibold">OT Bal</th>
                </tr>
              </thead>
              <tbody>
                {[...dataWithDelta].reverse().map((row) => {
                  const today = new Date().toISOString().slice(0, 10);
                  const isToday = row.date === today;
                  const weekend = isWeekend(row.date);
                  const { shown, extra } = topCategories(row.minutesByCategory ?? {}, 2);

                  return (
                    <tr
                      key={row.date}
                      onClick={() => openDay(row.date)}
                      className={`border-b border-gray-100 last:border-0 cursor-pointer transition-colors ${
                        isToday ? 'bg-blue-50 hover:bg-blue-100' : weekend ? 'bg-gray-50/50 hover:bg-gray-100' : 'hover:bg-gray-50'
                      }`}
                    >
                      <td className="px-3 py-2 whitespace-nowrap text-gray-700 font-medium">
                        {dateLabel(row.date)}
                      </td>
                      <td className="px-2 py-2 text-right whitespace-nowrap font-semibold text-gray-900">
                        {row.totalMinutes > 0 ? fmt(row.totalMinutes) : <span className="text-gray-300">&mdash;</span>}
                      </td>
                      <td className="px-2 py-2 text-gray-600 truncate max-w-[180px]">
                        {shown.length > 0 ? (
                          <>
                            {shown.map(([cat, mins]) => (
                              <span key={cat} className="inline-block mr-2">
                                <span className="text-gray-500">{cat.replace(/^[^\w]*/, '').slice(0, 12)}</span>
                                <span className="ml-0.5 text-gray-800">{fmtDecimal(mins)}</span>
                              </span>
                            ))}
                            {extra > 0 && <span className="text-gray-400">+{extra}</span>}
                          </>
                        ) : (
                          <span className="text-gray-300">&mdash;</span>
                        )}
                      </td>
                      <td className={`px-2 py-2 text-right whitespace-nowrap font-medium ${
                        row.otDelta > 0 ? 'text-green-600' : row.otDelta < 0 ? 'text-red-500' : 'text-gray-300'
                      }`}>
                        {row.otDelta !== 0 ? (row.otDelta > 0 ? '+' : '') + fmt(row.otDelta) : <span>&mdash;</span>}
                      </td>
                      <td className={`px-3 py-2 text-right whitespace-nowrap font-semibold ${
                        row.overtimeBalanceAfter > 0 ? 'text-green-600' : 'text-gray-400'
                      }`}>
                        {fmt(row.overtimeBalanceAfter)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pay period summary */}
        <section className="mt-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-2">Pay Period Summary</h2>
          <div className="flex items-center gap-2 mb-3 text-xs">
            <select
              value={ppMonth}
              onChange={(e) => setPpMonth(Number(e.target.value))}
              className="rounded border border-gray-300 px-2 py-1 text-xs"
            >
              {months.map((m, i) => (
                <option key={i} value={i + 1}>{m}</option>
              ))}
            </select>
            <select
              value={ppYear}
              onChange={(e) => setPpYear(Number(e.target.value))}
              className="rounded border border-gray-300 px-2 py-1 text-xs"
            >
              {[new Date().getFullYear(), new Date().getFullYear() - 1].map((yr) => (
                <option key={yr} value={yr}>{yr}</option>
              ))}
            </select>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-gray-600">
                  <th className="px-3 py-2 text-left font-semibold">Category</th>
                  <th className="px-3 py-2 text-right font-semibold">1st&ndash;15th</th>
                  <th className="px-3 py-2 text-right font-semibold">16th&ndash;End</th>
                  <th className="px-3 py-2 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {allPPCategories.map((cat) => (
                  <tr key={cat} className="border-b border-gray-100 last:border-0">
                    <td className="px-3 py-1.5 text-gray-700 truncate max-w-[180px]">{cat}</td>
                    <td className="px-3 py-1.5 text-right text-gray-800">{fmtDecimal(ppFirstByCat[cat] ?? 0)}</td>
                    <td className="px-3 py-1.5 text-right text-gray-800">{fmtDecimal(ppSecondByCat[cat] ?? 0)}</td>
                    <td className="px-3 py-1.5 text-right font-medium text-gray-900">{fmtDecimal((ppFirstByCat[cat] ?? 0) + (ppSecondByCat[cat] ?? 0))}</td>
                  </tr>
                ))}
                <tr className="border-t border-gray-200 bg-gray-50 font-semibold">
                  <td className="px-3 py-1.5 text-gray-700">Total</td>
                  <td className="px-3 py-1.5 text-right text-gray-900">{fmtDecimal(ppFirstTotal)}</td>
                  <td className="px-3 py-1.5 text-right text-gray-900">{fmtDecimal(ppSecondTotal)}</td>
                  <td className="px-3 py-1.5 text-right text-gray-900">{fmtDecimal(ppFirstTotal + ppSecondTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Day detail modal */}
        {modalDate && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            onClick={closeModal}
          >
            <div
              className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl bg-white shadow-xl p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={closeModal}
                className="absolute top-3 right-3 text-gray-400 hover:text-gray-700 text-lg leading-none"
                aria-label="Close"
              >
                &times;
              </button>
              <h3 className="text-sm font-bold text-gray-900 mb-3">{dateLabel(modalDate)} &mdash; {modalDate}</h3>

              {dayLoading ? (
                <p className="text-xs text-gray-400">Loading...</p>
              ) : dayDetail ? (
                <>
                  {/* Summary */}
                  <div className="mb-4 flex gap-4 text-xs">
                    <div>
                      <span className="text-gray-500">Total:</span>{' '}
                      <span className="font-semibold">{fmt(dayDetail.totalMinutes)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">OT balance:</span>{' '}
                      <span className={`font-semibold ${dayDetail.overtimeBalanceAfter > 0 ? 'text-green-600' : ''}`}>
                        {fmt(dayDetail.overtimeBalanceAfter)}
                      </span>
                    </div>
                  </div>

                  {/* By category */}
                  <h4 className="text-xs font-semibold text-gray-700 mb-1">By Category</h4>
                  <div className="mb-4 space-y-0.5 text-xs">
                    {Object.entries(dayDetail.byCategory)
                      .sort(([, a], [, b]) => b - a)
                      .map(([cat, mins]) => (
                        <div key={cat} className="flex justify-between">
                          <span className="text-gray-600 truncate max-w-[260px]">{cat}</span>
                          <span className="text-gray-800 font-medium ml-2 whitespace-nowrap">{fmt(mins)}</span>
                        </div>
                      ))}
                  </div>

                  {/* Task list */}
                  <h4 className="text-xs font-semibold text-gray-700 mb-1">Tasks</h4>
                  <div className="space-y-0.5 text-xs mb-4">
                    {dayDetail.tasks.map((t) => (
                      <div key={t.id} className="flex justify-between">
                        <span className="text-gray-600 truncate max-w-[280px]" title={t.taskTitle}>
                          {t.taskTitle}
                        </span>
                        <span className="text-gray-800 font-medium ml-2 whitespace-nowrap">{fmt(t.durationMinutes)}</span>
                      </div>
                    ))}
                    {dayDetail.tasks.length === 0 && (
                      <p className="text-gray-400">No tasks recorded</p>
                    )}
                  </div>

                  {/* Overtime drivers */}
                  {dayDetail.overtimeDrivers.length > 0 && (
                    <>
                      <h4 className="text-xs font-semibold text-gray-700 mb-1">Overtime Drivers</h4>
                      <div className="space-y-0.5 text-xs">
                        {dayDetail.overtimeDrivers.map((t) => (
                          <div key={t.id} className="flex justify-between text-amber-700">
                            <span className="truncate max-w-[280px]" title={t.taskTitle}>{t.taskTitle}</span>
                            <span className="font-medium ml-2 whitespace-nowrap">{fmt(t.durationMinutes)}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              ) : (
                <p className="text-xs text-red-500">Failed to load day details</p>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

/* ── OT delta helper (computed client-side from daily_totals) ───── */

function computeOTDelta(row: DailyRow): number {
  const weekend = isWeekend(row.date);
  if (weekend) {
    return row.totalMinutes;
  }
  if (row.totalMinutes > 480) {
    return row.totalMinutes - 480;
  }
  return -(480 - row.totalMinutes);
}
