// components/dashboard/widgets/hitl-queue.tsx
import type { OpenGate } from '@/lib/dashboard/queries';
import type { WidgetDef } from '../widget-registry';
import { getOpenApprovalGates } from '@/lib/dashboard/queries';

export function HitlQueue({ data }: { data: OpenGate[] }) {
  const first = data[0];
  return (
    <div className="flex h-full flex-col">
      <div className="text-[30px] font-semibold leading-none tabular-nums">{data.length}</div>
      <div className="mt-1.5 text-[12px] text-[var(--color-muted)]">
        {data.length === 1 ? 'awaiting human approval' : 'awaiting human approvals'}
      </div>
      {first && (
        <div className="mt-3.5 rounded-[10px] border border-[var(--color-red)] bg-[rgba(215,25,33,0.05)] p-3">
          <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--color-red)]">
            Gate · {String(first.toolName)}
          </div>
          <div className="mt-1.5 font-mono text-[11px] leading-[1.4]">
            {(first.proposedInput as { file_path?: string })?.file_path ?? JSON.stringify(first.proposedInput).slice(0, 80)}
          </div>
          <div className="mt-2.5 flex gap-1.5">
            <button className="rounded-[4px] border border-[var(--color-ink)] bg-[var(--color-ink)] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--color-surface)]">Approve</button>
            <button className="rounded-[4px] border border-[var(--color-ink)] bg-transparent px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--color-ink)]">Modify</button>
          </div>
        </div>
      )}
    </div>
  );
}

export const hitlQueueDef: WidgetDef<OpenGate[]> = {
  id: 'hitl-queue',
  name: 'HITL queue',
  gridArea: 'hitl',
  refreshMs: 2000,
  load: getOpenApprovalGates,
  Component: HitlQueue,
};
