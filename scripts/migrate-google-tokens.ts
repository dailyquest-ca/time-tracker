/**
 * Migration: Add google_tokens table for Google Calendar OAuth.
 *
 * Usage: npx dotenv -e .env.local -- tsx scripts/migrate-google-tokens.ts
 */

import * as dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(__dirname, '../.env.local') });

import { createPool } from '@vercel/postgres';

async function main() {
  const connectionString =
    process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!connectionString) {
    console.error('DATABASE_URL or POSTGRES_URL required');
    process.exit(1);
  }

  const pool = createPool({ connectionString });

  console.log('Starting Google tokens migration...');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS google_tokens (
      user_id TEXT PRIMARY KEY DEFAULT 'default',
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      expires_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  console.log('  [ok] google_tokens table created');

  console.log('Migration complete!');
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
