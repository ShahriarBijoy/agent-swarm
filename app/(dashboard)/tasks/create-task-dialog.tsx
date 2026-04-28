'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { CreateTaskForm } from './create-form';

export function CreateTaskDialog() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="rounded-full border border-[var(--color-line-strong)] px-3.5 py-1.5 text-[13px] font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-warm)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ink)]/20">
        + New task
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>
            Describe what the fleet orchestrator should do. The swarm picks the agents.
          </DialogDescription>
        </DialogHeader>
        <CreateTaskForm onCreated={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
