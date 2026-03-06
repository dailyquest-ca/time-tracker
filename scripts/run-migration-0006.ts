/**
 * Run the 0006_fresh_schema.sql migration (fresh database rebuild).
 * Usage: npm run db:migrate:fresh   OR   dotenv -e .env.local -- tsx scripts/run-migration-0006.ts
 */
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { createPool } from '@vercel/postgres';
import { config } from 'dotenv';

config({ path: resolve(join(__dirname, '..'), '.env.local') });

const connectionString =
  process.env.DATABASE_URL ?? process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('DATABASE_URL or POSTGRES_URL must be set');
  process.exit(1);
}

const pool = createPool({ connectionString });

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
  console.log('Connection string:', connectionString?.slice(0, 30) + '...');

  const raw = readFileSync(
    resolve(join(__dirname, '..'), 'drizzle/0006_fresh_schema.sql'),
    'utf-8',
  );
  const noComments = raw.replace(/--[^\n]*/g, '').trim();
  const statements = splitStatements(noComments);

  console.log('Running fresh schema migration: drizzle/0006_fresh_schema.sql');
  console.log(`Parsed ${statements.length} statements\n`);

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.length > 120 ? stmt.slice(0, 120) + '...' : stmt;
    console.log(`[${i + 1}/${statements.length}] ${preview}`);
    try {
      const result = await pool.query(stmt);
      console.log(`  -> OK (rowCount: ${result.rowCount})`);
    } catch (err) {
      console.error(`  -> FAILED`);
      throw err;
    }
  }

  const tables = await pool.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  );
  console.log(
    '\nTables after migration:',
    tables.rows.map((r: { tablename: string }) => r.tablename).join(', '),
  );

  const catCount = await pool.query('SELECT count(*) FROM categories');
  console.log('Categories:', catCount.rows[0].count);

  const eventCount = await pool.query('SELECT count(*) FROM events');
  console.log('Events:', eventCount.rows[0].count);

  const configCount = await pool.query('SELECT count(*) FROM app_config');
  console.log('App config entries:', configCount.rows[0].count);

  console.log('\nFresh schema migration complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
