/**
 * Run the 0002_daily_note.sql migration (add note column to daily_totals).
 * Usage: dotenv -e .env.local -- tsx scripts/run-migration-0002.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { createPool } from '@vercel/postgres';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('Missing DATABASE_URL in environment.');
  process.exit(1);
}

const pool = createPool({ connectionString });
const migrationPath = join(__dirname, '..', 'drizzle', '0002_daily_note.sql');
const sql = readFileSync(migrationPath, 'utf8').replace(/^--.*$/gm, '').trim();

async function main() {
  console.log('Running migration: drizzle/0002_daily_note.sql');
  await pool.query(sql);
  console.log('Migration completed successfully.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
