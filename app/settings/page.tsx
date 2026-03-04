'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

export default function SettingsPage() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const connRes = await fetch('/api/config/connection');
      if (connRes.ok) {
        const data = await connRes.json();
        setConnected(data.connected);
      } else {
        setConnected(false);
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
          <h2 className="mb-2 text-lg font-medium">Microsoft Calendar (Power Automate)</h2>
          <p className="mb-2 text-sm text-gray-600">
            Outlook/Teams calendar events are synced via a Power Automate flow that
            pushes events to this app. Non&ndash;all-day events are tracked as work
            segments, grouped by Outlook category.
          </p>
          <details className="mt-2 rounded border border-gray-200 bg-gray-50 p-3">
            <summary className="cursor-pointer text-sm font-medium text-gray-700">
              Setup instructions
            </summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-gray-600">
              <li>Open <a href="https://make.powerautomate.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">Power Automate</a> and create a new <strong>Scheduled cloud flow</strong> (e.g. every 15 minutes).</li>
              <li>Add <strong>Office 365 Outlook &rarr; Get events (V4)</strong>. Set Calendar id to your default calendar, and filter to today&apos;s date range.</li>
              <li>Add <strong>Apply to each</strong> over the returned events.</li>
              <li>Inside the loop, add an <strong>HTTP</strong> action:<br />
                <code className="block mt-1 bg-gray-100 p-2 rounded text-xs break-all">
                  POST &lt;your-app-url&gt;/api/ingest/calendar
                </code>
                <span className="block mt-1">Header: <code className="bg-gray-100 px-1 rounded text-xs">Authorization: Bearer &lt;INGEST_SECRET&gt;</code></span>
                <span className="block mt-1">Body (JSON): map <code className="bg-gray-100 px-1 rounded text-xs">Id, Subject, Start, End, Categories, IsAllDay</code> from the event.</span>
              </li>
              <li>Save and test the flow.</li>
            </ol>
          </details>
        </section>
      </div>
    </main>
  );
}
