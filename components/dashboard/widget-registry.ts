// components/dashboard/widget-registry.ts
import type { ComponentType } from 'react';

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

export const WIDGET_REGISTRY = {} as Record<WidgetId, WidgetDef>;
