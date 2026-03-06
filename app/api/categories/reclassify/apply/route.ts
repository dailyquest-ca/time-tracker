import { applyReclassification } from '@/lib/category-reclassification';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  let body: { eventIds?: number[]; targetCategoryId?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!Array.isArray(body?.eventIds) || body.eventIds.length === 0) {
    return NextResponse.json(
      { error: 'eventIds (non-empty array of numbers) is required' },
      { status: 400 },
    );
  }

  if (typeof body?.targetCategoryId !== 'number') {
    return NextResponse.json(
      { error: 'targetCategoryId (number) is required' },
      { status: 400 },
    );
  }

  const result = await applyReclassification(
    body.eventIds,
    body.targetCategoryId,
  );

  return NextResponse.json({
    ok: true,
    eventsUpdated: result.eventsUpdated,
    affectedDates: result.affectedDates,
  });
}
