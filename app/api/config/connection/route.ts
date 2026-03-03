import { getValidAccessToken } from '@/lib/sync';
import { NextResponse } from 'next/server';

export async function GET() {
  const token = await getValidAccessToken();
  return NextResponse.json({ connected: !!token });
}
