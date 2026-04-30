// components/dashboard/widget-registry.ts
import type { ComponentType } from 'react';
import { greetingDef } from './widgets/greeting';
import { allAgentsDef } from './widgets/all-agents';
import { miniCanvasDef } from './widgets/mini-canvas';
import { hitlQueueDef } from './widgets/hitl-queue';
import { memoryWritesLimeDef } from './widgets/memory-writes-lime';
import { cleanupLastNightDef } from './widgets/cleanup-last-night';
import { costLine12MoDef } from './widgets/cost-line-12mo';
import { memorySegmentsRingDef } from './widgets/memory-segments-ring';
import { activeWorkersBlackDef } from './widgets/active-workers-black';
import { tripsOnRoadDef } from './widgets/trips-on-road';

export type WidgetId =
  | 'greeting'
  | 'all-agents'
  | 'mini-canvas'
  | 'hitl-queue'
  | 'memory-writes-lime'
  | 'cleanup-last-night'
  | 'cost-line-12mo'
  | 'memory-segments-ring'
  | 'active-workers-black'
  | 'trips-on-road';

export type WidgetDef<TData = unknown> = {
  id: WidgetId;
  /** Cell-key bar label (uppercased automatically by BentoCell). */
  name: string;
  /** Bento grid-area name. */
  gridArea: string;
  /** Poll cadence for this widget. */
  refreshMs: number;
  /** Server-callable loader — returns the data the widget renders. */
  load: () => Promise<TData>;
  /** Render component receiving the loaded data — fills the FramePanel. */
  Component: ComponentType<{ data: TData }>;
  /**
   * Optional summary row rendered inside the BentoCell's <FrameFooter>
   * beneath the panel. Use this for widgets whose content is a "main
   * visual + small key/value pair" (e.g. cost-line-12mo's avg-daily and
   * days-tracked stats sit naturally in the footer slot).
   */
  Footer?: ComponentType<{ data: TData }>;
  /**
   * Extra Tailwind classes merged onto the BentoCell's inner FramePanel.
   * Use sparingly — the most common case is `'overflow-visible'` for
   * widgets whose hover layer (Recharts tooltips, dropdowns) needs to
   * render past the panel's default rounded clip.
   */
  panelClassName?: string;
};

export const WIDGET_REGISTRY: Record<WidgetId, WidgetDef> = {
  'greeting':              greetingDef as WidgetDef,
  'all-agents':            allAgentsDef as WidgetDef,
  'mini-canvas':           miniCanvasDef as WidgetDef,
  'hitl-queue':            hitlQueueDef as WidgetDef,
  'memory-writes-lime':    memoryWritesLimeDef as WidgetDef,
  'cleanup-last-night':    cleanupLastNightDef as WidgetDef,
  'cost-line-12mo':        costLine12MoDef as WidgetDef,
  'memory-segments-ring':  memorySegmentsRingDef as WidgetDef,
  'active-workers-black':  activeWorkersBlackDef as WidgetDef,
  'trips-on-road':         tripsOnRoadDef as WidgetDef,
};

export function variantFor(id: WidgetId): 'default' | 'warm' | 'lime' | 'black' {
  if (id === 'memory-writes-lime') return 'lime';
  if (id === 'active-workers-black') return 'black';
  if (id === 'cleanup-last-night' || id === 'memory-segments-ring') return 'warm';
  return 'default';
}
