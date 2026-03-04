import { getAuthorizeUrl } from '@/lib/ticktick';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET() {
  const state = crypto.randomUUID();
  const cookieStore = await cookies();
  cookieStore.set('ticktick_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });
  // #region agent log
  fetch('http://127.0.0.1:7719/ingest/e3960d2d-b42f-45cd-97c1-02ec42cc4fbe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'bc99b6' }, body: JSON.stringify({ sessionId: 'bc99b6', location: 'app/api/auth/ticktick/route.ts:GET', message: 'OAuth start: state set', data: { statePrefix: state.slice(0, 8), stateLen: state.length, secure: process.env.NODE_ENV === 'production' }, hypothesisId: 'H1', timestamp: Date.now() }) }).catch(() => {});
  // #endregion
  const url = getAuthorizeUrl(state);
  return NextResponse.redirect(url);
}
