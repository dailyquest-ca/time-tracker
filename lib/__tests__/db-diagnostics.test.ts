import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@vercel/postgres', () => ({
  createPool: vi.fn().mockReturnValue({}),
  sql: {},
}));

vi.mock('drizzle-orm/vercel-postgres', () => ({
  drizzle: vi.fn().mockReturnValue({}),
}));

describe('getDbTarget', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'test' };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('returns host and database when DATABASE_URL is a valid postgres URL', async () => {
    process.env.DATABASE_URL =
      'postgresql://user:pass@ep-cool-forest-123.us-east-2.aws.neon.tech/mydb?sslmode=require';
    const { getDbTarget } = await import('../db');
    const result = getDbTarget();
    expect(result).toEqual({
      host: 'ep-cool-forest-123.us-east-2.aws.neon.tech',
      database: 'mydb',
    });
  });

  it('returns null when DATABASE_URL is not set', async () => {
    delete process.env.DATABASE_URL;
    const { getDbTarget } = await import('../db');
    expect(getDbTarget()).toBeNull();
  });

  it('returns null when DATABASE_URL is not a valid URL', async () => {
    process.env.DATABASE_URL = 'not-a-url';
    const { getDbTarget } = await import('../db');
    expect(getDbTarget()).toBeNull();
  });
});
