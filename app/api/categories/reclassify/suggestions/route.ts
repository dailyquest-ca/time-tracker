import {
  getAllowedWindow,
  getRecategorizationSuggestions,
} from '@/lib/category-reclassification';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const proposals = await getRecategorizationSuggestions();
  const window = getAllowedWindow();
  return NextResponse.json({ proposals, window });
}
