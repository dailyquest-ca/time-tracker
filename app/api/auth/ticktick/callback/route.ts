import { db } from '@/lib/db';
import { ticktickTokens } from '@/lib/schema';
import { exchangeCodeForTokens } from '@/lib/ticktick';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const USER_ID = 'default';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(
      new URL(`/settings?error=${encodeURIComponent(error)}`, request.url)
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      new URL('/settings?error=missing_code_or_state', request.url)
    );
  }

  const cookieStore = await cookies();
  const savedState = cookieStore.get('ticktick_oauth_state')?.value;
  cookieStore.delete('ticktick_oauth_state');

  // #region agent log
  const hasSavedState = !!savedState;
  const stateMatch = state === savedState;
  const logPayload = {
    sessionId: 'bc99b6',
    location: 'app/api/auth/ticktick/callback/route.ts:GET',
    message: 'OAuth callback: state check',
    data: {
      stateFromUrlPrefix: state.slice(0, 8),
      stateFromUrlLen: state.length,
      savedStatePrefix: savedState?.slice(0, 8) ?? null,
      savedStateLen: savedState?.length ?? 0,
      hasSavedState,
      stateMatch,
      urlHost: request.nextUrl.host,
    },
    hypothesisId: 'H2',
    timestamp: Date.now(),
  };
  fetch('http://127.0.0.1:7719/ingest/e3960d2d-b42f-45cd-97c1-02ec42cc4fbe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'bc99b6' }, body: JSON.stringify(logPayload) }).catch(() => {});
  // #endregion

  if (!savedState || state !== savedState) {
    return NextResponse.redirect(
      new URL('/settings?error=invalid_state', request.url)
    );
  }

  const redirectUri = process.env.TICKTICK_REDIRECT_URI;
  if (!redirectUri) {
    return NextResponse.redirect(
      new URL('/settings?error=redirect_uri_not_configured', request.url)
    );
  }

  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    const expiresAt = new Date(
      Date.now() + (tokens.expires_in || 3600) * 1000
    );
    await db
      .insert(ticktickTokens)
      .values({
        userId: USER_ID,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        expiresAt,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: ticktickTokens.userId,
        set: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || null,
          expiresAt,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.redirect(
      new URL(`/settings?error=${encodeURIComponent(message)}`, request.url)
    );
  }

  return NextResponse.redirect(new URL('/dashboard', request.url));
}
