// app/(dashboard)/page.tsx
import { BentoGrid } from '@/components/dashboard/bento-grid';
import { BentoCell } from '@/components/dashboard/bento-cell';
import { WIDGET_REGISTRY, variantFor, type WidgetId } from '@/components/dashboard/widget-registry';

export const dynamic = 'force-dynamic';

const ORDER: WidgetId[] = [
  'greeting', 'all-agents', 'mini-canvas', 'hitl-queue',
  'memory-writes-lime', 'cleanup-last-night', 'cost-line-12mo',
  'memory-segments-ring', 'active-workers-black',
];

export default async function HomePage() {
  // initial server-side render: load each widget's data once
  const initial = await Promise.all(
    ORDER.map(async (id) => ({ id, data: await WIDGET_REGISTRY[id].load() })),
  );

  return (
    <BentoGrid>
      {initial.map(({ id, data }) => {
        const def = WIDGET_REGISTRY[id];
        const Comp = def.Component;
        return (
          <BentoCell key={id} name={def.name} gridArea={def.gridArea} variant={variantFor(id)}>
            <Comp data={data as never} />
          </BentoCell>
        );
      })}
    </BentoGrid>
  );
}
