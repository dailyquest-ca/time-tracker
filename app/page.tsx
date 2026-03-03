import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="min-h-screen p-6">
      <h1 className="text-2xl font-semibold">Time Tracker</h1>
      <p className="mt-2 text-gray-600">
        Track daily hours from TickTick with overtime.
      </p>
      <Link
        href="/dashboard"
        className="mt-4 inline-block rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      >
        Go to Dashboard
      </Link>
      <Link
        href="/settings"
        className="ml-3 inline-block rounded border border-gray-300 px-4 py-2 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2"
      >
        Settings
      </Link>
    </main>
  );
}
