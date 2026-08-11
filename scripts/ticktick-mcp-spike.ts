/**
 * Phase 0 gate: prove a standalone client can talk to TickTick's MCP server
 * headlessly, with no browser and no Claude session.
 *
 * This is the risk the whole TickTick design rests on. Nothing else should be
 * built until Run 2 below passes cold.
 *
 *   Run 1 (interactive)  npx tsx scripts/ticktick-mcp-spike.ts
 *       Registers a client, opens an authorization URL for you to approve, then
 *       calls get_user_preference and reports whether a refresh token was issued.
 *
 *   Run 2 (headless proof)  npx tsx scripts/ticktick-mcp-spike.ts --headless
 *       Fresh process, no browser. Refreshes the access token from disk and
 *       calls filter_tasks for today. In this mode any attempt to open a browser
 *       is a hard failure — that is the point of the test.
 *
 * ACCEPTANCE: Run 2 succeeds cold. If it cannot, STOP and report; do not fall
 * back to TickTick's unofficial api/v2 endpoints without discussing it first.
 *
 * Tokens are written to .ticktick-tokens.json (gitignored). Treat that file as
 * a credential.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MCP_URL = process.env.TICKTICK_MCP_SERVER_URL ?? 'https://mcp.ticktick.com';
const TOKEN_FILE = resolve(__dirname, '../.ticktick-tokens.json');
const CALLBACK_PORT = Number(process.env.TICKTICK_SPIKE_PORT ?? 33418);
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/callback`;
const HEADLESS = process.argv.includes('--headless');

/**
 * The server advertises only `authorization_code` in grant_types_supported, but
 * TickTick's classic OAuth has historically issued refresh tokens anyway. Ask
 * for the refresh grant by default; if registration is rejected as invalid
 * client metadata, re-run with TICKTICK_SPIKE_NO_REFRESH_GRANT=1 to find out
 * whether the server issues one regardless.
 */
const REQUEST_REFRESH_GRANT = process.env.TICKTICK_SPIKE_NO_REFRESH_GRANT !== '1';

interface TokenFile {
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
}

function readStore(): TokenFile {
  if (!existsSync(TOKEN_FILE)) return {};
  try {
    return JSON.parse(readFileSync(TOKEN_FILE, 'utf8')) as TokenFile;
  } catch {
    console.warn(`[spike] ${TOKEN_FILE} is unreadable; starting fresh.`);
    return {};
  }
}

function writeStore(patch: Partial<TokenFile>): void {
  const next = { ...readStore(), ...patch };
  writeFileSync(TOKEN_FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
}

class FileAuthProvider implements OAuthClientProvider {
  /** Set when the provider is asked to send the user to a browser. */
  authorizationUrl: URL | null = null;

  get redirectUrl(): string {
    return REDIRECT_URI;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'time-tracker TickTick sync (spike)',
      redirect_uris: [REDIRECT_URI],
      grant_types: REQUEST_REFRESH_GRANT
        ? ['authorization_code', 'refresh_token']
        : ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_basic',
      scope: 'tasks:read tasks:write',
    };
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return readStore().clientInformation;
  }

  saveClientInformation(info: OAuthClientInformationMixed): void {
    writeStore({ clientInformation: info });
    console.log('[spike] Registered client, id:', (info as { client_id?: string }).client_id);
  }

  tokens(): OAuthTokens | undefined {
    return readStore().tokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    const previous = readStore().tokens;
    writeStore({ tokens });
    const fields = Object.keys(tokens).join(', ');
    console.log(`[spike] Saved tokens — fields present: ${fields}`);
    if (previous?.refresh_token && tokens.refresh_token) {
      console.log(
        previous.refresh_token === tokens.refresh_token
          ? '[spike] Refresh token was REUSED (not rotated).'
          : '[spike] Refresh token was ROTATED — storage must persist the new value.',
      );
    }
  }

  redirectToAuthorization(url: URL): void {
    if (HEADLESS) {
      throw new Error(
        'Headless run required a browser authorization — the refresh path did not work. ' +
          'This is the Phase 0 failure condition.',
      );
    }
    this.authorizationUrl = url;
  }

  saveCodeVerifier(verifier: string): void {
    writeStore({ codeVerifier: verifier });
  }

  codeVerifier(): string {
    const verifier = readStore().codeVerifier;
    if (!verifier) throw new Error('No PKCE code verifier stored.');
    return verifier;
  }
}

