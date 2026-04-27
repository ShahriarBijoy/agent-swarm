// components/dashboard/canvas/agent-canvas.tsx
'use client';
import { useMemo } from 'react';
import ReactFlow, { Background, Controls } from 'reactflow';
import 'reactflow/dist/style.css';
import type { InferSelectModel } from 'drizzle-orm';
import { taskEvents } from '@/db/schema';
import { layoutCanvas, type AgentNodeData } from './canvas-layout';
import { AgentNode } from './agent-node';

type TaskEvent = InferSelectModel<typeof taskEvents>;

const nodeTypes = {
  agent: ({ data }: { data: AgentNodeData & { compact: boolean } }) => (
    <AgentNode data={data} compact={data.compact} />
  ),
};

export type AgentCanvasProps = {
  events: TaskEvent[];
  mode: 'full' | 'mini';
  /** Epoch ms cursor for replay; omit for live. */
  asOf?: number;
};

export function AgentCanvas({ events, mode, asOf }: AgentCanvasProps) {
  const { nodes, edges } = useMemo(() => layoutCanvas(events, asOf), [events, asOf]);

  const rfNodes = nodes.map((n) => ({
    id: n.id,
    type: 'agent',
    position: n.position,
    data: { ...n.data, compact: mode === 'mini' },
    draggable: false,
    selectable: false,
  }));
  const rfEdges = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: 'default',
    style: { stroke: 'var(--color-line-strong)', strokeWidth: 1.2 },
    animated: false,
  }));

  return (
    <div
      className={`relative ${mode === 'mini' ? 'h-[280px]' : 'h-[540px]'} w-full overflow-hidden rounded-[12px] border border-[var(--color-line)]`}
    >
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        fitView={mode === 'full'}
        proOptions={{ hideAttribution: true }}
        zoomOnScroll={mode === 'full'}
        panOnDrag={mode === 'full'}
        panOnScroll={false}
      >
        {mode === 'full' && <Controls showInteractive={false} />}
        <Background gap={18} size={1} color="rgba(10,10,10,0.05)" />
      </ReactFlow>
    </div>
  );
}
