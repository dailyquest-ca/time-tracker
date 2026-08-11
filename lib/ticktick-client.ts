/**
 * Programmatic MCP client for TickTick's official server.
 *
 * JSON-RPC 2.0 over Streamable HTTP — no LLM is involved. Credentials come from
 * the `integration_tokens` table rather than a file, because Vercel functions
 * have no persistent disk and refresh tokens may rotate.
 *
 * This runs server-side only and can never do interactive authorization. If the
 * stored refresh token stops working, the client fails loudly and the fix is to
 * re-run `npm run ticktick:spike` locally and re-seed the table — see
 * docs/TICKTICK_POLLING.md.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { integrationTokens } from './schema';
import {
  tokenExpiryStatus,
  type TickTickProject,
  type TickTickTask,
  type TokenExpiry,
} from './ticktick';

const PROVIDER = 'ticktick';
const DEFAULT_MCP_URL = 'https://mcp.ticktick.com';

export class TickTickNotConnectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TickTickNotConnectedError';
  }
}

function mcpUrl(): string {
  return process.env.TICKTICK_MCP_SERVER_URL?.trim() || DEFAULT_MCP_URL;
}

/**
 * An access token supplied directly as an env var, bypassing the database.
 *
 * TickTick issues no refresh token, so this token never rotates — which is the
 * only reason an env var is a legitimate home for it. If TickTick ever starts
 * issuing refresh tokens, move back to the table: env vars cannot be written at
 * runtime, so a rotated token would be lost.
 */
export function envAccessToken(): string | null {
  return process.env.TICKTICK_ACCESS_TOKEN?.trim() || null;
}

/**
 * Optional companion to TICKTICK_ACCESS_TOKEN, so expiry warnings still work.
 * Without it expiry is 'unknown' and the sync cannot warn before the token dies.
 */
function envTokenExpiresAt(): string | null {
  return process.env.TICKTICK_TOKEN_EXPIRES_AT?.trim() || null;
}

/**
 * OAuth provider backed by `integration_tokens`. Read-mostly: the only write is
 * persisting refreshed (possibly rotated) tokens.
 */
class DbAuthProvider implements OAuthClientProvider {
  /** Server-side flows never redirect a user agent. */
  get redirectUrl(): string | undefined {
    return undefined;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'time-tracker TickTick sync',
      redirect_uris: [],
      grant_types: ['refresh_token'],
      response_types: ['code'],
      scope: 'tasks:read tasks:write',
    };
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const row = await this.row();
    if (!row?.clientId) return undefined;
    return {
      client_id: row.clientId,
      ...(row.clientSecret ? { client_secret: row.clientSecret } : {}),
    } as OAuthClientInformationMixed;
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const fromEnv = envAccessToken();
    if (fromEnv) {
      return { access_token: fromEnv, token_type: 'Bearer' } as OAuthTokens;
    }
    const row = await this.row();
    if (!row) return undefined;
    return {
      access_token: row.accessToken,
      token_type: row.tokenType ?? 'Bearer',
      ...(row.refreshToken ? { refresh_token: row.refreshToken } : {}),
      ...(row.scope ? { scope: row.scope } : {}),
    } as OAuthTokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    if (envAccessToken()) {
      // Env vars cannot be written at runtime. Harmless while TickTick issues no
      // refresh token; if that changes, the env-var path must be abandoned.
      console.warn(
        '[ticktick] Ignoring refreshed tokens: TICKTICK_ACCESS_TOKEN is set, which cannot be updated at runtime.',
      );
      return;
    }

    const expiresAt =
      typeof tokens.expires_in === 'number'
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : null;

    await db
      .update(integrationTokens)
      .set({
        accessToken: tokens.access_token,
        // Keep the existing refresh token when the server does not rotate it.
        ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
        tokenType: tokens.token_type ?? 'Bearer',
        scope: tokens.scope ?? null,
        expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(integrationTokens.provider, PROVIDER));
  }

  redirectToAuthorization(): never {
    throw new TickTickNotConnectedError(
      'TickTick authorization expired and cannot be renewed without a browser. ' +
        'Re-run the spike locally and re-seed integration_tokens.',
    );
  }

  saveCodeVerifier(): void {
    // Unreachable: this client never starts an authorization-code flow.
    throw new TickTickNotConnectedError('Interactive authorization is not available server-side.');
  }

  codeVerifier(): never {
    throw new TickTickNotConnectedError('Interactive authorization is not available server-side.');
  }

