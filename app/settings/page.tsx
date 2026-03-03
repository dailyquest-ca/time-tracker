'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

type WorkCategory = 'work_project' | 'general_task' | 'meeting';

interface CategoryMappingRow {
  id?: number;
  type: 'project' | 'tag';
  value: string;
  category: WorkCategory;
}

interface Project {
  id: string;
  name: string;
}

const CATEGORY_LABELS: Record<WorkCategory, string> = {
  work_project: 'Work project',
  general_task: 'General task',
  meeting: 'Meeting',
};

export default function SettingsPage() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [categories, setCategories] = useState<CategoryMappingRow[]>([]);
  const [workDays, setWorkDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [connRes, catRes, daysRes, projRes] = await Promise.all([
        fetch('/api/config/connection'),
        fetch('/api/config/categories'),
        fetch('/api/config/work-days'),
        fetch('/api/projects').catch(() => null),
      ]);
      setConnected(connRes.ok ? (await connRes.json()).connected : false);
      if (catRes.ok) {
        const j = await catRes.json();
        setCategories(
          (j.data ?? []).map((r: { id: number; type: string; value: string; category: WorkCategory }) => ({
            id: r.id,
            type: r.type as 'project' | 'tag',
            value: r.value,
            category: r.category,
          }))
        );
      }
      if (daysRes.ok) {
        const j = await daysRes.json();
        setWorkDays(j.data ?? [1, 2, 3, 4, 5]);
      }
      if (projRes?.ok) {
        const j = await projRes.json();
        setProjects(j.data ?? []);
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

  const saveCategories = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/config/categories', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          categories.map((c) => ({ type: c.type, value: c.value, category: c.category }))
        ),
      });
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error ?? 'Save failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const saveWorkDays = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/config/work-days', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workDays),
      });
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error ?? 'Save failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const addProjectMapping = (projectId: string, projectName: string, category: WorkCategory) => {
    if (categories.some((c) => c.type === 'project' && c.value === projectId)) return;
    setCategories((prev) => [
      ...prev,
      { type: 'project', value: projectId, category },
    ]);
  };

  const addTagMapping = () => {
    const tag = tagInput.trim();
    if (!tag || categories.some((c) => c.type === 'tag' && c.value === tag))
      return;
    setCategories((prev) => [
      ...prev,
      { type: 'tag', value: tag, category: 'general_task' },
    ]);
    setTagInput('');
  };

  const removeMapping = (index: number) => {
    setCategories((prev) => prev.filter((_, i) => i !== index));
  };

  const updateMappingCategory = (index: number, category: WorkCategory) => {
    setCategories((prev) =>
      prev.map((c, i) => (i === index ? { ...c, category } : c))
    );
  };

  const toggleWorkDay = (day: number) => {
    setWorkDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b)
    );
  };

  const dayLabels: Record<number, string> = {
    1: 'Mon',
    2: 'Tue',
    3: 'Wed',
    4: 'Thu',
    5: 'Fri',
    6: 'Sat',
    7: 'Sun',
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
            href="/dashboard"
            className="text-gray-600 underline hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
          >
            Dashboard
          </Link>
        </header>

        {urlError && (
          <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" role="alert">
            {urlError}
          </div>
        )}
        {error && (
          <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
            {error}
          </div>
        )}

        <section className="mb-8">
          <h2 className="mb-2 text-lg font-medium">TickTick</h2>
          <p className="mb-2 text-sm text-gray-600">
            {connected
              ? 'Connected. Completed tasks with start/end times will be synced as work segments.'
              : 'Connect your TickTick account to sync completed tasks.'}
          </p>
          {connected ? (
            <span className="text-sm text-green-600">Connected</span>
          ) : (
            <a
              href="/api/auth/ticktick"
              className="inline-block rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              Connect TickTick
            </a>
          )}
        </section>

        <section className="mb-8">
          <h2 className="mb-2 text-lg font-medium">Category mapping</h2>
          <p className="mb-3 text-sm text-gray-600">
            Map TickTick projects or tags to Work project, General task, or Meeting. Unmapped tasks count as General task.
          </p>
          <ul className="mb-3 space-y-2">
            {categories.map((c, i) => (
              <li
                key={`${c.type}-${c.value}-${i}`}
                className="flex items-center gap-2"
              >
                <span className="text-sm font-mono">
                  {c.type === 'project' ? 'Project' : 'Tag'}: {c.value}
                </span>
                <select
                  value={c.category}
                  onChange={(e) =>
                    updateMappingCategory(
                      i,
                      e.target.value as WorkCategory
                    )
                  }
                  className="rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  aria-label={`Category for ${c.value}`}
                >
                  {(Object.keys(CATEGORY_LABELS) as WorkCategory[]).map(
                    (cat) => (
                      <option key={cat} value={cat}>
                        {CATEGORY_LABELS[cat]}
                      </option>
                    )
                  )}
                </select>
                <button
                  type="button"
                  onClick={() => removeMapping(i)}
                  className="text-red-600 hover:underline focus:outline-none focus:ring-2 focus:ring-red-500 rounded"
                  aria-label={`Remove mapping for ${c.value}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <div className="mb-2 flex flex-wrap gap-2">
            {projects.map((p) => (
              <span key={p.id} className="flex gap-1">
                <button
                  type="button"
                  onClick={() =>
                    addProjectMapping(p.id, p.name, 'general_task')
                  }
                  className="rounded border border-gray-300 bg-white px-2 py-1 text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  + {p.name}
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTagMapping()}
              placeholder="Tag name"
              className="rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-40"
              aria-label="Tag name to add"
            />
            <button
              type="button"
              onClick={addTagMapping}
              className="rounded border border-gray-300 bg-white px-2 py-1 text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Add tag
            </button>
          </div>
          <button
            type="button"
            onClick={saveCategories}
            disabled={saving}
            className="mt-3 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            {saving ? 'Saving…' : 'Save mapping'}
          </button>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-medium">Work days</h2>
          <p className="mb-3 text-sm text-gray-600">
            Days that count toward the 8-hour standard and overtime (e.g. Mon–Fri).
          </p>
          <div className="flex gap-4">
            {(Object.entries(dayLabels) as [string, string][]).map(
              ([num, label]) => {
                const d = Number(num);
                return (
                  <label
                    key={d}
                    className="flex items-center gap-1 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={workDays.includes(d)}
                      onChange={() => toggleWorkDay(d)}
                      className="rounded border-gray-300 focus:ring-blue-500"
                      aria-label={label}
                    />
                    <span className="text-sm">{label}</span>
                  </label>
                );
              }
            )}
          </div>
          <button
            type="button"
            onClick={saveWorkDays}
            disabled={saving}
            className="mt-3 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            {saving ? 'Saving…' : 'Save work days'}
          </button>
        </section>
      </div>
    </main>
  );
}
