import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getAgentMetrics } from '@/lib/dashboard/queries';
import { AGENT_NAMES, type AgentName } from '@/lib/agent/agents';
import { AgentChartStrip } from './charts';

export const dynamic = 'force-dynamic';

export default async function AgentPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!(AGENT_NAMES as readonly string[]).includes(name)) notFound();

  const metrics = await getAgentMetrics(name as AgentName);
  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-end justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted)]">Agent</div>
          <h1 className="text-[36px] font-medium tracking-tight">{name}</h1>
        </div>
        <Link href="/" className="text-[13px] text-[var(--color-muted)] underline">← back</Link>
      </header>

      <AgentChartStrip metrics={metrics} />

      <section>
        <h2 className="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted)]">Recent runs</h2>
        <table className="w-full text-[13px]">
          <thead className="text-left font-mono text-[9.5px] uppercase tracking-[0.18em] text-[var(--color-muted-2)]">
            <tr>
              <th className="py-2">Run</th>
              <th className="py-2">Started</th>
              <th className="py-2">Status</th>
              <th className="py-2 text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {metrics.recentRuns.map((r) => (
              <tr key={r.runId} className="border-t border-[var(--color-line)]">
                <td className="py-2 font-mono text-[11px]"><Link href={`/tasks/${r.taskId}`} className="underline">{r.runId.slice(0, 8)}</Link></td>
                <td className="py-2">{new Date(r.startedAt).toLocaleString()}</td>
                <td className="py-2">{r.status}</td>
                <td className="py-2 text-right tabular-nums">${r.costUsd.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {metrics.topMemories.length > 0 && (
        <section>
          <h2 className="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted)]">Top recalled memories (30d)</h2>
          <ul className="flex flex-col gap-2">
            {metrics.topMemories.map((m) => (
              <li key={m.memoryId} className="rounded-[10px] border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-[12px]">
                <div className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-[var(--color-muted-2)]">
                  {m.memoryId.slice(0, 8)} · {m.recallCount}x
                </div>
                <div className="mt-1 line-clamp-2">{m.excerpt}</div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