/** Wait for the OAuth provider to redirect back to our loopback listener. */
function waitForAuthorizationCode(): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${CALLBACK_PORT}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end('Not found');
        return;
      }
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(code ? 'Authorized. You can close this tab.' : `Authorization failed: ${error}`);
      server.close();
      if (code) resolvePromise(code);
      else rejectPromise(new Error(`Authorization failed: ${error ?? 'no code returned'}`));
    });
    server.listen(CALLBACK_PORT, () => {
      console.log(`[spike] Listening for the OAuth callback on ${REDIRECT_URI}`);
    });
    server.on('error', rejectPromise);
  });
}

function todayRangeVancouver(): { startDate: string; endDate: string } {
  const now = new Date();
  const day = now.toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });
  // TickTick accepts ISO offsets; Vancouver is -07:00 in summer, -08:00 in winter.
  const offsetLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Vancouver',
    timeZoneName: 'longOffset',
  })
    .formatToParts(now)
    .find((p) => p.type === 'timeZoneName')?.value;
  const offset = offsetLabel?.replace('GMT', '') || '-07:00';
  return {
    startDate: `${day}T00:00:00${offset}`,
    endDate: `${day}T23:59:59${offset}`,
  };
}

async function main(): Promise<void> {
  console.log(`[spike] Server: ${MCP_URL}`);
  console.log(`[spike] Mode: ${HEADLESS ? 'HEADLESS (Run 2)' : 'INTERACTIVE (Run 1)'}`);
  if (HEADLESS && !readStore().tokens) {
    throw new Error('No stored tokens — run the interactive pass first.');
  }

  const authProvider = new FileAuthProvider();
  const client = new Client(
    { name: 'time-tracker-spike', version: '0.1.0' },
    { capabilities: {} },
  );
  let transport = new StreamableHTTPClientTransport(new URL(MCP_URL), { authProvider });

  try {
    await client.connect(transport);
    console.log('[spike] Connected using stored credentials — no browser needed.');
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) throw err;

    const url = authProvider.authorizationUrl;
    if (!url) throw new Error('Authorization required but no URL was produced.');

    console.log('\n[spike] Open this URL and approve access:\n');
    console.log(`  ${url.toString()}\n`);

    const code = await waitForAuthorizationCode();
    await transport.finishAuth(code);
    console.log('[spike] Authorization code exchanged.');

    // A transport that failed auth cannot be reused for the live session.
    transport = new StreamableHTTPClientTransport(new URL(MCP_URL), { authProvider });
    await client.connect(transport);
    console.log('[spike] Connected.');
  }

  const tools = await client.listTools();
  console.log(`[spike] Server exposes ${tools.tools.length} tools.`);

  const prefs = await client.callTool({ name: 'get_user_preference', arguments: {} });
  console.log('[spike] get_user_preference →', JSON.stringify(prefs.content));

  if (HEADLESS) {
    const range = todayRangeVancouver();
    console.log(`[spike] filter_tasks for ${range.startDate} .. ${range.endDate}`);
    const tasks = await client.callTool({
      name: 'filter_tasks',
      arguments: { filter: { startDate: range.startDate, endDate: range.endDate } },
    });
    console.log('[spike] filter_tasks →', JSON.stringify(tasks.content));
  }

  const stored = readStore().tokens;
  console.log('\n────────────── Phase 0 result ──────────────');
  console.log(`refresh_token issued : ${stored?.refresh_token ? 'YES' : 'NO'}`);
  console.log(`token expires_in     : ${stored?.expires_in ?? 'not reported'}`);
  if (HEADLESS) {
    console.log('headless run         : PASSED — no browser was required.');
    console.log('\nGate PASSED. Safe to build the sync route.');
  } else {
    console.log('\nNow run the headless proof:');
    console.log('  npx tsx scripts/ticktick-mcp-spike.ts --headless');
  }

  await client.close();
}

main().catch((err) => {
  console.error(`\n[spike] FAILED: ${err instanceof Error ? err.message : err}`);
  console.error('\nGate NOT passed. Report this before building the sync.');
  process.exit(1);
});
