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
