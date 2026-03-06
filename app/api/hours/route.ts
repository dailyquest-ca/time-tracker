import { getDailyTotalsInRange } from '@/lib/overtime';
import { isBCWorkDay } from '@/lib/workdays-bc';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const from = request.nextUrl.searchParams.get('from');
  const to = request.nextUrl.searchParams.get('to');
  if (!from || !to) {
    return NextResponse.json(
      { error: 'Query params "from" and "to" (YYYY-MM-DD) required' },
      { status: 400 }
    );
  }
  const fromMatch = /^\d{4}-\d{2}-\d{2}$/.exec(from);
  const toMatch = /^\d{4}-\d{2}-\d{2}$/.exec(to);
  if (!fromMatch || !toMatch) {
    return NextResponse.json(
      { error: 'from and to must be YYYY-MM-DD' },
      { status: 400 }
    );
  }
  if (from > to) {
    return NextResponse.json(
      { error: 'from must be <= to' },
      { status: 400 }
    );
  }
  try {
    const rows = await getDailyTotalsInRange(from, to);
    const data = rows.map((r) => ({ ...r, isWorkDay: isBCWorkDay(r.date) }));
    return NextResponse.json({ data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
