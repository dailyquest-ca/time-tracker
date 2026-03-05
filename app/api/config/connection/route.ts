import { getValidAccessToken } from '@/lib/sync';
import { db } from '@/lib/db';
import { googleTokens } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export async function GET() {
  const ticktickToken = await getValidAccessToken();
  const googleRows = await db
    .select()
    .from(googleTokens)
    .where(eq(googleTokens.userId, 'default'))
    .limit(1);
  return NextResponse.json({
    connected: !!ticktickToken,
    googleConnected: googleRows.length > 0,
  });
}
