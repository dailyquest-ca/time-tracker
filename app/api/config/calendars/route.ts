import { listCalendars } from '@/lib/google';
import { getValidGoogleToken } from '@/lib/google-calendar-sync';
import { NextResponse } from 'next/server';

export async function GET() {
  const accessToken = await getValidGoogleToken();
  if (!accessToken) {
    return NextResponse.json(
      { error: 'Not connected to Google. Connect in Settings.' },
      { status: 401 },
    );
  }
  try {
    const calendars = await listCalendars(accessToken);
    return NextResponse.json({ data: calendars });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
