import { getMicrosoftAuthorizeUrl } from '@/lib/microsoft';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET() {
  const state = crypto.randomUUID();
  const cookieStore = await cookies();
  cookieStore.set('ms_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });
  const url = getMicrosoftAuthorizeUrl(state);
  return NextResponse.redirect(url);
}
