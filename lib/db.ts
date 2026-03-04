import { createPool, sql } from '@vercel/postgres';
import { drizzle } from 'drizzle-orm/vercel-postgres';
import * as schema from './schema';

const connectionString =
  process.env.DATABASE_URL ?? process.env.POSTGRES_URL;

const client = connectionString
  ? createPool({ connectionString })
  : sql;

export const db = drizzle(client, { schema });
