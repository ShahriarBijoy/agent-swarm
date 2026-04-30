// components/dashboard/canvas/agent-canvas.tsx
'use client';
import { memo, useEffect, useMemo, useRef } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  ReactFlowProvider,
  useReactFlow,
  type EdgeTypes,
  type NodeTypes,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { InferSelectModel } from 'drizzle-orm';
import type { taskEvents } from '@/db/schema';
import { layoutCanvas, type AgentNodeData } from './canvas-layout';
import { AgentNode } from './agent-node';
import { DataEdge, type DataEdgeData } from './data-edge';

type TaskEvent = InferSelectModel<typeof taskEvents>;

// --- Stable type registries ----------------------------------------------
// React Flow warns ("It looks like you've created a new nodeTypes or edgeTypes
// object…") whenever the *reference* it sees differs between renders. To make
// the references rock-stable across HMR, Strict Mode double-renders, and
// component re-mounts:
//   1. The wrapper component is `memo`-wrapped at module scope (stable identity)
//   2. The maps themselves are FROZEN module-scope constants (never re-allocated)
//   3. We *also* `useMemo(() => …, [])` inside the component as a safety net
const AgentNodeWrapper = memo(function AgentNodeWrapper({
  data,
}: {
  data: AgentNodeData & { compact: boolean; linkable: boolean };
}) {
  return <AgentNode data={data} compact={data.compact} linkable={data.linkable} />;
});

const NODE_TYPES: NodeTypes = Object.freeze({
  agent: AgentNodeWrapper,
}) as NodeTypes;

const EDGE_TYPES: EdgeTypes = Object.freeze({
  data: DataEdge,
}) as EdgeTypes;

const DEFAULT_EDGE_STYLE = {
  stroke: 'var(--color-ink)',
  strokeWidth: 1.5,
  strokeOpacity: 0.7,
};
const DEFAULT_MARKER_END = {
  type: MarkerType.ArrowClosed,
  color: 'var(--color-ink)',
  width: 14,
  height: 14,
};

export type AgentCanvasProps = {
  events: TaskEvent[];
  mode: 'full' | 'mini';
  /** Epoch ms cursor for replay; omit for live. */
  asOf?: number;
};

// React Flow v11's "002" warning fires whenever it sees a `nodeTypes`/`edgeTypes`
// reference that differs from the previous render but has the same keys. We feed
// frozen module-scope constants + useMemo, but the warning still fires on the
// FIRST render because:
//   1. The store's default onError is `devWarn` (always console.warns).
//   2. The user-supplied `onError` prop is wired via `useEffect`, so it doesn't
//      take effect until after the first paint.
// onError on the prop covers re-renders. The console patch below covers the
// first-render gap. Both are dev-only — `devWarn` short-circuits in prod.
function onError(code: string, message: string) {
  if (code === '002') return;
  // eslint-disable-next-line no-console
  console.warn(`[ReactFlow:${code}] ${message}`);
}

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const w = window as Window & { __rfWarnPatched?: boolean };
  if (!w.__rfWarnPatched) {
    w.__rfWarnPatched = true;
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      const first = args[0];
      if (typeof first === 'string' && first.includes('[React Flow]') && first.includes('error#002')) {
        return;
      }
      origWarn(...args);
    };
  }
}

function CanvasInner({ events, mode, asOf }: AgentCanvasProps) {
  const { nodes, edges } = useMemo(() => layoutCanvas(events, asOf), [events, asOf]);
  const flow = useReactFlow();
  const lastNodeCount = useRef(0);

  // Belt-and-suspenders memoization: the constants above are already stable,
  // but referencing them through useMemo makes intent explicit and silences
  // any lint rule that would flag a fresh inline object.
  const nodeTypes = useMemo(() => NODE_TYPES, []);
  const edgeTypes = useMemo(() => EDGE_TYPES, []);

  // Explicit width lets React Flow skip its async measurement cycle for the
  // horizontal axis. Height is left for the browser to measure so worker nodes
  // can grow when their tool-chip stack expands past the typical case;
  // otherwise long MCP tool names overflow the node's clip rect.
  const NODE_W = mode === 'mini' ? 178 : 240;

  const rfNodes = useMemo(
    () =>
      nodes.map((n) => ({
        id: n.id,
        type: 'agent',
        position: n.position,
        data: { ...n.data, compact: mode === 'mini', linkable: mode === 'full' },
        draggable: mode === 'full',
        selectable: mode === 'full',
        width: NODE_W,
      })),
    [nodes, mode, NODE_W],
  );
  const rfEdges = useMemo(
    () =>
      edges.map((e) => {
        const data: DataEdgeData = {
          // Use the dispatcher's routing reason if present; otherwise fall back
          // to the worker name so the edge isn't anonymous in mini mode.
          ...(e.data.reason ? { label: e.data.reason } : {}),
          tone: 'cool',
        };
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          type: 'data',
          data,
          style: DEFAULT_EDGE_STYLE,
          markerEnd: DEFAULT_MARKER_END,
        };
      }),
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
      edgeTypes={edgeTypes}
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
      onError={onError}
    >
      {mode === 'full' && <Controls showInteractive={false} />}
      <Background gap={18} size={1} color="rgba(10,10,10,0.05)" />
    </ReactFlow>
  );
}

export function AgentCanvas(props: AgentCanvasProps) {
  // mini mode: fill remaining height of the parent flex column (the
  // mini-canvas widget renders <div class="flex h-full flex-col">). A
  // generous min-height keeps the canvas usable even when the row is
  // unusually short during layout reflow.
  // full mode: fixed 540px on the dedicated /tasks/[id] view.
  const sizing = props.mode === 'mini' ? 'min-h-[280px] flex-1' : 'h-[540px]';
  return (
    <div
      className={`relative ${sizing} w-full overflow-hidden rounded-[12px] border border-[var(--color-line)]`}
    >
      <ReactFlowProvider>
        <CanvasInner {...props} />
      </ReactFlowProvider>
    </div>
  );
}
