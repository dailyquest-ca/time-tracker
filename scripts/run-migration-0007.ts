/**
 * Run the 0007_ticktick_integration.sql migration.
 * Usage: npm run db:migrate:ticktick
 *        OR  dotenv -e .env.local -- tsx scripts/run-migration-0007.ts
 *
 * Additive and idempotent — creates integration_tokens, adds events.source_etag,
 * and indexes (source_type, date). Safe to re-run.
 */
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { createPool } from '@vercel/postgres';
import { config } from 'dotenv';

config({ path: resolve(join(__dirname, '..'), '.env.local') });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL must be set');
  process.exit(1);
}

const pool = createPool({ connectionString });

async function main(): Promise<void> {
  const sqlPath = join(__dirname, '..', 'drizzle', '0007_ticktick_integration.sql');
  const raw = readFileSync(sqlPath, 'utf8');

  const statements = raw
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.split('\n').every((l) => l.trim().startsWith('--')));

  console.log(`Applying ${statements.length} statement(s) from 0007_ticktick_integration.sql`);

  for (const statement of statements) {
    const label = statement.replace(/\s+/g, ' ').slice(0, 70);
    await pool.query(statement);
    console.log(`  [ok] ${label}...`);
  }

  console.log('Migration 0007 complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
