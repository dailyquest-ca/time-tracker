import { getValidAccessToken } from '@/lib/sync';
import { db } from '@/lib/db';
import { microsoftTokens } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export async function GET() {
  const ticktickToken = await getValidAccessToken();
  const msRows = await db
    .select()
    .from(microsoftTokens)
    .where(eq(microsoftTokens.userId, 'default'))
    .limit(1);
  return NextResponse.json({
    connected: !!ticktickToken,
    microsoftConnected: msRows.length > 0,
  });
}
