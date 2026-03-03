import { getProjects } from '@/lib/ticktick';
import { getValidAccessToken } from '@/lib/sync';
import { NextResponse } from 'next/server';

export async function GET() {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json(
      { error: 'Not connected to TickTick' },
      { status: 401 }
    );
  }
  try {
    const projects = await getProjects(accessToken);
    return NextResponse.json({ data: projects });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
