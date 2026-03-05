import { db } from '@/lib/db';
import { googleTokens } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getValidGoogleToken } from '@/lib/google-calendar-sync';

export async function GET() {
  const googleToken = await getValidGoogleToken();
  const googleRows = await db
    .select()
    .from(googleTokens)
    .where(eq(googleTokens.userId, 'default'))
    .limit(1);
  return NextResponse.json({
    googleConnected: !!googleToken && googleRows.length > 0,
  });
}
