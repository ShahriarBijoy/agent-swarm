// components/dashboard/canvas/data-edge.tsx
// v11 equivalent of React Flow UI's data-edge (https://reactflow.dev/ui/components/data-edge).
// Renders an edge with an optional label/badge in the middle, themed against
// the dashboard tokens. We're on `reactflow` v11 (not @xyflow/react v12 which
// the official UI components target) so the API surface is `BaseEdge` +
// `EdgeLabelRenderer` + `getSmoothStepPath`.
'use client';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from 'reactflow';

export type DataEdgeData = {
  label?: string;
  tone?: 'cool' | 'warm' | 'lit';
};

export function DataEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  style,
}: EdgeProps<DataEdgeData>) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
  });

  const toneClass =
    data?.tone === 'lit'
      ? 'bg-[var(--color-lime)] border-[var(--color-lime-deep)] text-[var(--color-ink)] font-semibold'
      : data?.tone === 'warm'
      ? 'border-[var(--color-red)] text-[var(--color-red)] bg-[var(--color-surface)]'
      : 'border-[var(--color-line-strong)] text-[var(--color-muted)] bg-[var(--color-surface)]';

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      {data?.label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            className={`pointer-events-auto whitespace-nowrap rounded-full border px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.18em] ${toneClass}`}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
