// components/dashboard/widgets/mini-canvas.tsx
'use client';
import type { ActiveRunSnapshot } from '@/lib/dashboard/queries';
import type { WidgetDef } from '../widget-registry';
import { getActiveRun } from '@/lib/dashboard/queries';
import { AgentCanvas } from '../canvas/agent-canvas';

export function MiniCanvas({ data }: { data: ActiveRunSnapshot | null }) {
  if (!data) {
    return (
      <div className="grid h-full place-items-center font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-muted-2)]">
        No active run
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <div className="mb-3.5 flex items-start justify-between">
        <div>
          <h3 className="text-[17px] font-medium tracking-tight">Active swarm run · {data.task.id.slice(0, 8)}</h3>
          <div className="mt-1 font-mono text-[11px] text-[var(--color-muted)]">{data.task.prompt.slice(0, 80)}</div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-lime)] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--color-ink)]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-ink)]" />
          Live
        </span>
      </div>
      <AgentCanvas events={data.events as never} mode="mini" />
    </div>
  );
}

export const miniCanvasDef: WidgetDef<ActiveRunSnapshot | null> = {
  id: 'mini-canvas',
  name: 'Active swarm run',
  gridArea: 'canvas',
  refreshMs: 2000,
  load: getActiveRun,
  Component: MiniCanvas,
};
