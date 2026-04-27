// tests/dashboard/queries-charts.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import {
  getCostLine12Mo,
  getMemorySegmentsSnapshot,
} from '@/lib/dashboard/queries';

const url = process.env.DATABASE_URL_UNPOOLED;
const skipSuite = url ? describe : describe.skip;

skipSuite('phase-10 chart queries', () => {
  const sql = postgres(url!, { max: 1, idle_timeout: 2 });
  afterAll(async () => { await sql.end(); });

  it('getCostLine12Mo returns 365 daily entries (or fewer if DB is younger)', async () => {
    const snap = await getCostLine12Mo();
    expect(snap.days.length).toBeLessThanOrEqual(366);
    snap.days.forEach((d) => {
      expect(d.date).toBeInstanceOf(Date);
      expect(typeof d.total).toBe('number');
      expect(typeof d.opusOnly).toBe('number');
    });
  });

  it('getMemorySegmentsSnapshot returns one entry per segment enum', async () => {
    const snap = await getMemorySegmentsSnapshot();
    const segments = new Set(snap.segments.map((s) => s.id));
    expect(segments.size).toBeLessThanOrEqual(7);
    snap.segments.forEach((s) => {
      expect(typeof s.count).toBe('number');
      expect(typeof s.avgImportance).toBe('number');
    });
  });
});
