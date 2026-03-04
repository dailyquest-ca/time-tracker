/**
 * Microsoft Graph client: OAuth and calendar event APIs.
 * Uses the "organizations" tenant by default (work/school accounts).
 */

const MS_AUTHORITY_BASE = 'https://login.microsoftonline.com';
const MS_GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export interface MicrosoftTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface GraphCalendarEvent {
  id: string;
  subject: string;
  isAllDay: boolean;
  isCancelled: boolean;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  categories: string[];
  showAs?: string;
}

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function getTenant(): string {
  return process.env.MICROSOFT_TENANT?.trim() || 'organizations';
}

export function getMicrosoftAuthorizeUrl(state: string): string {
  const clientId = getEnv('MICROSOFT_CLIENT_ID');
  const redirectUri = getEnv('MICROSOFT_REDIRECT_URI');
  const tenant = getTenant();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'offline_access Calendars.Read',
    state,
  });
  return `${MS_AUTHORITY_BASE}/${tenant}/oauth2/v2.0/authorize?${params.toString()}`;
}

export async function exchangeMicrosoftCode(
  code: string,
  redirectUri: string,
): Promise<MicrosoftTokens> {
  const tenant = getTenant();
  const body = new URLSearchParams({
    client_id: getEnv('MICROSOFT_CLIENT_ID'),
    client_secret: getEnv('MICROSOFT_CLIENT_SECRET'),
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    scope: 'offline_access Calendars.Read',
  });
  const res = await fetch(
    `${MS_AUTHORITY_BASE}/${tenant}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Microsoft token exchange failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<MicrosoftTokens>;
}

export async function refreshMicrosoftToken(
  refreshToken: string,
): Promise<MicrosoftTokens> {
  const tenant = getTenant();
  const body = new URLSearchParams({
    client_id: getEnv('MICROSOFT_CLIENT_ID'),
    client_secret: getEnv('MICROSOFT_CLIENT_SECRET'),
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    scope: 'offline_access Calendars.Read',
  });
  const res = await fetch(
    `${MS_AUTHORITY_BASE}/${tenant}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Microsoft token refresh failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<MicrosoftTokens>;
}

/**
 * Delta query for calendar events. On the first call, pass `null` for deltaLink
 * to do a full sync over the given window. On subsequent calls, pass the
 * previously stored deltaLink to get only changes.
 */
export async function getCalendarEventsDelta(
  accessToken: string,
  options: {
    deltaLink?: string | null;
    startDateTime?: string;
    endDateTime?: string;
  },
): Promise<{ events: GraphCalendarEvent[]; nextDeltaLink: string }> {
  const allEvents: GraphCalendarEvent[] = [];
  let url: string;

  if (options.deltaLink) {
    url = options.deltaLink;
  } else {
    const start =
      options.startDateTime ??
      new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const end =
      options.endDateTime ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    url = `${MS_GRAPH_BASE}/me/calendarView/delta?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}&$select=id,subject,isAllDay,isCancelled,start,end,categories,showAs`;
  }

  let deltaLink = '';

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Graph calendarView/delta: ${res.status} ${text}`);
    }
    const data = (await res.json()) as {
      value: GraphCalendarEvent[];
      '@odata.nextLink'?: string;
      '@odata.deltaLink'?: string;
    };
    allEvents.push(...data.value);
    if (data['@odata.nextLink']) {
      url = data['@odata.nextLink'];
    } else {
      deltaLink = data['@odata.deltaLink'] ?? '';
      break;
    }
  }

  return { events: allEvents, nextDeltaLink: deltaLink };
}
