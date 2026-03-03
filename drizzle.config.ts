import { defineConfig } from 'drizzle-kit';

const connectionString =
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL ??
  'postgresql://localhost:5432/placeholder';

export default defineConfig({
  schema: './lib/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: connectionString,
  },
});
