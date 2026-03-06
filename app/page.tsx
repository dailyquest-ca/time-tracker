'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fmtHours,
  dateLabel,
  topCategories,
  getPageRange,
  getYearRange,
  getPayPeriods,
  sumByCategory,
} from '@/lib/format';

/* ── Types ─────────────────────────────────────────────────────────── */

interface DailyRow {
  date: string;
  totalMinutes: number;
  minutesByCategory: Record<string, number>;
  overtimeBalanceAfter: number;
  isWorkDay?: boolean;
  note?: string | null;
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
  note?: string | null;
  tasks: DayTask[];
  overtimeDrivers: DayTask[];
}

function rangeStr(from: string, to: string): string {
  return `${from} to ${to}`;
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
  const [watchWarning, setWatchWarning] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  // Day detail modal
  const [modalDate, setModalDate] = useState<string | null>(null);
  const [dayDetail, setDayDetail] = useState<DayDetail | null>(null);
  const [dayNote, setDayNote] = useState('');
  const [dayNoteSaving, setDayNoteSaving] = useState(false);
  const [dayLoading, setDayLoading] = useState(false);

  // Pay period
  const [ppMonth, setPpMonth] = useState(new Date().getMonth() + 1);
  const [ppYear, setPpYear] = useState(new Date().getFullYear());
  const [ppData, setPpData] = useState<DailyRow[]>([]);

  const range = useMemo(() => {
    if (view === 'year') return getYearRange(selectedYear);
    return getPageRange(page, PAGE_SIZE);
  }, [view, selectedYear, page]);

  const fetchHours = useCallback(async (from: string, to: string, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`/api/hours?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setData(json.data ?? []);
    } catch {
      if (!silent) setData([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHours(range.from, range.to);
  }, [range.from, range.to, fetchHours]);

  useEffect(() => {
    let knownSync = lastSyncedAt;
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/sync/status');
        if (!res.ok) return;
        const json = await res.json();
        const remote: string | null = json.lastSyncedAt ?? null;
        if (remote && remote !== knownSync) {
          knownSync = remote;
          setLastSyncedAt(remote);
          fetchHours(range.from, range.to, true);
          const mm = String(ppMonth).padStart(2, '0');
          const lastDay = new Date(ppYear, ppMonth, 0).getDate();
          fetch(`/api/hours?from=${ppYear}-${mm}-01&to=${ppYear}-${mm}-${lastDay}`)
            .then((r) => r.json())
            .then((j) => setPpData(j.data ?? []))
            .catch(() => {});
        }
      } catch { /* network error, ignore until next tick */ }
    }, 5_000);
    return () => clearInterval(interval);
  }, [range.from, range.to, fetchHours, ppMonth, ppYear, lastSyncedAt]);

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

  const handleSyncNow = async () => {
    setSyncing(true);
    setSyncError(null);
    setWatchWarning(null);
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Sync failed');
      if (json.watchError) {
        setWatchWarning(`Live updates unavailable: ${json.watchError}`);
      }
      setLastSyncedAt(new Date().toISOString());
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
    setDayNote('');
    try {
      const res = await fetch(`/api/day?date=${encodeURIComponent(date)}`);
      if (!res.ok) throw new Error(await res.text());
      const json: DayDetail = await res.json();
      setDayDetail(json);
      setDayNote(json.note ?? '');
    } catch {
      setDayDetail(null);
    } finally {
      setDayLoading(false);
    }
  };

  const closeModal = () => {
    setModalDate(null);
    setDayDetail(null);
    setDayNote('');
  };

  const saveDayNote = async () => {
    if (!modalDate) return;
    setDayNoteSaving(true);
    try {
      const res = await fetch(`/api/day?date=${encodeURIComponent(modalDate)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: dayNote.trim() || null }),
      });
      if (!res.ok) throw new Error(await res.text());
      const value = dayNote.trim() || null;
      setDayDetail((prev) => (prev ? { ...prev, note: value } : null));
    } finally {
      setDayNoteSaving(false);
    }
  };

  // Hide future days; hide non-work days with no work (holidays/weekends with zero time)
  const visibleData = useMemo(() => {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    return data.filter(
      (r) => r.date <= todayStr && (r.isWorkDay || r.totalMinutes > 0),
    );
  }, [data]);

  const totalMinutesRange = visibleData.reduce((s, r) => s + r.totalMinutes, 0);
  const latestOT = visibleData.length > 0 ? visibleData[visibleData.length - 1].overtimeBalanceAfter : 0;

  // Compute OT delta for each row (using isWorkDay so holidays don't show -8)
  const dataWithDelta = useMemo(() => {
    return visibleData.map((r, i) => {
      const prevBal = i > 0 ? visibleData[i - 1].overtimeBalanceAfter : r.overtimeBalanceAfter - computeOTDelta(r);
      const delta = r.overtimeBalanceAfter - prevBal;
      return { ...r, otDelta: delta };
    });
  }, [visibleData]);

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
              onClick={handleSyncNow}
              disabled={syncing}
              className="text-gray-400 hover:text-gray-600 disabled:opacity-50 text-xs"
              title="Force a manual sync with Google Calendar"
            >
              {syncing ? 'Syncing…' : 'Sync'}
            </button>
            <Link href="/settings" className="text-gray-500 hover:text-gray-800 underline text-xs">
              Settings
            </Link>
          </div>
        </header>
        {syncError && (
          <p className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">{syncError}</p>
        )}
        {watchWarning && (
          <p className="mb-2 rounded border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-700">{watchWarning}</p>
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
        {!loading && visibleData.length > 0 && (
          <div className="mb-3 grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">Total</p>
              <p className="text-lg font-semibold text-gray-900">{fmtHours(totalMinutesRange)} h</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">OT Balance</p>
              <p className={`text-lg font-semibold ${latestOT > 0 ? 'text-green-600' : 'text-gray-900'}`}>
                {fmtHours(latestOT)} h
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
        ) : visibleData.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white px-5 py-8 text-center text-sm text-gray-500 shadow-sm">
            No hours in this range.{' '}
            <Link href="/settings" className="underline text-blue-600">Connect Google and choose a work calendar</Link>
            {' '}in Settings. Hours update automatically when your calendar changes.
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
                  <th className="px-2 py-2 text-left font-semibold max-w-[140px]">Note</th>
                </tr>
              </thead>
              <tbody>
                {[...dataWithDelta].reverse().map((row) => {
                  const today = new Date().toISOString().slice(0, 10);
                  const isToday = row.date === today;
                  const notWorkDay = !row.isWorkDay;
                  const { shown, extra } = topCategories(row.minutesByCategory ?? {}, 2);

                  return (
                    <tr
                      key={row.date}
                      onClick={() => openDay(row.date)}
                      className={`border-b border-gray-100 last:border-0 cursor-pointer transition-colors ${
                        isToday ? 'bg-blue-50 hover:bg-blue-100' : notWorkDay ? 'bg-gray-50/50 hover:bg-gray-100' : 'hover:bg-gray-50'
                      }`}
                    >
                      <td className="px-3 py-2 whitespace-nowrap text-gray-700 font-medium">
                        {dateLabel(row.date)}
                      </td>
                      <td className="px-2 py-2 text-right whitespace-nowrap font-semibold text-gray-900">
                        {row.totalMinutes > 0 ? `${fmtHours(row.totalMinutes)} h` : <span className="text-gray-300">&mdash;</span>}
                      </td>
                      <td className="px-2 py-2 text-gray-600 truncate max-w-[180px]">
                        {shown.length > 0 ? (
                          <>
                            {shown.map(([cat, mins]) => (
                              <span key={cat} className="inline-block mr-2">
                                <span className="text-gray-500">{cat.replace(/^[^\w]*/, '').slice(0, 12)}</span>
                                <span className="ml-0.5 text-gray-800">{fmtHours(mins)}</span>
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
                        {row.otDelta !== 0 ? (row.otDelta > 0 ? '+' : '') + fmtHours(row.otDelta) + ' h' : <span>&mdash;</span>}
                      </td>
                      <td className={`px-3 py-2 text-right whitespace-nowrap font-semibold ${
                        row.overtimeBalanceAfter > 0 ? 'text-green-600' : 'text-gray-400'
                      }`}>
                        {fmtHours(row.overtimeBalanceAfter)} h
                      </td>
                      <td className="px-2 py-2 text-gray-600 truncate max-w-[140px]" title={row.note ?? undefined}>
                        {row.note ? (
                          <span className="truncate block">{row.note.length > 28 ? `${row.note.slice(0, 25)}…` : row.note}</span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
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
                    <td className="px-3 py-1.5 text-right text-gray-800">{fmtHours(ppFirstByCat[cat] ?? 0)}</td>
                    <td className="px-3 py-1.5 text-right text-gray-800">{fmtHours(ppSecondByCat[cat] ?? 0)}</td>
                    <td className="px-3 py-1.5 text-right font-medium text-gray-900">{fmtHours((ppFirstByCat[cat] ?? 0) + (ppSecondByCat[cat] ?? 0))}</td>
                  </tr>
                ))}
                <tr className="border-t border-gray-200 bg-gray-50 font-semibold">
                  <td className="px-3 py-1.5 text-gray-700">Total</td>
                  <td className="px-3 py-1.5 text-right text-gray-900">{fmtHours(ppFirstTotal)}</td>
                  <td className="px-3 py-1.5 text-right text-gray-900">{fmtHours(ppSecondTotal)}</td>
                  <td className="px-3 py-1.5 text-right text-gray-900">{fmtHours(ppFirstTotal + ppSecondTotal)}</td>
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
                      <span className="font-semibold">{fmtHours(dayDetail.totalMinutes)} h</span>
                    </div>
                    <div>
                      <span className="text-gray-500">OT balance:</span>{' '}
                      <span className={`font-semibold ${dayDetail.overtimeBalanceAfter > 0 ? 'text-green-600' : ''}`}>
                        {fmtHours(dayDetail.overtimeBalanceAfter)} h
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
                          <span className="text-gray-800 font-medium ml-2 whitespace-nowrap">{fmtHours(mins)} h</span>
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
                        <span className="text-gray-800 font-medium ml-2 whitespace-nowrap">{fmtHours(t.durationMinutes)} h</span>
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
                      <div className="space-y-0.5 text-xs mb-4">
                        {dayDetail.overtimeDrivers.map((t) => (
                          <div key={t.id} className="flex justify-between text-amber-700">
                            <span className="truncate max-w-[280px]" title={t.taskTitle}>{t.taskTitle}</span>
                            <span className="font-medium ml-2 whitespace-nowrap">{fmtHours(t.durationMinutes)} h</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {/* Overtime note (why OT was needed) */}
                  <h4 className="text-xs font-semibold text-gray-700 mb-1">Overtime note</h4>
                  <p className="text-xs text-gray-500 mb-1">Why was there overtime? (e.g. deployment, last meeting ran late)</p>
                  <textarea
                    value={dayNote}
                    onChange={(e) => setDayNote(e.target.value)}
                    placeholder="Add a note…"
                    rows={3}
                    className="mb-2 w-full rounded border border-gray-300 px-2 py-1.5 text-sm resize-y"
                    aria-label="Overtime note"
                  />
                  <button
                    type="button"
                    onClick={saveDayNote}
                    disabled={dayNoteSaving}
                    className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {dayNoteSaving ? 'Saving…' : 'Save note'}
                  </button>
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
  if (!row.isWorkDay) {
    return row.totalMinutes;
  }
  if (row.totalMinutes > 480) {
    return row.totalMinutes - 480;
  }
  return -(480 - row.totalMinutes);
}
