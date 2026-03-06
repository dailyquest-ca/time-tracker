/**
 * Google Calendar OAuth and API client.
 * Uses the standard Google OAuth 2.0 flow with Calendar read-only scope.
 */

const GOOGLE_AUTH_BASE = 'https://accounts.google.com/o/oauth2';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

export interface GoogleCalendarEvent {
  id: string;
  recurringEventId?: string;
  summary?: string;
  description?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  status?: string;
}

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export function getGoogleAuthorizeUrl(state: string): string {
  const clientId = getEnv('GOOGLE_CLIENT_ID');
  const redirectUri = getEnv('GOOGLE_REDIRECT_URI');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events.readonly',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `${GOOGLE_AUTH_BASE}/auth?${params.toString()}`;
}

export async function exchangeGoogleCode(
  code: string,
  redirectUri: string,
): Promise<GoogleTokens> {
  const body = new URLSearchParams({
    client_id: getEnv('GOOGLE_CLIENT_ID'),
    client_secret: getEnv('GOOGLE_CLIENT_SECRET'),
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token exchange failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<GoogleTokens>;
}

export async function refreshGoogleToken(
  refreshToken: string,
): Promise<GoogleTokens> {
  const body = new URLSearchParams({
    client_id: getEnv('GOOGLE_CLIENT_ID'),
    client_secret: getEnv('GOOGLE_CLIENT_SECRET'),
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token refresh failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<GoogleTokens>;
}

export interface GoogleCalendarListEntry {
  id: string;
  summary?: string;
  primary?: boolean;
}

/**
 * List calendars for the authenticated user (for calendar picker).
 */
export async function listCalendars(
  accessToken: string,
): Promise<GoogleCalendarListEntry[]> {
  const url = `${GOOGLE_CALENDAR_BASE}/users/me/calendarList?minAccessRole=owner&fields=items(id,summary,primary)`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Calendar list: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { items?: GoogleCalendarListEntry[] };
  return data.items ?? [];
}

/**
 * Fetch calendar events in a time window using events.list with timeMin/timeMax.
 * Handles pagination via nextPageToken. Expands recurring events into single instances.
 */
export async function listCalendarEvents(
  accessToken: string,
  calendarId: string,
  options: { timeMin: string; timeMax: string },
): Promise<GoogleCalendarEvent[]> {
  const allEvents: GoogleCalendarEvent[] = [];
  let pageToken: string | undefined;
  const encodedId = encodeURIComponent(calendarId);

  do {
    const params = new URLSearchParams({
      timeMin: options.timeMin,
      timeMax: options.timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
      fields:
        'items(id,recurringEventId,summary,description,start,end,status),nextPageToken',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const url = `${GOOGLE_CALENDAR_BASE}/calendars/${encodedId}/events?${params.toString()}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Google Calendar events.list: ${res.status} ${text}`);
    }
    const data = (await res.json()) as {
      items?: GoogleCalendarEvent[];
      nextPageToken?: string;
    };
    if (data.items) allEvents.push(...data.items);
    pageToken = data.nextPageToken;
  } while (pageToken);

  return allEvents;
}

/**
 * Stop (cancel) an existing push notification channel.
 * Best-effort: does not throw on failure since the channel may already be expired.
 */
export async function stopCalendarWatch(
  accessToken: string,
  channelId: string,
  resourceId: string,
): Promise<void> {
  try {
    await fetch('https://www.googleapis.com/calendar/v3/channels/stop', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: channelId, resourceId }),
    });
  } catch {
    // Best effort — channel may already be expired or invalid
  }
}

export interface WatchChannelResponse {
  id: string;
  resourceId: string;
  resourceUri: string;
  expiration: string; // Unix timestamp in milliseconds
}

/**
 * Create a watch (push notification channel) for a calendar's events.
 * Caller must store id, resourceId, and expiration and renew before expiration.
 */
export async function createCalendarWatch(
  accessToken: string,
  calendarId: string,
  address: string,
  options?: { channelId?: string; ttlSeconds?: number },
): Promise<WatchChannelResponse> {
  const encodedId = encodeURIComponent(calendarId);
  const url = `${GOOGLE_CALENDAR_BASE}/calendars/${encodedId}/events/watch`;
  const body: {
    id: string;
    type: string;
    address: string;
    params?: { ttl: string };
  } = {
    id: options?.channelId ?? crypto.randomUUID(),
    type: 'web_hook',
    address,
  };
  if (options?.ttlSeconds != null) {
    body.params = { ttl: String(options.ttlSeconds) };
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Calendar events.watch: ${res.status} ${text}`);
  }
  const data = (await res.json()) as {
    id: string;
    resourceId: string;
    resourceUri: string;
    expiration: string;
  };
  return {
    id: data.id,
    resourceId: data.resourceId,
    resourceUri: data.resourceUri,
    expiration: data.expiration,
  };
}
