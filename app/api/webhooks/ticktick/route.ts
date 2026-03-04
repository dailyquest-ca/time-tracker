/**
 * TickTick webhook endpoint — called by TickTick when a task is created/updated/completed.
 *
 * Setup:
 * 1. In the TickTick developer portal, register a webhook pointing to:
 *      POST https://<your-domain>/api/webhooks/ticktick
 * 2. Copy the secret token TickTick provides and set it as TICKTICK_WEBHOOK_SECRET
 *    in Vercel project settings (and in .env.local for local testing).
 * 3. TickTick must send the HMAC-SHA256 signature in the x-ticktick-signature header.
 *    If TICKTICK_WEBHOOK_SECRET is not set, signature verification is skipped (dev only).
 */
import { runSync } from '@/lib/sync';
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

function verifyWebhookSignature(
  body: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature || !secret) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'utf8'),
    Buffer.from(expected, 'utf8')
  );
}

export async function POST(request: NextRequest) {
  const secret = process.env.TICKTICK_WEBHOOK_SECRET;
  const signature = request.headers.get('x-ticktick-signature');
  const raw = await request.text();
  if (secret && !verifyWebhookSignature(raw, signature, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }
  await runSync();
  return NextResponse.json({ ok: true });
}
