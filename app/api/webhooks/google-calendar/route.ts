import { stampLegacyWebhookReceived } from '@/lib/google-calendar-sync';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Legacy webhook endpoint. Old Google watch channels still post here.
 * Always acknowledge with 200 so Google does not retry, but never run sync.
 * New watches use /api/webhooks/google-calendar-v2.
 */
export async function POST(request: NextRequest) {
  const channelId = request.headers.get('x-goog-channel-id');
  await stampLegacyWebhookReceived().catch(() => {});
  console.log('[webhook-legacy] Ignored notification on old endpoint', channelId ?? '(no channel)');
  return NextResponse.json({ ok: true, legacy: true }, { status: 200 });
}
