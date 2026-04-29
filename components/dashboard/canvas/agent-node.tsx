'use client';
import Link from 'next/link';
import { Handle, Position } from 'reactflow';
import type { AgentNodeData } from './canvas-layout';

const STATE_LABEL: Record<AgentNodeData['state'], string> = {
  idle: 'idle',
  active: 'running',
  hitl: 'HITL',
  queued: 'queued',
  done: 'done',
  failed: 'failed',
};

export type AgentNodeProps = {
  data: AgentNodeData;
  compact: boolean;
  /** When true (full canvas mode), the agent name links to /agents/[name]. */
  linkable?: boolean;
};

export function AgentNode({ data, compact, linkable = false }: AgentNodeProps) {
  const isDispatcher = data.agentName === 'dispatcher';

  let borderClass = 'border-[var(--color-line-strong)]';
  let bgClass = 'bg-[var(--color-surface)]';
  let textClass = '';
  if (isDispatcher) { borderClass = 'border-[var(--color-ink)]'; bgClass = 'bg-[var(--color-ink)]'; textClass = 'text-[var(--color-surface)]'; }
  else if (data.state === 'active') borderClass = 'border-[var(--color-lime)] shadow-[0_0_0_3px_rgba(212,255,63,0.5)]';
  else if (data.state === 'hitl') borderClass = 'border-[var(--color-red)]';
  else if (data.state === 'queued') borderClass = 'border-[var(--color-line-strong)] opacity-55';

  // Tool names are usually MCP-prefixed (`MCP_AUTO_RIDE_DOMAIN__QUERY_VEHICLES`).
  // Strip everything before the last `__` so the chip stays scannable inside
  // narrow worker nodes; the full name still shows on hover.
  const shortenChip = (name: string) => {
    const idx = name.lastIndexOf('__');
    return idx >= 0 ? name.slice(idx + 2) : name;
  };
  const chips = compact ? data.toolNames.slice(0, 4) : data.toolNames;

  // Workers in full mode link to /agents/<name>; the dispatcher is the
  // orchestrator (not in the worker registry) so it stays a plain node.
  const nameNode =
    linkable && !isDispatcher ? (
      <Link
        href={`/agents/${data.agentName}`}
        className="hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {data.agentName}
      </Link>
    ) : (
      data.agentName
    );

  return (
    <div className={`relative rounded-[10px] border transition-shadow ${borderClass} ${bgClass} ${textClass} ${compact ? 'w-[178px] p-2.5' : 'w-[240px] p-3.5'} ${linkable && !isDispatcher ? 'hover:shadow-md' : ''}`}>
      {/* Workers receive an edge from the dispatcher; dispatcher emits one to each worker. */}
      {!isDispatcher && (
        <Handle type="target" position={Position.Top} style={{ background: 'transparent', border: 'none', width: 1, height: 1 }} />
      )}
      {isDispatcher && (
        <Handle type="source" position={Position.Bottom} style={{ background: 'transparent', border: 'none', width: 1, height: 1 }} />
      )}

      <div className={`mb-1 flex justify-between font-mono text-[8.5px] uppercase tracking-[0.2em] ${isDispatcher ? 'text-white/55' : 'text-[var(--color-muted)]'}`}>
        <span>{isDispatcher ? 'Dispatcher' : data.state === 'hitl' ? 'Worker · gated' : 'Worker'}</span>
        <span className={data.state === 'hitl' ? 'text-[var(--color-red)] font-semibold' : data.state === 'active' ? 'text-[var(--color-ink)] font-semibold' : ''}>
          {STATE_LABEL[data.state]}
        </span>
      </div>
      <div className={`text-[13px] font-medium ${textClass}`}>{nameNode}</div>
      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {chips.map((c) => (
            <span
              key={c}
              title={c}
              className={`max-w-full truncate rounded-[3px] border px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.06em] ${isDispatcher ? 'border-white/20 text-white/65' : 'border-[var(--color-line-strong)] text-[var(--color-muted)]'}`}
            >
              {shortenChip(c)}
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
