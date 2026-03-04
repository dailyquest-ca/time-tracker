import { db } from '@/lib/db';
import { microsoftTokens } from '@/lib/schema';
import { exchangeMicrosoftCode } from '@/lib/microsoft';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const USER_ID = 'default';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');
  const errorDesc = searchParams.get('error_description');

  if (error) {
    const msg = errorDesc
      ? `${error}: ${errorDesc}`
      : error;
    return NextResponse.redirect(
      new URL(`/settings?error=${encodeURIComponent(msg)}`, request.url),
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      new URL('/settings?error=missing_code_or_state', request.url),
    );
  }

  const cookieStore = await cookies();
  const savedState = cookieStore.get('ms_oauth_state')?.value;
  cookieStore.delete('ms_oauth_state');

  if (!savedState || state !== savedState) {
    return NextResponse.redirect(
      new URL('/settings?error=invalid_state', request.url),
    );
  }

  const redirectUri = process.env.MICROSOFT_REDIRECT_URI;
  if (!redirectUri) {
    return NextResponse.redirect(
      new URL('/settings?error=redirect_uri_not_configured', request.url),
    );
  }

  try {
    const tokens = await exchangeMicrosoftCode(code, redirectUri);
    const expiresAt = new Date(
      Date.now() + (tokens.expires_in || 3600) * 1000,
    );
    await db
      .insert(microsoftTokens)
      .values({
        userId: USER_ID,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        expiresAt,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: microsoftTokens.userId,
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

  return NextResponse.redirect(new URL('/settings?ms_connected=1', request.url));
}
