import { db } from '@/lib/db';
import { appConfig } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
  const rows = await db
    .select()
    .from(appConfig)
    .where(eq(appConfig.key, 'work_days'))
    .limit(1);
  const value =
    rows.length > 0 ? (rows[0].value as number[]) : [1, 2, 3, 4, 5];
  return NextResponse.json({ data: value });
}

export async function PATCH(request: NextRequest) {
  let body: number[];
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!Array.isArray(body)) {
    return NextResponse.json(
      { error: 'Body must be an array of day numbers (1=Mon..7=Sun)' },
      { status: 400 }
    );
  }
  const valid = body.every(
    (n) => typeof n === 'number' && n >= 1 && n <= 7
  );
  if (!valid) {
    return NextResponse.json(
      { error: 'Each value must be 1-7 (1=Monday, 7=Sunday)' },
      { status: 400 }
    );
  }
  const unique = [...new Set(body)].sort((a, b) => a - b);
  await db
    .insert(appConfig)
    .values({
      key: 'work_days',
      value: unique,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: { value: unique, updatedAt: new Date() },
    });
  return NextResponse.json({ ok: true, data: unique });
}
