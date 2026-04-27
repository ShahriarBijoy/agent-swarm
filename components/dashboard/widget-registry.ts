// components/dashboard/widget-registry.ts
import type { ComponentType } from 'react';
import { greetingDef } from './widgets/greeting';
import { allAgentsDef } from './widgets/all-agents';
import { hitlQueueDef } from './widgets/hitl-queue';
import { memoryWritesLimeDef } from './widgets/memory-writes-lime';

export type WidgetId =
  | 'greeting'
  | 'all-agents'
  | 'mini-canvas'
  | 'hitl-queue'
  | 'memory-writes-lime'
  | 'cleanup-last-night'
  | 'cost-line-12mo'
  | 'memory-segments-ring'
  | 'active-workers-black';

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
  /** Render component receiving the loaded data. */
  Component: ComponentType<{ data: TData }>;
};

// Use `WidgetDef<any>` here because `WidgetDef<TData>` is invariant in `TData`
// (the `Component` prop makes it so), and concrete widget defs like
// `WidgetDef<GreetingSnapshot>` would otherwise not be assignable to
// `WidgetDef<unknown>`. Task 24 will tighten this to a fully-specified registry.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const WIDGET_REGISTRY: Partial<Record<WidgetId, WidgetDef<any>>> = {
  greeting: greetingDef,
  'all-agents': allAgentsDef,
  'hitl-queue': hitlQueueDef,
  'memory-writes-lime': memoryWritesLimeDef,
};
