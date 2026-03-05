import { getGoogleAuthorizeUrl } from '@/lib/google';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET() {
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
}
