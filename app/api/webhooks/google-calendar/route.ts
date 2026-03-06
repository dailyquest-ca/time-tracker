import {
  getValidGoogleToken,
  getWorkCalendarId,
  runGoogleCalendarSync,
} from '@/lib/google-calendar-sync';
import { stopCalendarWatch } from '@/lib/google';
import { db } from '@/lib/db';
import { calendarWatch } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function isKnownChannel(channelId: string, resourceId: string | null): Promise<boolean> {
  const rows = await db
    .select({ channelId: calendarWatch.channelId, resourceId: calendarWatch.resourceId })
    .from(calendarWatch)
    .where(eq(calendarWatch.userId, 'default'))
    .limit(1);
  if (rows.length === 0) return false;
  const watch = rows[0];
  if (watch.channelId !== channelId) return false;
  if (resourceId && watch.resourceId !== resourceId) return false;
  return true;
}

function calendarIdFromResourceUri(resourceUri: string | null): string | null {
  if (!resourceUri) return null;
  try {
    const u = new URL(resourceUri);
    const parts = u.pathname.split('/').filter(Boolean);
    const idx = parts.indexOf('calendars');
    if (idx === -1 || idx + 1 >= parts.length) return null;
    const encodedId = parts[idx + 1];
    return decodeURIComponent(encodedId);
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const channelId = request.headers.get('x-goog-channel-id');
  const resourceState = request.headers.get('x-goog-resource-state');
  const resourceId = request.headers.get('x-goog-resource-id');
  const messageNumber = request.headers.get('x-goog-message-number');
  const resourceUri = request.headers.get('x-goog-resource-uri');
  const channelToken = request.headers.get('x-goog-channel-token');

  // #region agent log (pre-fix)
  if (process.env.NODE_ENV !== 'production') fetch('http://127.0.0.1:7719/ingest/e3960d2d-b42f-45cd-97c1-02ec42cc4fbe',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4ed024'},body:JSON.stringify({sessionId:'4ed024',runId:'pre-fix',hypothesisId:'A',location:'app/api/webhooks/google-calendar/route.ts:POST:entry',message:'Webhook received',data:{hasChannelId:!!channelId,hasResourceId:!!resourceId,resourceState,hasChannelToken:!!channelToken,messageNumber,resourceUriPrefix:resourceUri?.slice(0,60)??null,channelIdPrefix:channelId?.slice(0,8)??null,resourceIdSuffix:resourceId?.slice(-8)??null},timestamp:Date.now()})}).catch(()=>{});
  // #endregion agent log (pre-fix)

  if (!channelId) {
    // #region agent log (pre-fix)
    if (process.env.NODE_ENV !== 'production') fetch('http://127.0.0.1:7719/ingest/e3960d2d-b42f-45cd-97c1-02ec42cc4fbe',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4ed024'},body:JSON.stringify({sessionId:'4ed024',runId:'pre-fix',hypothesisId:'E',location:'app/api/webhooks/google-calendar/route.ts:POST:missing-channel',message:'Webhook missing channel id',data:{resourceState,hasResourceId:!!resourceId,hasChannelToken:!!channelToken},timestamp:Date.now()})}).catch(()=>{});
    // #endregion agent log (pre-fix)
    return NextResponse.json({ error: 'Missing channel id' }, { status: 400 });
  }

  const trusted = await isKnownChannel(channelId, resourceId);
  if (!trusted) {
    const uriCalendarId = calendarIdFromResourceUri(resourceUri);
    let stopAttempted = false;
    let stopError: string | null = null;
    const workCalendarId = await getWorkCalendarId().catch(() => null);

    if (resourceId && uriCalendarId && workCalendarId && uriCalendarId === workCalendarId) {
      const accessToken = await getValidGoogleToken().catch(() => null);
      if (accessToken) {
        stopAttempted = true;
        try {
          await stopCalendarWatch(accessToken, channelId, resourceId);
        } catch (e) {
          stopError = e instanceof Error ? e.message : String(e);
          console.warn('[webhook] Unknown channel stop attempt failed:', stopError);
        }
      }
    }

    // Reduce log spam: only warn when we actually attempted a stop and it failed.
    if (stopAttempted && !stopError) {
      console.log('[webhook] Unknown channel acknowledged and stop attempted.');
    }

    // #region agent log (pre-fix)
    if (process.env.NODE_ENV !== 'production') fetch('http://127.0.0.1:7719/ingest/e3960d2d-b42f-45cd-97c1-02ec42cc4fbe',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4ed024'},body:JSON.stringify({sessionId:'4ed024',runId:'pre-fix',hypothesisId:'A',location:'app/api/webhooks/google-calendar/route.ts:POST:unknown-ack',message:'Webhook unknown channel acknowledged',data:{status:200,resourceState,hasChannelToken:!!channelToken,channelIdPrefix:channelId.slice(0,8),resourceIdSuffix:resourceId?.slice(-8)??null,messageNumber,uriCalendarIdPrefix:uriCalendarId?.slice(0,8)??null,workCalendarMatch:uriCalendarId!=null&&workCalendarId!=null&&uriCalendarId===workCalendarId,stopAttempted,stopError},timestamp:Date.now()})}).catch(()=>{});
    // #endregion agent log (pre-fix)
    // Return 2xx to avoid any retry amplification and to keep Vercel logs quiet.
    return NextResponse.json({ ok: true, ignored: true }, { status: 200 });
  }

  if (resourceState !== 'sync' && resourceState !== 'exists') {
    // #region agent log (pre-fix)
    if (process.env.NODE_ENV !== 'production') fetch('http://127.0.0.1:7719/ingest/e3960d2d-b42f-45cd-97c1-02ec42cc4fbe',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4ed024'},body:JSON.stringify({sessionId:'4ed024',runId:'pre-fix',hypothesisId:'B',location:'app/api/webhooks/google-calendar/route.ts:POST:ignored-state',message:'Webhook ignored due to resourceState',data:{resourceState},timestamp:Date.now()})}).catch(()=>{});
    // #endregion agent log (pre-fix)
    return NextResponse.json({ ok: true });
  }

  try {
    // #region agent log (pre-fix)
    if (process.env.NODE_ENV !== 'production') fetch('http://127.0.0.1:7719/ingest/e3960d2d-b42f-45cd-97c1-02ec42cc4fbe',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4ed024'},body:JSON.stringify({sessionId:'4ed024',runId:'pre-fix',hypothesisId:'C',location:'app/api/webhooks/google-calendar/route.ts:POST:sync-start',message:'Webhook starting sync',data:{resourceState,messageNumber},timestamp:Date.now()})}).catch(()=>{});
    // #endregion agent log (pre-fix)
    const result = await runGoogleCalendarSync();
    if (!result.ok) {
      console.warn('[webhook] Sync failed:', result.error);
    }
  } catch (err) {
    console.error('[webhook] Error:', err);
  }

  // #region agent log (pre-fix)
  if (process.env.NODE_ENV !== 'production') fetch('http://127.0.0.1:7719/ingest/e3960d2d-b42f-45cd-97c1-02ec42cc4fbe',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4ed024'},body:JSON.stringify({sessionId:'4ed024',runId:'pre-fix',hypothesisId:'C',location:'app/api/webhooks/google-calendar/route.ts:POST:exit',message:'Webhook completed',data:{ok:true},timestamp:Date.now()})}).catch(()=>{});
  // #endregion agent log (pre-fix)
  return NextResponse.json({ ok: true });
}
