// components/dashboard/widgets/cleanup-last-night.tsx
import type { LastCleanupSnapshot } from '@/lib/dashboard/queries';
import type { WidgetDef } from '../widget-registry';
import { getLastCleanup } from '@/lib/dashboard/queries';

export function CleanupLastNight({ data }: { data: LastCleanupSnapshot }) {
  if (!data) {
    return <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-muted-2)]">No cleanup runs yet</div>;
  }
  return (
    <div>
      <div className="text-[14px] font-medium text-[var(--color-muted)]">Consolidator → Adversary → Judge</div>
      <div className="mt-3.5 grid grid-cols-3 gap-2">
        {[
          { label: 'Promoted', value: data.promoted, warm: false },
          { label: 'Pruned',   value: data.pruned,   warm: true  },
          { label: 'Contested', value: data.contested, warm: false },
        ].map((tile) => (
          <div key={tile.label} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-warm)] px-2.5 py-2">
            <div className={`text-[18px] font-semibold tracking-tight tabular-nums ${tile.warm ? 'text-[var(--color-red)]' : ''}`}>
              {tile.value}
            </div>
            <div className="mt-0.5 font-mono text-[8.5px] uppercase tracking-[0.18em] text-[var(--color-muted-2)]">
              {tile.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export const cleanupLastNightDef: WidgetDef<LastCleanupSnapshot> = {
  id: 'cleanup-last-night',
  name: 'Cleanup last night',
  gridArea: 'cleanup',
  refreshMs: 30000,
  load: getLastCleanup,
  Component: CleanupLastNight,
};