  private async row() {
    const rows = await db
      .select()
      .from(integrationTokens)
      .where(eq(integrationTokens.provider, PROVIDER))
      .limit(1);
    return rows[0] ?? null;
  }
}

/** Parse an MCP tool result into JSON. Tools return their payload as text content. */
function parseToolResult<T>(result: unknown): T {
  const content = (result as { content?: Array<{ type: string; text?: string }> })?.content;
  const text = content?.find((c) => c.type === 'text')?.text;
  if (!text) return [] as unknown as T;
  const parsed = JSON.parse(text) as { result?: T } | T;
  // The TickTick server wraps payloads in { result: ... } for most tools.
  if (parsed && typeof parsed === 'object' && 'result' in (parsed as object)) {
    return (parsed as { result: T }).result;
  }
  return parsed as T;
}

const REAUTH_HINT =
  'Re-authorize locally: npm run ticktick:spike && npm run ticktick:seed';

/** A connected TickTick MCP session. Always `close()` when finished. */
export class TickTickClient {
  private constructor(
    private readonly client: Client,
    /** Life left on the stored access token at connect time. */
    readonly tokenExpiry: TokenExpiry,
  ) {}

  static async connect(): Promise<TickTickClient> {
    // An env-var token skips the table entirely, so a deployment can run with no
    // database seeding step at all.
    const fromEnv = envAccessToken();
    let storedExpiry: Date | string | null = null;

    if (fromEnv) {
      storedExpiry = envTokenExpiresAt();
      if (!storedExpiry) {
        console.warn(
          '[ticktick] TICKTICK_ACCESS_TOKEN is set without TICKTICK_TOKEN_EXPIRES_AT — ' +
            'expiry cannot be tracked, so the sync will stop without warning when the token dies.',
        );
      }
    } else {
      const rows = await db
        .select()
        .from(integrationTokens)
        .where(eq(integrationTokens.provider, PROVIDER))
        .limit(1);
      if (rows.length === 0) {
        throw new TickTickNotConnectedError(
          `No TickTick credentials stored and TICKTICK_ACCESS_TOKEN is not set. ${REAUTH_HINT}`,
        );
      }
      storedExpiry = rows[0].expiresAt;
    }

    // TickTick issues no refresh token, so an expired access token cannot be
    // renewed here. Say so plainly rather than surfacing an opaque 401.
    const expiry = tokenExpiryStatus(storedExpiry, new Date());
    if (expiry.state === 'expired') {
      throw new TickTickNotConnectedError(
        `TickTick access token expired ${Math.abs(expiry.daysRemaining ?? 0)} day(s) ago ` +
          `and cannot be refreshed automatically. ${REAUTH_HINT}`,
      );
    }
    if (expiry.state === 'expiring_soon') {
      console.warn(
        `[ticktick] Access token expires in ${expiry.daysRemaining} day(s) and has no refresh token. ${REAUTH_HINT}`,
      );
    }

    const client = new Client(
      { name: 'time-tracker', version: '1.0.0' },
      { capabilities: {} },
    );
    const transport = new StreamableHTTPClientTransport(new URL(mcpUrl()), {
      authProvider: new DbAuthProvider(),
    });
    await client.connect(transport);
    return new TickTickClient(client, expiry);
  }

  async listProjects(): Promise<TickTickProject[]> {
    const result = await this.client.callTool({ name: 'list_projects', arguments: {} });
    return parseToolResult<TickTickProject[]>(result) ?? [];
  }

  /**
   * Tasks in the given lists overlapping [startDate, endDate].
   *
   * `status` accepts 0 (active) and 2 (completed). Combining them in one call is
   * schema-legal but unverified against the live server, so a rejected combined
   * call falls back to one request per status.
   */
  async filterTasks(args: {
    projectIds: string[];
    startDate: string;
    endDate: string;
  }): Promise<TickTickTask[]> {
    const base = {
      projectIds: args.projectIds,
      startDate: args.startDate,
      endDate: args.endDate,
    };

    try {
      const result = await this.client.callTool({
        name: 'filter_tasks',
        arguments: { filter: { ...base, status: [0, 2] } },
      });
      return parseToolResult<TickTickTask[]>(result) ?? [];
    } catch (err) {
      console.warn(
        `[ticktick] Combined status filter failed, falling back to separate calls: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }

    const byStatus: TickTickTask[] = [];
    for (const status of [0, 2]) {
      const result = await this.client.callTool({
        name: 'filter_tasks',
        arguments: { filter: { ...base, status: [status] } },
      });
      byStatus.push(...(parseToolResult<TickTickTask[]>(result) ?? []));
    }
    return byStatus;
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
