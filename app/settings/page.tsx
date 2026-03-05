'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

interface CalendarEntry {
  id: string;
  summary?: string;
  primary?: boolean;
}

interface CategoryRow {
  id: number;
  name: string;
  archived: number;
  displayOrder: number;
}

export default function SettingsPage() {
  const [googleConnected, setGoogleConnected] = useState<boolean | null>(null);
  const [calendars, setCalendars] = useState<CalendarEntry[]>([]);
  const [workCalendarId, setWorkCalendarId] = useState<string | null>(null);
  const [categoriesList, setCategoriesList] = useState<CategoryRow[]>([]);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingCalendar, setSavingCalendar] = useState(false);
  const [savingCategories, setSavingCategories] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const connRes = await fetch('/api/config/connection');
      if (connRes.ok) {
        const data = await connRes.json();
        setGoogleConnected(data.googleConnected ?? false);
      } else {
        setGoogleConnected(false);
      }

      const calRes = await fetch('/api/config/calendars');
      if (calRes.ok) {
        const calData = await calRes.json();
        setCalendars(calData.data ?? []);
      } else {
        setCalendars([]);
      }

      const workRes = await fetch('/api/config/work-calendar');
      if (workRes.ok) {
        const workData = await workRes.json();
        setWorkCalendarId(workData.calendarId ?? null);
      } else {
        setWorkCalendarId(null);
      }

      const catRes = await fetch('/api/categories');
      if (catRes.ok) {
        const catData = await catRes.json();
        setCategoriesList(catData.data ?? []);
      } else {
        setCategoriesList([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    if (err) setUrlError(decodeURIComponent(err));
  }, []);

  const handleArchiveCategory = async (id: number, archived: number) => {
    const activeCount = categoriesList.filter((c) => c.archived === 0).length;
    if (archived === 1 && activeCount <= 1) {
      setError('At least one active category is required.');
      return;
    }
    setSavingCategories(true);
    setError(null);
    try {
      const updated = categoriesList.map((c) =>
        c.id === id ? { ...c, archived } : c,
      );
      const res = await fetch('/api/categories', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categories: updated.map((c) => ({
            id: c.id,
            name: c.name,
            archived: c.archived,
          })),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Failed to update categories');
      }
      const data = await res.json();
      setCategoriesList(data.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update categories');
    } finally {
      setSavingCategories(false);
    }
  };

  const handleAddCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) return;
    setSavingCategories(true);
    setError(null);
    try {
      const res = await fetch('/api/categories', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categories: [
            ...categoriesList.map((c) => ({ id: c.id, name: c.name, archived: c.archived })),
            { name, archived: 0 },
          ],
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Failed to add category');
      }
      const data = await res.json();
      setCategoriesList(data.data ?? []);
      setNewCategoryName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add category');
    } finally {
      setSavingCategories(false);
    }
  };

  const handleSaveWorkCalendar = async (calendarId: string) => {
    setSavingCalendar(true);
    setError(null);
    try {
      const res = await fetch('/api/config/work-calendar', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calendarId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Failed to save');
      }
      setWorkCalendarId(calendarId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save calendar');
    } finally {
      setSavingCalendar(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen p-6">
        <p className="text-gray-500">Loading settings…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6">
      <div className="mx-auto max-w-2xl">
        <header className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Settings</h1>
          <Link
            href="/"
            className="text-gray-600 underline hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
          >
            Dashboard
          </Link>
        </header>

        {urlError && (
          <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" role="alert">
            {urlError.includes('missing_connection_string') || urlError.includes('POSTGRES_URL') ? (
              <>
                <strong>Database not configured.</strong> Add a Vercel Postgres database in your Vercel project (Storage → Create Database), then add the <code className="bg-amber-100 px-1 rounded">POSTGRES_URL</code> environment variable and redeploy.
              </>
            ) : (
              urlError
            )}
          </div>
        )}
        {error && (
          <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
            {error}
          </div>
        )}

        <section className="mb-8">
          <h2 className="mb-2 text-lg font-medium">Google Calendar</h2>
          <p className="mb-2 text-sm text-gray-600">
            {googleConnected
              ? 'Connected. Select your Work calendar below; time tracking updates when that calendar changes.'
              : 'Connect your Google account, then choose which calendar to use for work hours.'}
          </p>
          {googleConnected ? (
            <span className="text-sm text-green-600">Connected</span>
          ) : (
            <a
              href="/api/auth/google"
              className="inline-block rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              Connect Google
            </a>
          )}
        </section>

        {googleConnected && calendars.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-2 text-lg font-medium">Work calendar</h2>
            <p className="mb-2 text-sm text-gray-600">
              Events from the selected calendar are synced as work segments. Categories are derived from event titles (e.g. a leading acronym like PIS or ELAN, or broad categories like Learning, 1:1s).
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {calendars.map((cal) => (
                <button
                  key={cal.id}
                  type="button"
                  onClick={() => handleSaveWorkCalendar(cal.id)}
                  disabled={savingCalendar}
                  className={`rounded px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 ${
                    workCalendarId === cal.id
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {cal.summary || cal.id}
                  {cal.primary && ' (primary)'}
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="mb-8">
          <h2 className="mb-2 text-lg font-medium">Categories</h2>
          <p className="mb-2 text-sm text-gray-600">
            Time is grouped by these categories. Events with a leading acronym (e.g. PIS, ELAN) in the title use that as the category if it matches one below; otherwise they fall into Learning, 1:1s, or General tasks/meetings. Archived categories still apply to past dates but are not used for new events.
          </p>
          <ul className="mb-3 space-y-1.5">
            {categoriesList.map((cat) => (
              <li key={cat.id} className="flex items-center gap-2 text-sm">
                <span className={cat.archived ? 'text-gray-400 line-through' : ''}>
                  {cat.name}
                </span>
                {cat.archived ? (
                  <span className="text-gray-400 text-xs">(archived)</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleArchiveCategory(cat.id, 1)}
                    disabled={savingCategories || categoriesList.filter((c) => c.archived === 0).length <= 1}
                    className="text-amber-600 hover:underline disabled:opacity-50 disabled:cursor-not-allowed text-xs"
                  >
                    Archive
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <input
              type="text"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="New category name"
              className="rounded border border-gray-300 px-2 py-1.5 text-sm"
              onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
            />
            <button
              type="button"
              onClick={handleAddCategory}
              disabled={savingCategories || !newCategoryName.trim()}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
