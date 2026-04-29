// app/(dashboard)/page.tsx
import { BentoGrid } from '@/components/dashboard/bento-grid';
import { BentoCell } from '@/components/dashboard/bento-cell';
import { WIDGET_REGISTRY, variantFor, type WidgetId } from '@/components/dashboard/widget-registry';
import type { ActiveRunSnapshot } from '@/lib/dashboard/queries';

export const dynamic = 'force-dynamic';

const ORDER: WidgetId[] = [
  'greeting', 'all-agents', 'mini-canvas', 'hitl-queue',
  'memory-writes-lime', 'cleanup-last-night', 'cost-line-12mo',
  'memory-segments-ring', 'active-workers-black', 'trips-on-road',
];

// Each cell links to a focused list/detail page. The mini-canvas link is
// dynamic — it points at the active task so clicking the live cell drops
// you straight into its full canvas.
function hrefFor(id: WidgetId, data: unknown): string | undefined {
  switch (id) {
    case 'greeting':              return undefined;            // no obvious destination
    case 'all-agents':            return '/agents';
    case 'mini-canvas': {
      const snap = data as ActiveRunSnapshot | null;
      return snap?.task.id ? `/tasks/${snap.task.id}` : '/tasks';
    }
    case 'hitl-queue':            return '/tasks';
    case 'memory-writes-lime':    return '/memories';
    case 'cleanup-last-night':    return '/memories?touched=1';
    case 'cost-line-12mo':        return '/agents';
    case 'memory-segments-ring':  return '/memories';
    case 'active-workers-black':  return '/agents';
    case 'trips-on-road':         return '/map';
    default:                      return undefined;
  }
}


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
        const FooterComp = def.Footer;
        return (
          <BentoCell
            key={id}
            name={def.name}
            gridArea={def.gridArea}
            variant={variantFor(id)}
            openHref={hrefFor(id, data)}
            footer={FooterComp ? <FooterComp data={data as never} /> : undefined}
            panelClassName={def.panelClassName}
          >
            <Comp data={data as never} />
          </BentoCell>
        );
      })}
    </BentoGrid>
  );
}
