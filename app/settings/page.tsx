'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

export default function SettingsPage() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [msConnected, setMsConnected] = useState<boolean | null>(null);
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
        setMsConnected(data.microsoftConnected);
      } else {
        setConnected(false);
        setMsConnected(false);
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
          <h2 className="mb-2 text-lg font-medium">Microsoft Calendar</h2>
          <p className="mb-2 text-sm text-gray-600">
            {msConnected
              ? 'Connected. Calendar events (non\u2013all-day) are synced as work segments, grouped by Outlook category.'
              : 'Connect your Microsoft work account to sync Outlook/Teams calendar events.'}
          </p>
          {msConnected ? (
            <span className="text-sm text-green-600">Connected</span>
          ) : (
            <a
              href="/api/auth/microsoft"
              className="inline-block rounded bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              Connect Microsoft
            </a>
          )}
        </section>
      </div>
    </main>
  );
}
