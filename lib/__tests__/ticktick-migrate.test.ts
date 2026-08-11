/**
 * The TickTick schema is applied on the request path, so it must be idempotent,
 * cheap on repeat calls, and must not cache a transient failure.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const execute = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/db', () => ({
  db: {
    execute: (...args: unknown[]) => execute(...args),
  },
}));

async function freshModule() {
  vi.resetModules();
  execute.mockClear();
  execute.mockResolvedValue(undefined);
  return import('@/lib/ticktick-migrate');
}

describe('ensureTickTickSchema', () => {
  beforeEach(() => {
    execute.mockClear();
  });

  it('applies every statement on first call', async () => {
    const { ensureTickTickSchema } = await freshModule();
    await ensureTickTickSchema();
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('does not re-apply on a second call in the same process', async () => {
    const { ensureTickTickSchema } = await freshModule();
    await ensureTickTickSchema();
    await ensureTickTickSchema();
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('applies once when called concurrently', async () => {
    const { ensureTickTickSchema } = await freshModule();
    await Promise.all([
      ensureTickTickSchema(),
      ensureTickTickSchema(),
      ensureTickTickSchema(),
    ]);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('propagates a failure to the caller', async () => {
    const { ensureTickTickSchema } = await freshModule();
    execute.mockRejectedValueOnce(new Error('permission denied'));
    await expect(ensureTickTickSchema()).rejects.toThrow('permission denied');
  });

  it('retries after a failure rather than caching it', async () => {
    const { ensureTickTickSchema } = await freshModule();
    execute.mockRejectedValueOnce(new Error('transient'));
    await expect(ensureTickTickSchema()).rejects.toThrow('transient');

    execute.mockResolvedValue(undefined);
    await expect(ensureTickTickSchema()).resolves.toBeUndefined();
    // 1 failed attempt + 3 statements on the successful retry.
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it('only issues additive, idempotent statements', async () => {
    const { ensureTickTickSchema } = await freshModule();
    await ensureTickTickSchema();
    const issued = execute.mock.calls
      .map(([stmt]) => JSON.stringify(stmt))
      .join(' ');
    // Nothing here may destroy data if it runs against a populated database.
    expect(issued).not.toMatch(/DROP |DELETE |TRUNCATE /i);
    expect(issued).toMatch(/IF NOT EXISTS/i);
  });
});
