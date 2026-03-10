/**
 * Run the 0001_google_calendar.sql migration against the database.
 * Usage: dotenv -e .env.local -- tsx scripts/run-migration.ts
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
const migrationPath = join(__dirname, '..', 'drizzle', '0001_google_calendar.sql');
const sql = readFileSync(migrationPath, 'utf8');

// Strip single-line comments, then split by semicolon-newline
const noComments = sql.replace(/^--.*$/gm, '').trim();
const chunks = noComments.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);

// Further split any chunk that contains multiple top-level statements (e.g. DROP then CREATE)
const statements: string[] = [];
for (const chunk of chunks) {
  const parts = chunk.split(/\n(?=(?:CREATE|DROP) TABLE)/);
  for (const part of parts) {
    const stmt = part.trim();
    if (stmt.length > 0) statements.push(stmt);
  }
}

async function main() {
  console.log('Running migration: drizzle/0001_google_calendar.sql');
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.slice(0, 55).replace(/\s+/g, ' ');
    console.log(`  [${i + 1}/${statements.length}] ${preview}...`);
    try {
      await pool.query(stmt.endsWith(';') ? stmt : stmt + ';');
    } catch (err) {
      console.error(`Statement failed:\n${stmt.slice(0, 300)}...`);
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
