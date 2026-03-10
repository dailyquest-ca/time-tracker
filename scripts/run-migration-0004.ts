/**
 * Run the 0004_daily_overtime_notes.sql migration (notes table, migrate from daily_totals, drop note column).
 * Usage: dotenv -e .env.local -- tsx scripts/run-migration-0004.ts
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
const migrationPath = join(__dirname, '..', 'drizzle', '0004_daily_overtime_notes.sql');
const sql = readFileSync(migrationPath, 'utf8');

const noComments = sql.replace(/^--.*$/gm, '').trim();
const statements = noComments
  .split(/;\s*\n/)
  .map((s) => s.trim())
  .filter(Boolean);

async function main() {
  console.log('Running migration: drizzle/0004_daily_overtime_notes.sql');
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.slice(0, 60).replace(/\s+/g, ' ');
    console.log(`  [${i + 1}/${statements.length}] ${preview}...`);
    try {
      await pool.query(stmt.endsWith(';') ? stmt : stmt + ';');
    } catch (err) {
      console.error(`Statement failed:\n${stmt.slice(0, 400)}...`);
      throw err;
    }
  }
  console.log('Migration completed successfully.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
