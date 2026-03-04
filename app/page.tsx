'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

interface DailyRow {
  date: string;
  totalMinutes: number;
  minutesByCategory: Record<string, number>;
  overtimeBalanceAfter: number;
}

function formatHours(minutes: number): string {
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const sign = minutes < 0 ? '-' : '';
  if (m === 0) return `${sign}${h}h`;
  return `${sign}${h}h ${m}m`;
}

function getLast30DaysRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - 29);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  return d.toLocaleDateString('en-CA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export default function HomePage() {
  const [range] = useState<{ from: string; to: string }>(getLast30DaysRange);
  const [data, setData] = useState<DailyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const fetchHours = useCallback(async (from: string, to: string) => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/hours?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      );
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

  const handleSync = async () => {
    setSyncing(true);
    setSyncError(null);
    setSyncMsg(null);
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Sync failed');
      setSyncMsg(
        json.segmentsProcessed != null
          ? `Synced ${json.segmentsProcessed} task${json.segmentsProcessed === 1 ? '' : 's'}`
          : 'Sync complete'
      );
      await fetchHours(range.from, range.to);
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  // Derived totals
  const totalMinutes30 = data.reduce((sum, r) => sum + r.totalMinutes, 0);
  const latestOvertime =
    data.length > 0 ? data[data.length - 1].overtimeBalanceAfter : 0;

  // All project names across the range, sorted by total minutes desc
  const projectTotals: Record<string, number> = {};
  for (const row of data) {
    for (const [name, mins] of Object.entries(row.minutesByCategory ?? {})) {
      projectTotals[name] = (projectTotals[name] ?? 0) + mins;
    }
  }
  const allProjects = Object.entries(projectTotals)
    .sort(([, a], [, b]) => b - a)
    .map(([name]) => name);

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Time Tracker</h1>
          <nav className="flex items-center gap-4 text-sm">
            <Link
              href="/settings"
              className="text-gray-500 hover:text-gray-800 underline focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
            >
              Settings
            </Link>
          </nav>
        </header>

        {/* Controls */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <span className="text-sm text-gray-500">
            Last 30 days &mdash; {range.from} to {range.to}
          </span>
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
          {syncMsg && (
            <span className="text-sm text-green-600">{syncMsg}</span>
          )}
        </div>

        {syncError && (
          <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {syncError}
          </p>
        )}

        {/* Summary cards */}
        {!loading && data.length > 0 && (
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-gray-200 bg-white px-5 py-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Total hours (30 days)
              </p>
              <p className="mt-1 text-2xl font-semibold text-gray-900">
                {formatHours(totalMinutes30)}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white px-5 py-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Overtime balance
              </p>
              <p
                className={`mt-1 text-2xl font-semibold ${
                  latestOvertime > 0 ? 'text-green-600' : 'text-gray-900'
                }`}
              >
                {formatHours(latestOvertime)}
              </p>
            </div>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <p className="text-gray-500">Loading…</p>
        ) : data.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white px-5 py-8 text-center text-sm text-gray-500 shadow-sm">
            No hours in this range.{' '}
            <Link href="/settings" className="underline text-blue-600 hover:text-blue-800">
              Connect TickTick in Settings
            </Link>{' '}
            then click Sync now.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-3 font-semibold text-gray-700 whitespace-nowrap">Date</th>
                  <th className="px-4 py-3 font-semibold text-gray-700 whitespace-nowrap">Total</th>
                  {allProjects.map((name) => (
                    <th key={name} className="px-4 py-3 font-semibold text-gray-700 whitespace-nowrap">
                      {name}
                    </th>
                  ))}
                  <th className="px-4 py-3 font-semibold text-gray-700 whitespace-nowrap">Overtime balance</th>
                </tr>
              </thead>
              <tbody>
                {[...data].reverse().map((row) => {
                  const isToday = row.date === new Date().toISOString().slice(0, 10);
                  return (
                    <tr
                      key={row.date}
                      className={`border-b border-gray-100 last:border-0 ${
                        isToday ? 'bg-blue-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <td className="px-4 py-2.5 whitespace-nowrap text-gray-700">
                        {formatDateLabel(row.date)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap font-medium text-gray-900">
                        {row.totalMinutes > 0 ? formatHours(row.totalMinutes) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      {allProjects.map((name) => {
                        const mins = row.minutesByCategory?.[name] ?? 0;
                        return (
                          <td key={name} className="px-4 py-2.5 whitespace-nowrap text-gray-600">
                            {mins > 0 ? formatHours(mins) : (
                              <span className="text-gray-200">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className={`px-4 py-2.5 whitespace-nowrap font-medium ${
                        row.overtimeBalanceAfter > 0 ? 'text-green-600' : 'text-gray-500'
                      }`}>
                        {formatHours(row.overtimeBalanceAfter)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
