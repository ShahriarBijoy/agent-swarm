// components/dashboard/widgets/cost-line-12mo.tsx
// Server module: holds the widget def. The Recharts JSX lives in
// cost-line-12mo-view.tsx ('use client') so the registry's `load`
// function stays a real server function across the RSC boundary.
import type { CostLineSnapshot } from '@/lib/dashboard/queries';
import type { WidgetDef } from '../widget-registry';
import { getCostLine12Mo } from '@/lib/dashboard/queries';
import { CostLine12Mo, CostLine12MoFooter } from './cost-line-12mo-view';

export { CostLine12Mo };

export const costLine12MoDef: WidgetDef<CostLineSnapshot> = {
  id: 'cost-line-12mo',
  name: 'Your swarm cost · this year',
  gridArea: 'cost',
  refreshMs: 30000,
  load: getCostLine12Mo,
  Component: CostLine12Mo,
  Footer: CostLine12MoFooter,
  // Recharts tooltips render absolutely-positioned inside the chart wrapper.
  // The Frame primitive clips them by default — opt this cell out so the
  // tooltip can extend past the panel's right edge near the latest data
  // point. Combined with allowEscapeViewBox in the chart config.
  panelClassName: 'overflow-visible',
};
