import { db } from '@/lib/db';
import { dailyTotals, workSegments } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: 'Query param "date" (YYYY-MM-DD) required' },
      { status: 400 }
    );
  }

  try {
    const segments = await db
      .select()
      .from(workSegments)
      .where(eq(workSegments.date, date));

    const [totalsRow] = await db
      .select()
      .from(dailyTotals)
      .where(eq(dailyTotals.date, date))
      .limit(1);

    const byCategory: Record<string, number> = {};
    let totalMinutes = 0;
    for (const s of segments) {
      const cat = s.category ?? '';
      byCategory[cat] = (byCategory[cat] ?? 0) + s.durationMinutes;
      totalMinutes += s.durationMinutes;
    }

    const overtimeBalanceAfter = totalsRow?.overtimeBalanceAfter ?? 0;

    const tasks = segments
      .map((s) => ({
        id: s.id,
        taskTitle: s.taskTitle ?? s.category,
        category: s.category,
        projectName: s.projectName,
        durationMinutes: s.durationMinutes,
        source: s.source ?? 'unknown',
      }))
      .sort((a, b) => b.durationMinutes - a.durationMinutes);

    // Top tasks that pushed the day over 8h
    const overtimeDrivers: typeof tasks = [];
    if (totalMinutes > 480) {
      let remaining = totalMinutes - 480;
      for (const t of tasks) {
        if (remaining <= 0) break;
        overtimeDrivers.push(t);
        remaining -= t.durationMinutes;
      }
    }

    return NextResponse.json({
      date,
      totalMinutes,
      byCategory,
      overtimeBalanceAfter,
      tasks,
      overtimeDrivers,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
