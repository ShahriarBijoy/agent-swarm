import Link from 'next/link';
import { getMemories, type MemoriesFilter } from '@/lib/dashboard/queries';

export const dynamic = 'force-dynamic';

const SEGMENTS = ['identity', 'correction', 'preference', 'relationship', 'knowledge', 'behavioral', 'context'] as const;
const BUCKETS = ['short', 'long', 'permanent'] as const;

type Bucket = (typeof BUCKETS)[number];

export default async function MemoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ bucket?: string; segment?: string; touched?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const filter: MemoriesFilter = {
    bucket: (BUCKETS as readonly string[]).includes(sp.bucket ?? '') ? (sp.bucket as Bucket) : undefined,
    segment: (SEGMENTS as readonly string[]).includes(sp.segment ?? '') ? sp.segment : undefined,
    cleanupTouched: sp.touched === '1',
  };
  const page = Math.max(0, Number(sp.page ?? 0));
  const result = await getMemories(filter, page, 100);

  function pillHref(updates: Record<string, string | undefined>) {
    const next: Record<string, string | undefined> = { ...sp, ...updates, page: '0' };
    const qs = new URLSearchParams(
      Object.entries(next).filter(([, v]) => v) as [string, string][],
    ).toString();
    return `?${qs}`;
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-end justify-between">
        <h1 className="text-[36px] font-medium tracking-tight">
          Memories <span className="text-[var(--color-muted)] tabular-nums">{result.total}</span>
        </h1>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-[var(--color-muted)]">Bucket</span>
        {BUCKETS.map((b) => (
          <Link
            key={b}
            href={pillHref({ bucket: filter.bucket === b ? undefined : b })}
            className={`rounded-full px-3 py-1 text-[12px] ${
              filter.bucket === b
                ? 'bg-[var(--color-ink)] text-[var(--color-surface)]'
                : 'border border-[var(--color-line-strong)]'
            }`}
          >
            {b}
          </Link>
        ))}
        <span className="ml-4 font-mono text-[9.5px] uppercase tracking-[0.2em] text-[var(--color-muted)]">Segment</span>
        {SEGMENTS.map((s) => (
          <Link
            key={s}
            href={pillHref({ segment: filter.segment === s ? undefined : s })}
            className={`rounded-full px-3 py-1 text-[12px] ${
              filter.segment === s
                ? 'bg-[var(--color-ink)] text-[var(--color-surface)]'
                : 'border border-[var(--color-line-strong)]'
            }`}
          >
            {s}
          </Link>
        ))}
        <Link
          href={pillHref({ touched: filter.cleanupTouched ? undefined : '1' })}
          className={`ml-4 rounded-full px-3 py-1 text-[12px] ${
            filter.cleanupTouched
              ? 'bg-[var(--color-lime)] font-medium text-[var(--color-ink)]'
              : 'border border-[var(--color-line-strong)]'
          }`}
        >
          Touched by last cleanup
        </Link>
      </div>

      <div className="overflow-hidden rounded-[16px] border border-[var(--color-line)] bg-[var(--color-surface)]">
        <table className="w-full text-[13px]">
          <thead className="text-left font-mono text-[9.5px] uppercase tracking-[0.18em] text-[var(--color-muted-2)]">
            <tr>
              <th className="px-4 py-2">ID</th>
              <th className="px-4 py-2">Content</th>
              <th className="px-4 py-2">Bucket</th>
              <th className="px-4 py-2">Segment</th>
              <th className="px-4 py-2 text-right">Imp.</th>
              <th className="px-4 py-2">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((m) => (
              <tr key={m.id} className="border-t border-[var(--color-line)]">
                <td className="px-4 py-2 font-mono text-[10px]">{m.id.slice(0, 8)}</td>
                <td className="line-clamp-1 max-w-[420px] px-4 py-2">{m.content}</td>
                <td className="px-4 py-2 font-mono text-[10px] uppercase">{m.bucket}</td>
                <td className="px-4 py-2 font-mono text-[10px] uppercase">{m.segment}</td>
                <td className="px-4 py-2 text-right tabular-nums">{m.importance.toFixed(2)}</td>
                <td className="px-4 py-2 font-mono text-[10px] uppercase">{m.cleanupVerdict ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
