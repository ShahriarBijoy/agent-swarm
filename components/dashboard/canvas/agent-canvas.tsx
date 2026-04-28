// components/dashboard/canvas/agent-canvas.tsx
'use client';
import { useEffect, useMemo, useRef } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  ReactFlowProvider,
  useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { InferSelectModel } from 'drizzle-orm';
import type { taskEvents } from '@/db/schema';
import { layoutCanvas, type AgentNodeData } from './canvas-layout';
import { AgentNode } from './agent-node';

type TaskEvent = InferSelectModel<typeof taskEvents>;

// nodeTypes must be a stable reference between renders, otherwise React Flow
// warns and disables interactions. Defining outside the component achieves this.
const nodeTypes = {
  agent: ({ data }: { data: AgentNodeData & { compact: boolean } }) => (
    <AgentNode data={data} compact={data.compact} />
  ),
};

const EDGE_DEFAULTS = {
  type: 'smoothstep' as const,
  animated: false,
  style: { stroke: 'var(--color-ink)', strokeWidth: 1.5, strokeOpacity: 0.7 },
  markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--color-ink)', width: 14, height: 14 },
};

export type AgentCanvasProps = {
  events: TaskEvent[];
  mode: 'full' | 'mini';
  /** Epoch ms cursor for replay; omit for live. */
  asOf?: number;
};

function CanvasInner({ events, mode, asOf }: AgentCanvasProps) {
  const { nodes, edges } = useMemo(() => layoutCanvas(events, asOf), [events, asOf]);
  const flow = useReactFlow();
  const lastNodeCount = useRef(0);

  const rfNodes = useMemo(
    () =>
      nodes.map((n) => ({
        id: n.id,
        type: 'agent',
        position: n.position,
        data: { ...n.data, compact: mode === 'mini' },
        draggable: mode === 'full',
        selectable: mode === 'full',
      })),
    [nodes, mode],
  );
  const rfEdges = useMemo(
    () => edges.map((e) => ({ id: e.id, source: e.source, target: e.target, ...EDGE_DEFAULTS })),
    [edges],
  );

  // Re-fit view when the node set actually changes (new worker delegated, etc.)
  // so the canvas always frames the org chart instead of leaving the dispatcher
  // pinned at (350,0) and the workers off-screen.
  useEffect(() => {
    if (rfNodes.length === 0) return;
    if (rfNodes.length !== lastNodeCount.current) {
      lastNodeCount.current = rfNodes.length;
      const id = window.setTimeout(
        () => flow.fitView({ padding: mode === 'mini' ? 0.15 : 0.2, duration: 240 }),
        50,
      );
      return () => window.clearTimeout(id);
    }
  }, [rfNodes.length, flow, mode]);

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: mode === 'mini' ? 0.15 : 0.2 }}
      proOptions={{ hideAttribution: true }}
      zoomOnScroll={mode === 'full'}
      zoomOnDoubleClick={mode === 'full'}
      panOnDrag={mode === 'full'}
      panOnScroll={false}
      nodesDraggable={mode === 'full'}
      nodesConnectable={false}
      elementsSelectable={mode === 'full'}
    >
      {mode === 'full' && <Controls showInteractive={false} />}
      <Background gap={18} size={1} color="rgba(10,10,10,0.05)" />
    </ReactFlow>
  );
}

export function AgentCanvas(props: AgentCanvasProps) {
  return (
    <div
      className={`relative ${props.mode === 'mini' ? 'h-[280px]' : 'h-[540px]'} w-full overflow-hidden rounded-[12px] border border-[var(--color-line)]`}
    >
      <ReactFlowProvider>
        <CanvasInner {...props} />
      </ReactFlowProvider>
    </div>
  );
}
