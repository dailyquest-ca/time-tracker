/**
 * Migration: Add multi-source support to work_segments.
 * - Creates microsoft_tokens table
 * - Adds external_id column to work_segments (populated from ticktick_task_id)
 * - Adds microsoft_delta_link column to sync_state
 * - Makes source NOT NULL
 * - Changes unique constraint from (ticktick_task_id, date) to (source, external_id, date)
 * - Makes ticktick_task_id nullable
 *
 * Usage: npx dotenv -e .env.local -- tsx scripts/migrate-multi-source.ts
 */

import * as dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(__dirname, '../.env.local') });

import { createPool } from '@vercel/postgres';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL required');
    process.exit(1);
  }

  const pool = createPool({ connectionString });

  console.log('Starting multi-source migration...');

  // 1. Create microsoft_tokens table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS microsoft_tokens (
      user_id TEXT PRIMARY KEY DEFAULT 'default',
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      expires_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  console.log('  [ok] microsoft_tokens table');

  // 2. Add microsoft_delta_link to sync_state
  const deltaColCheck = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'sync_state' AND column_name = 'microsoft_delta_link';
  `);
  if (deltaColCheck.rows.length === 0) {
    await pool.query(`ALTER TABLE sync_state ADD COLUMN microsoft_delta_link TEXT;`);
    console.log('  [ok] sync_state.microsoft_delta_link added');
  } else {
    console.log('  [skip] sync_state.microsoft_delta_link already exists');
  }

  // 3. Add external_id column to work_segments (if missing)
  const extIdCheck = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'work_segments' AND column_name = 'external_id';
  `);
  if (extIdCheck.rows.length === 0) {
    await pool.query(`ALTER TABLE work_segments ADD COLUMN external_id TEXT;`);
    console.log('  [ok] work_segments.external_id column added');

    // Populate from ticktick_task_id
    const result = await pool.query(`
      UPDATE work_segments SET external_id = ticktick_task_id WHERE external_id IS NULL;
    `);
    console.log(`  [ok] Populated external_id for ${result.rowCount} rows`);

    // Make NOT NULL
    await pool.query(`ALTER TABLE work_segments ALTER COLUMN external_id SET NOT NULL;`);
    console.log('  [ok] external_id set to NOT NULL');
  } else {
    console.log('  [skip] work_segments.external_id already exists');
  }

  // 4. Make source NOT NULL with default
  await pool.query(`UPDATE work_segments SET source = 'ticktick' WHERE source IS NULL;`);
  await pool.query(`ALTER TABLE work_segments ALTER COLUMN source SET NOT NULL;`);
  await pool.query(`ALTER TABLE work_segments ALTER COLUMN source SET DEFAULT 'ticktick';`);
  console.log('  [ok] source set NOT NULL with default');

  // 5. Make ticktick_task_id nullable
  await pool.query(`ALTER TABLE work_segments ALTER COLUMN ticktick_task_id DROP NOT NULL;`);
  console.log('  [ok] ticktick_task_id is now nullable');

  // 6. Drop old unique constraint and add new one
  // Find the old constraint name
  const oldConstraint = await pool.query(`
    SELECT constraint_name FROM information_schema.table_constraints
    WHERE table_name = 'work_segments'
      AND constraint_type = 'UNIQUE'
      AND constraint_name NOT LIKE '%source_external_id_date%';
  `);
  for (const row of oldConstraint.rows) {
    await pool.query(`ALTER TABLE work_segments DROP CONSTRAINT "${row.constraint_name}";`);
    console.log(`  [ok] Dropped old constraint: ${row.constraint_name}`);
  }

  // Add new composite unique constraint
  const newConstraint = await pool.query(`
    SELECT constraint_name FROM information_schema.table_constraints
    WHERE table_name = 'work_segments'
      AND constraint_type = 'UNIQUE'
      AND constraint_name LIKE '%source_external_id_date%';
  `);
  if (newConstraint.rows.length === 0) {
    await pool.query(`
      ALTER TABLE work_segments
      ADD CONSTRAINT work_segments_source_external_id_date_unique
      UNIQUE (source, external_id, date);
    `);
    console.log('  [ok] New unique constraint (source, external_id, date) added');
  } else {
    console.log('  [skip] New unique constraint already exists');
  }

  console.log('Migration complete!');
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
