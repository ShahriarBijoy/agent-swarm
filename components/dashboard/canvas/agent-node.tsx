import type { AgentNodeData } from './canvas-layout';

const STATE_LABEL: Record<AgentNodeData['state'], string> = {
  idle: 'idle',
  active: 'running',
  hitl: 'HITL',
  queued: 'queued',
  done: 'done',
  failed: 'failed',
};

export function AgentNode({ data, compact }: { data: AgentNodeData; compact: boolean }) {
  const isDispatcher = data.agentName === 'dispatcher';

  let borderClass = 'border-[var(--color-line-strong)]';
  let bgClass = 'bg-[var(--color-surface)]';
  let textClass = '';
  if (isDispatcher) { borderClass = 'border-[var(--color-ink)]'; bgClass = 'bg-[var(--color-ink)]'; textClass = 'text-[var(--color-surface)]'; }
  else if (data.state === 'active') borderClass = 'border-[var(--color-lime)] shadow-[0_0_0_3px_rgba(212,255,63,0.5)]';
  else if (data.state === 'hitl') borderClass = 'border-[var(--color-red)]';
  else if (data.state === 'queued') borderClass = 'border-[var(--color-line-strong)] opacity-55';

  const chips = compact ? data.toolNames.slice(0, 3) : data.toolNames;

  return (
    <div className={`rounded-[10px] border ${borderClass} ${bgClass} ${textClass} ${compact ? 'w-[178px] p-2.5' : 'w-[240px] p-3.5'}`}>
      <div className="mb-1 flex justify-between font-mono text-[8.5px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
        <span>{isDispatcher ? 'Dispatcher' : data.state === 'hitl' ? 'Worker · gated' : 'Worker'}</span>
        <span className={data.state === 'hitl' ? 'text-[var(--color-red)] font-semibold' : data.state === 'active' ? 'text-[var(--color-ink)] font-semibold' : ''}>
          {STATE_LABEL[data.state]}
        </span>
      </div>
      <div className={`text-[13px] font-medium ${textClass}`}>{data.agentName}</div>
      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {chips.map((c) => (
            <span key={c} className="rounded-[3px] border border-[var(--color-line-strong)] px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.06em] text-[var(--color-muted)]">
              {c}
            </span>
          ))}
        </div>
      )}
      {data.gate && (
        <div className="mt-2 rounded-[6px] border border-[var(--color-red)] bg-[rgba(215,25,33,0.08)] px-2 py-1.5">
          <div className="font-mono text-[8.5px] uppercase tracking-[0.2em] text-[var(--color-red)]">
            Gate · {data.gate.toolName}
          </div>
          <div className="mt-1 font-mono text-[10px]">
            {(data.gate.proposedInput as { file_path?: string })?.file_path
              ?? JSON.stringify(data.gate.proposedInput).slice(0, 60)}
          </div>
        </div>
      )}
    </div>
  );
}
