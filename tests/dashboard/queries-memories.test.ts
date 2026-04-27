// tests/dashboard/queries-memories.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { getMemories } from '@/lib/dashboard/queries';

const url = process.env.DATABASE_URL_UNPOOLED;
const suite = url ? describe : describe.skip;

suite('getMemories', () => {
  const sql = postgres(url!, { max: 1, idle_timeout: 2 });
  afterAll(async () => { await sql.end(); });

  it('paginates without filters', async () => {
    const r = await getMemories({}, 0, 5);
    expect(r.rows.length).toBeLessThanOrEqual(5);
    expect(typeof r.total).toBe('number');
  });

  it('respects bucket filter', async () => {
    const r = await getMemories({ bucket: 'short' }, 0, 50);
    r.rows.forEach((row) => expect(row.bucket).toBe('short'));
  });
});
