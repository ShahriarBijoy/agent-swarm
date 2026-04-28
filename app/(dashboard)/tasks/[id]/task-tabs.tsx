'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';

export type TaskView = 'canvas' | 'stream';

export type TaskTabsProps = {
  initialView: TaskView;
  canvasSlot: ReactNode;
  streamSlot: ReactNode;
};

/**
 * Canvas / Stream switcher. Source of truth is the `?view=` query param so
 * refreshes and shared links keep their tab. We mirror that into local
 * state for snappy UI; router.replace then pushes the change back into the
 * URL without a full page navigation. Radix unmounts inactive TabsContent
 * children by default, so only one EventSource is alive at a time.
 */
export function TaskTabs({ initialView, canvasSlot, streamSlot }: TaskTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [view, setView] = useState<TaskView>(initialView);

  const handleChange = (next: string) => {
    if (next !== 'canvas' && next !== 'stream') return;
    setView(next);
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('view', next);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  return (
    <Tabs value={view} onValueChange={handleChange} className="gap-4">
      <TabsList>
        <TabsTrigger
          value="canvas"
          className="data-active:bg-[var(--color-lime)] data-active:text-[var(--color-ink)] data-active:shadow-sm"
        >
          Canvas
        </TabsTrigger>
        <TabsTrigger
          value="stream"
          className="data-active:bg-[var(--color-lime)] data-active:text-[var(--color-ink)] data-active:shadow-sm"
        >
          Stream
        </TabsTrigger>
      </TabsList>
      <TabsContent value="canvas">{canvasSlot}</TabsContent>
      <TabsContent value="stream">{streamSlot}</TabsContent>
    </Tabs>
  );
}
