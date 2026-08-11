/**
 * Copy the credentials produced by the Phase 0 spike into `integration_tokens`,
 * so the deployed sync route can authenticate.
 *
 * Usage: npm run ticktick:seed
 *
 * Reads .ticktick-tokens.json (written by scripts/ticktick-mcp-spike.ts) and
 * upserts the 'ticktick' row. Re-running is safe. The local file stays the
 * source for re-seeding after a re-auth; it is gitignored and holds a live
 * credential.
 */
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { createPool } from '@vercel/postgres';
import { config } from 'dotenv';

config({ path: resolve(join(__dirname, '..'), '.env.local') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL must be set');
  process.exit(1);
}

const TOKEN_FILE = join(__dirname, '..', '.ticktick-tokens.json');

interface TokenFile {
  clientInformation?: { client_id?: string; client_secret?: string };
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    token_type?: string;
    scope?: string;
    expires_in?: number;
  };
}

async function main(): Promise<void> {
  if (!existsSync(TOKEN_FILE)) {
    console.error(
      `No ${TOKEN_FILE}.\nRun the spike first:\n  npm run ticktick:spike\n  npm run ticktick:spike -- --headless`,
    );
    process.exit(1);
  }

  const store = JSON.parse(readFileSync(TOKEN_FILE, 'utf8')) as TokenFile;
  const accessToken = store.tokens?.access_token;
  if (!accessToken) {
    console.error('Token file has no access_token — re-run the spike.');
    process.exit(1);
  }
  if (!store.tokens?.refresh_token) {
    console.warn(
      'WARNING: no refresh_token stored. The sync will work only until the access token expires.',
    );
  }

  const expiresAt =
    typeof store.tokens?.expires_in === 'number'
      ? new Date(Date.now() + store.tokens.expires_in * 1000)
      : null;

  const pool = createPool({ connectionString });
  await pool.query(
    `INSERT INTO integration_tokens
       (provider, access_token, refresh_token, expires_at, token_type, scope, client_id, client_secret, updated_at)
     VALUES ('ticktick', $1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (provider) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = COALESCE(EXCLUDED.refresh_token, integration_tokens.refresh_token),
       expires_at = EXCLUDED.expires_at,
       token_type = EXCLUDED.token_type,
       scope = EXCLUDED.scope,
       client_id = COALESCE(EXCLUDED.client_id, integration_tokens.client_id),
       client_secret = COALESCE(EXCLUDED.client_secret, integration_tokens.client_secret),
       updated_at = NOW();`,
    [
      accessToken,
      store.tokens?.refresh_token ?? null,
      expiresAt,
      store.tokens?.token_type ?? 'Bearer',
      store.tokens?.scope ?? null,
      store.clientInformation?.client_id ?? null,
      store.clientInformation?.client_secret ?? null,
    ],
  );

  console.log('Seeded integration_tokens for provider "ticktick".');
  console.log(`  refresh_token : ${store.tokens?.refresh_token ? 'stored' : 'ABSENT'}`);
  console.log(`  expires_at    : ${expiresAt?.toISOString() ?? 'not reported'}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Seeding failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
