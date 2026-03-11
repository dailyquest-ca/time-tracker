import { createPool, sql } from '@vercel/postgres';
import { drizzle } from 'drizzle-orm/vercel-postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;

if (!connectionString && typeof process !== 'undefined' && process.env.NODE_ENV !== 'test') {
  console.error('[db] DATABASE_URL is not set — database operations will fail.');
}

const client = connectionString
  ? createPool({ connectionString })
  : sql;

export const db = drizzle(client, { schema });

export function getDbTarget(): { host: string; database: string } | null {
  if (!connectionString) return null;
  try {
    const parsed = new URL(connectionString);
    return {
      host: parsed.hostname,
      database: parsed.pathname.replace(/^\//, ''),
    };
  } catch {
    return null;
  }
}
