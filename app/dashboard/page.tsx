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
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function getWeekRange(): { from: string; to: string } {
  const now = new Date();
  const day = now.getDay();
  const monOffset = day === 0 ? -6 : 1 - day;
  const mon = new Date(now);
  mon.setDate(now.getDate() + monOffset);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return {
    from: mon.toISOString().slice(0, 10),
    to: sun.toISOString().slice(0, 10),
  };
}

function getMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    .toISOString()
    .slice(0, 10);
  return { from, to };
}

export default function DashboardPage() {
  const [range, setRange] = useState<{ from: string; to: string }>(() =>
    getWeekRange()
  );
  const [data, setData] = useState<DailyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

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
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Sync failed');
      await fetchHours(range.from, range.to);
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const setRangeWeek = () => setRange(getWeekRange());
  const setRangeMonth = () => setRange(getMonthRange());

  return (
    <main className="min-h-screen p-6">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold">Time Tracker</h1>
          <nav className="flex items-center gap-3">
            <Link
              href="/"
              className="text-gray-600 underline hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
            >
              Home
            </Link>
            <Link
              href="/settings"
              className="text-gray-600 underline hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
            >
              Settings
            </Link>
          </nav>
        </header>

        <div className="mb-4 flex flex-wrap items-center gap-4">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={setRangeWeek}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              This week
            </button>
            <button
              type="button"
              onClick={setRangeMonth}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              This month
            </button>
          </div>
          <span className="text-sm text-gray-500">
            {range.from} – {range.to}
          </span>
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        </div>

        {syncError && (
          <p className="mb-2 text-sm text-red-600" role="alert">
            {syncError}
          </p>
        )}

        {loading ? (
          <p className="text-gray-500">Loading…</p>
        ) : data.length === 0 ? (
          <p className="text-gray-500">
            No hours in this range. Connect TickTick in Settings and run Sync.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse border border-gray-200 text-left text-sm">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-gray-200 px-3 py-2 font-medium">
                    Date
                  </th>
                  <th className="border border-gray-200 px-3 py-2 font-medium">
                    Total
                  </th>
                  <th className="border border-gray-200 px-3 py-2 font-medium">
                    By category
                  </th>
                  <th className="border border-gray-200 px-3 py-2 font-medium">
                    Overtime (after)
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.map((row) => (
                  <tr key={row.date} className="hover:bg-gray-50">
                    <td className="border border-gray-200 px-3 py-2">
                      {row.date}
                    </td>
                    <td className="border border-gray-200 px-3 py-2">
                      {formatHours(row.totalMinutes)}
                    </td>
                    <td className="border border-gray-200 px-3 py-2">
                      {Object.entries(row.minutesByCategory ?? {})
                        .sort(([, a], [, b]) => b - a)
                        .map(([name, mins]) => `${name}: ${formatHours(mins)}`)
                        .join(', ') || '—'}
                    </td>
                    <td className="border border-gray-200 px-3 py-2">
                      {formatHours(row.overtimeBalanceAfter)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
