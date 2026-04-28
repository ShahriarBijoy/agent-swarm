'use client';

import Link from 'next/link';
import { useState } from 'react';

import { AgentAvatar } from '@/components/dashboard/agents/agent-avatar';
import { Badge } from '@/components/reui/badge';
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from '@/components/reui/frame';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { AgentName } from '@/lib/agent/agents';
import type { AgentSummary } from '@/lib/dashboard/queries';
import { cn } from '@/lib/utils';

export type AgentRow = {
  name: AgentName;
  softBudget: number;
  summary: AgentSummary | null;
};

export function AgentsTable({ rows }: { rows: AgentRow[] }) {
  const [openName, setOpenName] = useState<AgentName | null>(null);
  const open = rows.find((r) => r.name === openName) ?? null;

  return (
    <>
      <Frame spacing="sm" className="bg-[var(--color-bg-2)]/60">
        <FrameHeader className="flex-row items-end justify-between">
          <FrameTitle className="text-[24px] font-medium tracking-tight">Agents</FrameTitle>
          <FrameDescription className="font-mono text-[10px] uppercase tracking-[0.2em]">
            {rows.length} workers
          </FrameDescription>
        </FrameHeader>
        <FramePanel className="p-0! bg-[var(--color-surface-warm)] border-[var(--color-line)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-10 px-3 text-xs">Worker</TableHead>
                <TableHead className="h-10 px-3 text-xs">Status</TableHead>
                <TableHead className="h-10 px-3 text-xs">Soft budget</TableHead>
                <TableHead className="h-10 px-3 text-right text-xs">Last activated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.name}
                  onClick={() => setOpenName(row.name)}
                  className="cursor-pointer"
                >
                  <TableCell className="px-3 py-3">
                    <div className="flex items-center gap-2.5">
                      <AgentAvatar name={row.name} size="sm" />
                      <span className="text-[13px] font-medium">{row.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="px-3 py-3">{activityBadge(row.summary)}</TableCell>
                  <TableCell className="px-3 py-3 font-mono text-[12.5px] tabular-nums">
                    ${row.softBudget.toFixed(2)}
                  </TableCell>
                  <TableCell
                    className="text-muted-foreground px-3 py-3 text-right text-[12.5px]"
                    suppressHydrationWarning
                  >
                    {formatRelative(row.summary?.lastActivatedAt ?? null)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </FramePanel>
      </Frame>

      <Dialog open={open !== null} onOpenChange={(v) => !v && setOpenName(null)}>
        <DialogContent className="max-w-lg" showCloseButton={false}>
          <DialogHeader className="sr-only">
            <DialogTitle>{open?.name ?? 'Agent'} details</DialogTitle>
            <DialogDescription>Worker stats over the last 30 days.</DialogDescription>
          </DialogHeader>
          {open && <AgentDetail row={open} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function AgentDetail({ row }: { row: AgentRow }) {
  const { name, softBudget, summary } = row;
  return (
    <Frame spacing="sm">
      <FrameHeader className="px-2!">
        <FrameTitle className="flex items-center gap-2">
          <AgentAvatar name={name} size="sm" />
          <span>{name}</span>
        </FrameTitle>
        <FrameDescription>Worker stats over the last 30 days.</FrameDescription>
      </FrameHeader>
      <FramePanel className="p-0!">
        <Table>
          <TableBody>
            <DetailRow label="Status">{activityBadge(summary)}</DetailRow>
            <DetailRow label="Soft budget">
              <span className="font-mono text-sm tabular-nums">
                ${softBudget.toFixed(2)}
              </span>
            </DetailRow>
            <DetailRow label="Last activated">
              <span className="text-sm" suppressHydrationWarning>
                {formatExact(summary?.lastActivatedAt ?? null)}
              </span>
            </DetailRow>
            <DetailRow label="Total runs (30d)">
              <span className="text-sm tabular-nums">{summary?.totalRuns30d ?? 0}</span>
            </DetailRow>
            <DetailRow label="Total cost (30d)">
              <span className="font-mono text-sm tabular-nums">
                ${(summary?.totalCost30d ?? 0).toFixed(2)}
              </span>
            </DetailRow>
            <DetailRow label="Success rate (30d)">
              <SuccessRate rate={summary?.successRate30d ?? null} />
            </DetailRow>
          </TableBody>
        </Table>
      </FramePanel>
      <div className="px-2 pt-1">
        <Link
          href={`/agents/${name}`}
          className="text-[12.5px] text-[var(--color-muted)] underline hover:text-[var(--color-ink)]"
        >
          View full metrics →
        </Link>
      </div>
    </Frame>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
      <TableCell className="bg-muted/50 w-40 py-2 text-sm font-medium">{label}</TableCell>
      <TableCell className="py-2">{children}</TableCell>
    </TableRow>
  );
}

function SuccessRate({ rate }: { rate: number | null }) {
  if (rate == null) {
    return <span className="text-muted-foreground text-sm">—</span>;
  }
  const pct = Math.round(rate * 100);
  const color =
    pct >= 90 ? 'bg-green-500' : pct >= 70 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-3">
      <div className="bg-muted h-2 w-24 overflow-hidden rounded-full">
        <div
          className={cn('h-full rounded-full', color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-muted-foreground text-sm tabular-nums">{pct}%</span>
    </div>
  );
}

function activityBadge(summary: AgentSummary | null) {
  const last = summary?.lastActivatedAt ?? null;
  if (!last) {
    return (
      <Badge variant="outline" size="sm">
        idle
      </Badge>
    );
  }
  const hours = (Date.now() - last.getTime()) / (1000 * 60 * 60);
  if (hours < 0.25) {
    return (
      <Badge variant="success" size="sm">
        active
      </Badge>
    );
  }
  if (hours < 24) {
    return (
      <Badge variant="info" size="sm">
        recent
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" size="sm">
      idle
    </Badge>
  );
}

function formatRelative(date: Date | null): string {
  if (!date) return 'Never';
  const ms = Date.now() - date.getTime();
  if (ms < 0) return 'Just now';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatExact(date: Date | null): string {
  if (!date) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
