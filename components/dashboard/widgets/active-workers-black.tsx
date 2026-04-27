// components/dashboard/widgets/active-workers-black.tsx
import type { ActiveWorkersSnapshot } from '@/lib/dashboard/queries';
import type { WidgetDef } from '../widget-registry';
import { getActiveWorkers } from '@/lib/dashboard/queries';

export function ActiveWorkersBlack({ data }: { data: ActiveWorkersSnapshot }) {
  const idle = Math.max(0, data.totalAgents - data.activeAgentNames.length);
  return (
    <div>
      <h3 className="text-[17px] font-medium tracking-tight">Currently running</h3>
      <div className="mt-1.5 text-[30px] font-semibold leading-none tracking-tight tabular-nums">
        {data.activeAgentNames.length} / {data.totalAgents}
      </div>
      <div className="mt-1.5 text-[12px] text-white/60">
        {idle} idle, {data.activeAgentNames.length} live, the rest cooled down.
      </div>
    </div>
  );
}

export const activeWorkersBlackDef: WidgetDef<ActiveWorkersSnapshot> = {
  id: 'active-workers-black',
  name: 'Active workers · live',
  gridArea: 'black',
  refreshMs: 3000,
  load: getActiveWorkers,
  Component: ActiveWorkersBlack,
};
