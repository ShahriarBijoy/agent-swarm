// components/dashboard/widgets/mini-canvas.tsx
// Server module: holds the widget def (Server-Component import target).
// The actual JSX lives in mini-canvas-view.tsx so the registry's `load`
// function survives the RSC client-reference boundary.
import type { ActiveRunSnapshot } from '@/lib/dashboard/queries';
import type { WidgetDef } from '../widget-registry';
import { getActiveRun } from '@/lib/dashboard/queries';
import { MiniCanvas } from './mini-canvas-view';

export { MiniCanvas };

export const miniCanvasDef: WidgetDef<ActiveRunSnapshot | null> = {
  id: 'mini-canvas',
  name: 'Active swarm run',
  gridArea: 'canvas',
  refreshMs: 2000,
  load: getActiveRun,
  Component: MiniCanvas,
};
