import { getGoogleAuthorizeUrl } from '@/lib/google';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

function missingGoogleConfig(): string | null {
  if (!process.env.GOOGLE_CLIENT_ID?.trim()) return 'GOOGLE_CLIENT_ID';
  if (!process.env.GOOGLE_REDIRECT_URI?.trim()) return 'GOOGLE_REDIRECT_URI';
  return null;
}

export async function GET(request: NextRequest) {
  const missing = missingGoogleConfig();
  if (missing) {
    const base = new URL('/settings', request.url);
    base.searchParams.set('error', `Google sign-in not configured. Set ${missing} in Vercel Environment Variables.`);
    return NextResponse.redirect(base);
  }
  try {
    const state = crypto.randomUUID();
    const cookieStore = await cookies();
    cookieStore.set('google_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600,
      path: '/',
    });
    const url = getGoogleAuthorizeUrl(state);
    return NextResponse.redirect(url);
  } catch (err) {
    const base = new URL('/settings', request.url);
    base.searchParams.set('error', encodeURIComponent(err instanceof Error ? err.message : 'Google sign-in failed'));
    return NextResponse.redirect(base);
  }
}
