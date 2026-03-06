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
  archived: boolean;
  displayOrder: number;
}

interface CategorySuggestions {
  suggestedFromSegments: string[];
  suggestedFromTitles: string[];
}

export default function SettingsPage() {
  const [googleConnected, setGoogleConnected] = useState<boolean | null>(null);
  const [calendars, setCalendars] = useState<CalendarEntry[]>([]);
  const [workCalendarId, setWorkCalendarId] = useState<string | null>(null);
  const [categoriesList, setCategoriesList] = useState<CategoryRow[]>([]);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [suggestions, setSuggestions] = useState<CategorySuggestions | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [mergeSource, setMergeSource] = useState<CategoryRow | null>(null);
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

      const sugRes = await fetch('/api/categories/suggestions');
      if (sugRes.ok) {
        const sugData = await sugRes.json();
        setSuggestions({
          suggestedFromSegments: sugData.suggestedFromSegments ?? [],
          suggestedFromTitles: sugData.suggestedFromTitles ?? [],
        });
      } else {
        setSuggestions(null);
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

  const saveCategories = async (
    payload: Array<{ id?: number; name: string; archived?: boolean; displayOrder?: number }>,
  ) => {
    setSavingCategories(true);
    setError(null);
    try {
      const res = await fetch('/api/categories', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categories: payload }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Failed to update categories');
      }
      const data = await res.json();
      setCategoriesList(data.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update categories');
      throw e;
    } finally {
      setSavingCategories(false);
    }
  };

  const handleArchiveCategory = async (id: number, archived: boolean) => {
    const activeCount = categoriesList.filter((c) => !c.archived).length;
    if (archived && activeCount <= 1) {
      setError('At least one active category is required.');
      return;
    }
    const updated = categoriesList.map((c) =>
      c.id === id ? { ...c, archived } : c,
    );
    await saveCategories(
      updated.map((c) => ({
        id: c.id,
        name: c.name,
        archived: c.archived,
        displayOrder: c.displayOrder,
      })),
    );
  };

  const handleAddCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) return;
    await saveCategories([
      ...categoriesList.map((c) => ({
        id: c.id,
        name: c.name,
        archived: c.archived,
        displayOrder: c.displayOrder,
      })),
      { name, archived: false },
    ]);
    setNewCategoryName('');
  };

  const handleAddSuggestion = async (name: string) => {
    await saveCategories([
      ...categoriesList.map((c) => ({
        id: c.id,
        name: c.name,
        archived: c.archived,
        displayOrder: c.displayOrder,
      })),
      { name: name.trim(), archived: false },
    ]);
    setSuggestions((prev) => {
      if (!prev) return null;
      const trim = name.trim();
      return {
        suggestedFromSegments: prev.suggestedFromSegments.filter((s) => s !== trim),
        suggestedFromTitles: prev.suggestedFromTitles.filter((s) => s !== trim),
      };
    });
  };

  const handleRenameCategory = async (id: number, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setEditingId(null);
    setEditingName('');
    const updated = categoriesList.map((c) =>
      c.id === id ? { ...c, name: trimmed } : c,
    );
    await saveCategories(
      updated.map((c) => ({
        id: c.id,
        name: c.name,
        archived: c.archived,
        displayOrder: c.displayOrder,
      })),
    );
  };

  const handleReorder = async (index: number, direction: 'up' | 'down') => {
    const list = [...categoriesList];
    const swap = direction === 'up' ? index - 1 : index + 1;
    if (swap < 0 || swap >= list.length) return;
    const a = list[index];
    const b = list[swap];
    list[index] = { ...b, displayOrder: a.displayOrder };
    list[swap] = { ...a, displayOrder: b.displayOrder };
    await saveCategories(
      list.map((c, i) => ({
        id: c.id,
        name: c.name,
        archived: c.archived,
        displayOrder: i,
      })),
    );
  };

  const handleMerge = async (sourceName: string, targetName: string) => {
    setSavingCategories(true);
    setError(null);
    setMergeSource(null);
    try {
      const res = await fetch('/api/categories/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceName, targetName }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Merge failed');
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Merge failed');
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

          {suggestions &&
            (suggestions.suggestedFromSegments.length > 0 ||
              suggestions.suggestedFromTitles.length > 0) && (
              <div className="mb-4 rounded border border-gray-200 bg-gray-50 p-3">
                <p className="mb-2 text-xs font-medium text-gray-600">
                  Suggested from your data
                </p>
                <div className="flex flex-wrap gap-2">
                  {[
                    ...new Set([
                      ...suggestions.suggestedFromSegments,
                      ...suggestions.suggestedFromTitles,
                    ]),
                  ]
                    .sort()
                    .map((name) => (
                      <span key={name} className="inline-flex items-center gap-1">
                        <span className="rounded bg-white px-2 py-0.5 text-sm shadow-sm">
                          {name}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleAddSuggestion(name)}
                          disabled={savingCategories}
                          className="text-blue-600 hover:underline disabled:opacity-50 text-xs"
                        >
                          Add
                        </button>
                      </span>
                    ))}
                </div>
              </div>
            )}

          <ul className="mb-3 space-y-1.5">
            {categoriesList.map((cat, index) => (
              <li
                key={cat.id}
                className="flex items-center gap-2 text-sm"
              >
                <span className="flex items-center gap-1">
                  {!cat.archived && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleReorder(index, 'up')}
                        disabled={savingCategories || index === 0}
                        className="text-gray-400 hover:text-gray-700 disabled:opacity-30 p-0.5"
                        title="Move up"
                        aria-label="Move up"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReorder(index, 'down')}
                        disabled={savingCategories || index === categoriesList.length - 1}
                        className="text-gray-400 hover:text-gray-700 disabled:opacity-30 p-0.5"
                        title="Move down"
                        aria-label="Move down"
                      >
                        ↓
                      </button>
                    </>
                  )}
                </span>
                {editingId === cat.id ? (
                  <input
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={() => {
                      if (editingName.trim() && editingName.trim() !== cat.name) {
                        handleRenameCategory(cat.id, editingName);
                      } else {
                        setEditingId(null);
                        setEditingName('');
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        if (editingName.trim()) handleRenameCategory(cat.id, editingName);
                        setEditingId(null);
                        setEditingName('');
                      }
                      if (e.key === 'Escape') {
                        setEditingId(null);
                        setEditingName('');
                      }
                    }}
                    className="rounded border border-gray-300 px-2 py-1 text-sm w-40"
                    autoFocus
                    aria-label="Category name"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (!cat.archived) {
                        setEditingId(cat.id);
                        setEditingName(cat.name);
                      }
                    }}
                    className={`text-left ${cat.archived === true ? 'cursor-default text-gray-400 line-through' : 'hover:bg-gray-100 rounded px-1 -mx-1'}`}
                  >
                    {cat.name}
                  </button>
                )}
                {cat.archived ? (
                  <span className="text-gray-400 text-xs">(archived)</span>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => handleArchiveCategory(cat.id, true)}
                      disabled={savingCategories || categoriesList.filter((c) => !c.archived).length <= 1}
                      className="text-amber-600 hover:underline disabled:opacity-50 disabled:cursor-not-allowed text-xs"
                    >
                      Archive
                    </button>
                    <span className="text-gray-300">|</span>
                    {mergeSource?.id === cat.id ? (
                      <span className="text-xs text-gray-500">Merge into…</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setMergeSource(cat)}
                        disabled={savingCategories}
                        className="text-blue-600 hover:underline disabled:opacity-50 text-xs"
                      >
                        Merge into…
                      </button>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>

          {mergeSource && (
            <div className="mb-4 rounded border border-blue-200 bg-blue-50 p-3">
              <p className="mb-2 text-sm text-gray-700">
                Merge &quot;{mergeSource.name}&quot; into:
              </p>
              <div className="flex flex-wrap gap-2">
                {categoriesList
                  .filter((c) => !c.archived && c.id !== mergeSource.id)
                  .map((target) => (
                    <button
                      key={target.id}
                      type="button"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Merge "${mergeSource.name}" into "${target.name}"? All past time under "${mergeSource.name}" will appear under "${target.name}".`,
                          )
                        ) {
                          handleMerge(mergeSource.name, target.name);
                        }
                      }}
                      disabled={savingCategories}
                      className="rounded bg-blue-600 px-2 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {target.name}
                    </button>
                  ))}
                <button
                  type="button"
                  onClick={() => setMergeSource(null)}
                  className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-700 hover:bg-gray-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

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
