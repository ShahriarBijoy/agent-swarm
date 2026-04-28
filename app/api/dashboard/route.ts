import { NextResponse } from 'next/server';
import { WIDGET_REGISTRY, type WidgetId } from '@/components/dashboard/widget-registry';

export const dynamic = 'force-dynamic';

const VALID: ReadonlySet<WidgetId> = new Set([
  'greeting','all-agents','mini-canvas','hitl-queue',
  'memory-writes-lime','cleanup-last-night','cost-line-12mo',
  'memory-segments-ring','active-workers-black',
]);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get('widget');
  if (!id || !VALID.has(id as WidgetId)) {
    return NextResponse.json({ error: 'unknown widget id' }, { status: 400 });
  }
  const def = WIDGET_REGISTRY[id as WidgetId];
  if (!def) return NextResponse.json({ error: 'widget not registered' }, { status: 500 });
  try {
    const data = await def.load();
    return NextResponse.json({ data });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
