/**
 * Run the 0003_events_and_slim_daily.sql migration (events table, slim daily_totals, drop work_segments).
 * Usage: npm run db:migrate:events   OR   dotenv -e .env.local -- tsx scripts/run-migration-0003.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { resolve } from 'path';
import { createPool } from '@vercel/postgres';

// Load .env.local from project root so env is set even if run without dotenv-cli
import { config } from 'dotenv';
config({ path: resolve(join(__dirname, '..'), '.env.local') });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('Missing DATABASE_URL in environment.');
  console.error('Cwd:', process.cwd(), '| Checked .env.local at:', resolve(join(__dirname, '..'), '.env.local'));
  process.exit(1);
}

// Debug: which DB we're connecting to (no password)
const url = new URL(connectionString.replace(/^postgresql:\/\//, 'https://'));
console.log('DB host:', url.hostname, '| database:', url.pathname.replace(/^\//, '') || 'neondb');

const pool = createPool({ connectionString });
const migrationPath = join(__dirname, '..', 'drizzle', '0003_events_and_slim_daily.sql');
const sql = readFileSync(migrationPath, 'utf8');

const noComments = sql.replace(/^--.*$/gm, '').trim();

/** Split SQL into statements, keeping DO $$ ... END $$; blocks as single statements. */
function splitStatements(raw: string): string[] {
  const statements: string[] = [];
  let rest = raw.trim();
  while (rest.length > 0) {
    const doMatch = rest.match(/^\s*DO\s+\$\$/i);
    if (doMatch) {
      const endBlock = rest.indexOf('END $$;', doMatch.index! + doMatch[0].length);
      if (endBlock === -1) {
        throw new Error('DO block has no matching END $$;');
      }
      const block = rest.slice(0, endBlock + 'END $$;'.length).trim();
      statements.push(block);
      rest = rest.slice(endBlock + 'END $$;'.length).replace(/^\s*\n?/, '').trim();
      continue;
    }
    const semi = rest.search(/;\s*\n/);
    if (semi === -1) {
      if (rest.trim().length > 0) {
        const s = rest.trim();
        statements.push(s.endsWith(';') ? s : s + ';');
      }
      break;
    }
    statements.push(rest.slice(0, semi + 1).trim());
    rest = rest.slice(semi + 1).replace(/^\s*\n?/, '').trim();
  }
  return statements.filter((s) => s.length > 0 && s !== ';');
}

async function main() {
  // Verify we're actually connected to the right DB
  try {
    const connCheck = await pool.query('SELECT current_database() as db');
    console.log('Connected to database:', (connCheck as { rows?: { db: string }[] }).rows?.[0]?.db ?? '?');
    const tablesCheck = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('events', 'work_segments') ORDER BY table_name"
    );
    const tables = (tablesCheck as { rows?: { table_name: string }[] }).rows ?? [];
    console.log('Existing tables (before):', tables.map((r) => r.table_name).join(', ') || 'none');
    if (tables.some((t) => t.table_name === 'events')) {
      const count = await pool.query('SELECT count(*)::int as n FROM events');
      console.log('Events row count (before):', (count as { rows?: { n: number }[] }).rows?.[0]?.n ?? '?');
    }
  } catch (e) {
    console.error('Connection check failed:', e);
    throw e;
  }

  const statements = splitStatements(noComments);
  console.log('\nRunning migration: drizzle/0003_events_and_slim_daily.sql');
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.slice(0, 70).replace(/\s+/g, ' ');
    console.log(`  [${i + 1}/${statements.length}] ${preview}${stmt.length > 70 ? '...' : ''}`);
    try {
      const result = await pool.query(stmt);
      if (result && typeof (result as { rowCount?: number }).rowCount === 'number') {
        const rc = (result as { rowCount?: number }).rowCount;
        if (rc != null && rc > 0) console.log(`      -> ${rc} row(s) affected`);
      }
    } catch (err) {
      console.error(`Statement failed (${i + 1}/${statements.length}).`);
      throw err;
    }
  }

  // Verify migration actually wrote to the DB
  const afterCount = await pool.query('SELECT count(*)::int as n FROM events');
  const n = (afterCount as { rows?: { n: number }[] }).rows?.[0]?.n ?? 0;
  console.log('\nEvents row count (after):', n);
  if (n > 0) {
    const sample = await pool.query('SELECT date, name, length_hours FROM events ORDER BY date LIMIT 5');
    console.log('Sample rows:', (sample as { rows?: { date: string; name: string; length_hours: number }[] }).rows ?? []);
  }
  console.log('Migration completed successfully.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
