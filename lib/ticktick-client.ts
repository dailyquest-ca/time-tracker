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
import type { TickTickProject, TickTickTask } from './ticktick';

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

/** A connected TickTick MCP session. Always `close()` when finished. */
export class TickTickClient {
  private constructor(private readonly client: Client) {}

  static async connect(): Promise<TickTickClient> {
    const rows = await db
      .select({ provider: integrationTokens.provider })
      .from(integrationTokens)
      .where(eq(integrationTokens.provider, PROVIDER))
      .limit(1);
    if (rows.length === 0) {
      throw new TickTickNotConnectedError(
        'No TickTick credentials stored. Seed integration_tokens from the spike output.',
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
    return new TickTickClient(client);
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
