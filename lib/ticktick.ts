/**
 * TickTick Open API v1 client: OAuth and task/project APIs.
 * Base: https://api.ticktick.com/open/v1
 * OAuth: https://ticktick.com/oauth/authorize, https://ticktick.com/oauth/token
 */

const TICKTICK_OAUTH_AUTHORIZE = 'https://ticktick.com/oauth/authorize';
const TICKTICK_OAUTH_TOKEN = 'https://ticktick.com/oauth/token';
const TICKTICK_API_BASE = 'https://api.ticktick.com/open/v1';

export interface TickTickTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface TickTickProject {
  id: string;
  name: string;
  color?: string;
  closed?: boolean;
}

export interface TickTickTask {
  id: string;
  title: string;
  status: number; // 0 = normal, 1 = completed
  projectId: string;
  startDate?: string; // ISO
  dueDate?: string;
  completedTime?: string;
  modifiedTime?: string;
  tags?: string[];
  content?: string;
}

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export function getAuthorizeUrl(state: string): string {
  const clientId = getEnv('TICKTICK_CLIENT_ID');
  const redirectUri = process.env.TICKTICK_REDIRECT_URI?.trim() ?? '';
  if (!redirectUri) {
    throw new Error(
      'Missing TICKTICK_REDIRECT_URI. Set it in .env.local (e.g. http://localhost:3000/api/auth/ticktick/callback for local, or your Vercel URL for production) and add the same URL in the TickTick developer portal.'
    );
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'tasks:read tasks:write',
    state,
  });
  return `${TICKTICK_OAUTH_AUTHORIZE}?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<TickTickTokens> {
  const clientId = getEnv('TICKTICK_CLIENT_ID');
  const clientSecret = getEnv('TICKTICK_CLIENT_SECRET');
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const res = await fetch(TICKTICK_OAUTH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TickTick token exchange failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as TickTickTokens & { expires_in?: number };
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? '',
    expires_in: data.expires_in ?? 0,
  };
}

export async function refreshAccessToken(
  refreshToken: string
): Promise<TickTickTokens> {
  const clientId = getEnv('TICKTICK_CLIENT_ID');
  const clientSecret = getEnv('TICKTICK_CLIENT_SECRET');
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const res = await fetch(TICKTICK_OAUTH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TickTick refresh failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as TickTickTokens & { expires_in?: number };
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in ?? 0,
  };
}

async function apiGet<T>(
  accessToken: string,
  path: string,
  params?: Record<string, string>
): Promise<T> {
  const url = new URL(TICKTICK_API_BASE + path);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TickTick API ${path}: ${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function getProjects(accessToken: string): Promise<TickTickProject[]> {
  const data = await apiGet<unknown>(accessToken, '/project');
  if (Array.isArray(data)) return data as TickTickProject[];
  const obj = data as { project?: TickTickProject[] };
  return Array.isArray(obj.project) ? obj.project : [];
}

/**
 * Fetch tasks. API returns all tasks; we filter by modifiedTime if provided.
 */
export async function getTasks(
  accessToken: string,
  options?: { modifiedSince?: Date }
): Promise<TickTickTask[]> {
  const data = await apiGet<unknown>(accessToken, '/task');
  let tasks: TickTickTask[] = Array.isArray(data) ? (data as TickTickTask[]) : [];
  if (!Array.isArray(data) && typeof data === 'object' && data !== null && 'tasks' in data) {
    const arr = (data as { tasks?: TickTickTask[] }).tasks;
    tasks = Array.isArray(arr) ? arr : [];
  }
  if (options?.modifiedSince) {
    const since = options.modifiedSince.getTime();
    tasks = tasks.filter((t) => {
      const mt = t.modifiedTime ? new Date(t.modifiedTime).getTime() : 0;
      return mt >= since;
    });
  }
  return tasks;
}

/** Task is completed and has both start and end time for duration. */
export function isCompletedTaskWithDuration(task: TickTickTask): boolean {
  return (
    task.status === 1 &&
    !!task.startDate &&
    !!task.dueDate
  );
}

/** Duration in minutes from startDate to dueDate. */
export function taskDurationMinutes(task: TickTickTask): number {
  if (!task.startDate || !task.dueDate) return 0;
  const start = new Date(task.startDate).getTime();
  const end = new Date(task.dueDate).getTime();
  return Math.round((end - start) / 60_000);
}

/** Calendar date (YYYY-MM-DD) in UTC for the task's start. */
export function taskDateKey(task: TickTickTask): string {
  const d = task.startDate ? new Date(task.startDate) : new Date();
  return d.toISOString().slice(0, 10);
}
