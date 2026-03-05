import { db } from '@/lib/db';
import { googleTokens } from '@/lib/schema';
import { exchangeGoogleCode } from '@/lib/google';
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
      new URL(`/settings?error=${encodeURIComponent(error)}`, request.url),
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      new URL('/settings?error=missing_code_or_state', request.url),
    );
  }

  const cookieStore = await cookies();
  const savedState = cookieStore.get('google_oauth_state')?.value;
  cookieStore.delete('google_oauth_state');

  if (!savedState || state !== savedState) {
    return NextResponse.redirect(
      new URL('/settings?error=invalid_state', request.url),
    );
  }

  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (!redirectUri) {
    return NextResponse.redirect(
      new URL('/settings?error=' + encodeURIComponent('GOOGLE_REDIRECT_URI not set in environment.'), request.url),
    );
  }
  if (!process.env.GOOGLE_CLIENT_ID?.trim() || !process.env.GOOGLE_CLIENT_SECRET?.trim()) {
    return NextResponse.redirect(
      new URL('/settings?error=' + encodeURIComponent('Google OAuth not fully configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.'), request.url),
    );
  }

  try {
    const tokens = await exchangeGoogleCode(code, redirectUri);
    const expiresAt = new Date(
      Date.now() + (tokens.expires_in || 3600) * 1000,
    );
    await db
      .insert(googleTokens)
      .values({
        userId: USER_ID,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        expiresAt,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: googleTokens.userId,
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
      new URL(`/settings?error=${encodeURIComponent(message)}`, request.url),
    );
  }

  return NextResponse.redirect(new URL('/settings', request.url));
}
