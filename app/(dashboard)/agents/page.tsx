import Link from 'next/link';
import { AGENT_NAMES, AGENT_SOFT_BUDGET_USD } from '@/lib/agent/agents';

export const dynamic = 'force-dynamic';

export default function AgentsIndexPage() {
  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-end justify-between">
        <h1 className="text-[36px] font-medium tracking-tight">Agents</h1>
        <p className="text-[12px] text-[var(--color-muted)]">{AGENT_NAMES.length} workers</p>
      </header>

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {AGENT_NAMES.map((name) => (
          <li key={name}>
            <Link
              href={`/agents/${name}`}
              className="group flex items-center justify-between rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface)] p-4 transition hover:border-[var(--color-line-strong)]"
            >
              <div>
                <div className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-[var(--color-muted-2)]">
                  Worker
                </div>
                <div className="mt-1 text-[16px] font-medium tracking-tight">{name}</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-[var(--color-muted-2)]">
                  Soft budget
                </div>
                <div className="mt-1 text-[14px] font-semibold tabular-nums">
                  ${AGENT_SOFT_BUDGET_USD[name].toFixed(2)}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
