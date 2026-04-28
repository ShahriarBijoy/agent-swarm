'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  ColumnDef,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  PaginationState,
  SortingState,
  useReactTable,
} from '@tanstack/react-table';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  DatabaseIcon,
  Tag01Icon,
  SparklesIcon,
  FilterIcon,
  FilterRemoveIcon,
} from '@hugeicons/core-free-icons';

import { Badge } from '@/components/reui/badge';
import {
  DataGrid,
  DataGridContainer,
} from '@/components/reui/data-grid/data-grid';
import { DataGridColumnHeader } from '@/components/reui/data-grid/data-grid-column-header';
import { DataGridPagination } from '@/components/reui/data-grid/data-grid-pagination';
import { DataGridTable } from '@/components/reui/data-grid/data-grid-table';
import {
  createFilter,
  Filters,
  type Filter,
  type FilterFieldConfig,
} from '@/components/reui/filters';
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from '@/components/reui/frame';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import {
  Table as DetailTable,
  TableBody as DetailTableBody,
  TableCell as DetailTableCell,
  TableRow as DetailTableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

export type MemoryRow = {
  id: string;
  content: string;
  bucket: string;
  segment: string;
  importance: number;
  lastRecallAt: Date | null;
  accessCount: number;
  cleanupVerdict: string | null;
};

const BUCKETS = ['short', 'long', 'permanent'] as const;
const SEGMENTS = [
  'identity',
  'correction',
  'preference',
  'relationship',
  'knowledge',
  'behavioral',
  'context',
] as const;
const VERDICTS = ['promote', 'prune', 'merge', 'keep'] as const;

export function MemoriesTable({ rows, total }: { rows: MemoryRow[]; total: number }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = rows.find((r) => r.id === openId) ?? null;

  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'importance', desc: true },
  ]);
  const [filters, setFilters] = useState<Filter[]>([]);

  const fields: FilterFieldConfig[] = useMemo(
    () => [
      {
        key: 'bucket',
        label: 'Bucket',
        icon: <HugeiconsIcon icon={DatabaseIcon} strokeWidth={2} className="size-3.5" />,
        type: 'select',
        searchable: false,
        className: 'w-[140px]',
        options: BUCKETS.map((b) => ({
          value: b,
          label: b.charAt(0).toUpperCase() + b.slice(1),
        })),
      },
      {
        key: 'segment',
        label: 'Segment',
        icon: <HugeiconsIcon icon={Tag01Icon} strokeWidth={2} className="size-3.5" />,
        type: 'select',
        searchable: true,
        className: 'w-[160px]',
        options: SEGMENTS.map((s) => ({
          value: s,
          label: s.charAt(0).toUpperCase() + s.slice(1),
        })),
      },
      {
        key: 'cleanupVerdict',
        label: 'Cleanup',
        icon: <HugeiconsIcon icon={SparklesIcon} strokeWidth={2} className="size-3.5" />,
        type: 'select',
        searchable: false,
        className: 'w-[150px]',
        options: VERDICTS.map((v) => ({
          value: v,
          label: v.charAt(0).toUpperCase() + v.slice(1),
        })),
      },
    ],
    [],
  );

  const filteredRows = useMemo(() => {
    const active = filters.filter((f) => f.values && f.values.length > 0);
    if (active.length === 0) return rows;
    return rows.filter((row) => {
      return active.every((filter) => {
        const fieldValue = (row as unknown as Record<string, unknown>)[filter.field];
        switch (filter.operator) {
          case 'is':
            return filter.values.includes(fieldValue);
          case 'is_not':
            return !filter.values.includes(fieldValue);
          case 'empty':
            return fieldValue == null || fieldValue === '';
          case 'not_empty':
            return fieldValue != null && fieldValue !== '';
          default:
            return true;
        }
      });
    });
  }, [rows, filters]);

  const handleFiltersChange = useCallback((newFilters: Filter[]) => {
    setFilters(newFilters);
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, []);

  const columns = useMemo<ColumnDef<MemoryRow>[]>(
    () => [
      {
        accessorKey: 'id',
        id: 'id',
        header: 'ID',
        cell: ({ row }) => (
          <span className="font-mono text-[11px] text-[var(--color-muted)]">
            {row.original.id.slice(0, 8)}
          </span>
        ),
        size: 90,
        enableSorting: false,
      },
      {
        accessorKey: 'content',
        id: 'content',
        header: ({ column }) => <DataGridColumnHeader title="Content" column={column} />,
        cell: ({ row }) => (
          <span className="line-clamp-1 block max-w-[460px] text-[13px]">
            {row.original.content}
          </span>
        ),
        size: 460,
        enableSorting: true,
      },
      {
        accessorKey: 'bucket',
        id: 'bucket',
        header: 'Bucket',
        cell: ({ row }) => <BucketBadge bucket={row.original.bucket} />,
        size: 110,
        enableSorting: true,
      },
      {
        accessorKey: 'segment',
        id: 'segment',
        header: 'Segment',
        cell: ({ row }) => (
          <Badge variant="outline" size="sm" className="font-mono uppercase">
            {row.original.segment}
          </Badge>
        ),
        size: 130,
        enableSorting: true,
      },
      {
        accessorKey: 'importance',
        id: 'importance',
        header: ({ column }) => (
          <DataGridColumnHeader title="Importance" column={column} />
        ),
        cell: ({ row }) => <ImportanceBar value={row.original.importance} />,
        size: 140,
        enableSorting: true,
      },
      {
        accessorKey: 'cleanupVerdict',
        id: 'cleanupVerdict',
        header: 'Verdict',
        cell: ({ row }) => <VerdictBadge verdict={row.original.cleanupVerdict} />,
        size: 110,
        enableSorting: true,
      },
      {
        accessorKey: 'lastRecallAt',
        id: 'lastRecallAt',
        header: ({ column }) => (
          <DataGridColumnHeader title="Last recall" column={column} />
        ),
        cell: ({ row }) => (
          <span
            className="text-[12.5px] text-[var(--color-muted)]"
            suppressHydrationWarning
          >
            {formatRelative(row.original.lastRecallAt)}
          </span>
        ),
        size: 130,
        enableSorting: true,
      },
    ],
    [],
  );

  const table = useReactTable({
    columns,
    data: filteredRows,
    pageCount: Math.ceil((filteredRows.length || 0) / pagination.pageSize),
    getRowId: (row) => row.id,
    state: {
      pagination,
      sorting,
    },
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <>
      <Frame spacing="sm" className="bg-[var(--color-bg-2)]/60">
        <FrameHeader className="flex-row items-end justify-between">
          <FrameTitle className="text-[24px] font-medium tracking-tight">
            Memories
          </FrameTitle>
          <FrameDescription className="font-mono text-[10px] uppercase tracking-[0.2em]">
            {filteredRows.length === total
              ? `${total} memories`
              : `${filteredRows.length} of ${total}`}
          </FrameDescription>
        </FrameHeader>
        <FramePanel className="bg-[var(--color-surface-warm)] border-[var(--color-line)] p-3!">
          <div className="mb-3 flex items-start gap-2.5">
            <div className="flex-1">
              <Filters
                filters={filters}
                fields={fields}
                onChange={handleFiltersChange}
                size="sm"
                trigger={
                  <Button variant="outline" size="icon-sm">
                    <HugeiconsIcon icon={FilterIcon} strokeWidth={2} />
                  </Button>
                }
              />
            </div>
            {filters.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFilters([])}
              >
                <HugeiconsIcon icon={FilterRemoveIcon} strokeWidth={2} />
                Clear
              </Button>
            )}
          </div>

          <DataGrid
            table={table}
            recordCount={filteredRows.length}
            tableLayout={{ dense: true }}
            onRowClick={(row) => setOpenId(row.id)}
          >
            <div className="w-full space-y-2.5">
              <DataGridContainer>
                <ScrollArea>
                  <DataGridTable />
                  <ScrollBar orientation="horizontal" />
                </ScrollArea>
              </DataGridContainer>
              <DataGridPagination />
            </div>
          </DataGrid>
        </FramePanel>
      </Frame>

      <Dialog open={open !== null} onOpenChange={(v) => !v && setOpenId(null)}>
        <DialogContent className="max-w-2xl" showCloseButton={false}>
          <DialogHeader className="sr-only">
            <DialogTitle>Memory {open?.id.slice(0, 8) ?? ''}</DialogTitle>
            <DialogDescription>Full memory record.</DialogDescription>
          </DialogHeader>
          {open && <MemoryDetail row={open} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function MemoryDetail({ row }: { row: MemoryRow }) {
  return (
    <Frame spacing="sm">
      <FrameHeader className="px-2!">
        <FrameTitle className="font-mono text-[13px]">
          {row.id}
        </FrameTitle>
        <FrameDescription>Memory record</FrameDescription>
      </FrameHeader>
      <FramePanel className="p-3!">
        <p className="text-[13px] leading-relaxed text-[var(--color-ink)] whitespace-pre-wrap">
          {row.content}
        </p>
      </FramePanel>
      <FramePanel className="p-0!">
        <DetailTable>
          <DetailTableBody>
            <DetailRow label="Bucket">
              <BucketBadge bucket={row.bucket} />
            </DetailRow>
            <DetailRow label="Segment">
              <Badge variant="outline" size="sm" className="font-mono uppercase">
                {row.segment}
              </Badge>
            </DetailRow>
            <DetailRow label="Importance">
              <ImportanceBar value={row.importance} showNumber />
            </DetailRow>
            <DetailRow label="Cleanup verdict">
              <VerdictBadge verdict={row.cleanupVerdict} />
            </DetailRow>
            <DetailRow label="Access count">
              <span className="font-mono text-sm tabular-nums">
                {row.accessCount}
              </span>
            </DetailRow>
            <DetailRow label="Last recall">
              <span className="text-sm" suppressHydrationWarning>
                {formatExact(row.lastRecallAt)}
              </span>
            </DetailRow>
          </DetailTableBody>
        </DetailTable>
      </FramePanel>
    </Frame>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <DetailTableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
      <DetailTableCell className="bg-muted/50 w-44 py-2 text-sm font-medium">
        {label}
      </DetailTableCell>
      <DetailTableCell className="py-2">{children}</DetailTableCell>
    </DetailTableRow>
  );
}

function BucketBadge({ bucket }: { bucket: string }) {
  const variant =
    bucket === 'permanent'
      ? 'success-outline'
      : bucket === 'long'
        ? 'info-outline'
        : 'outline';
  return (
    <Badge variant={variant} size="sm" className="font-mono uppercase">
      {bucket}
    </Badge>
  );
}

function VerdictBadge({ verdict }: { verdict: string | null }) {
  if (!verdict) {
    return <span className="text-[var(--color-muted-2)]">—</span>;
  }
  const variant =
    verdict === 'promote'
      ? 'success-outline'
      : verdict === 'prune'
        ? 'destructive-outline'
        : verdict === 'merge'
          ? 'warning-outline'
          : 'outline';
  return (
    <Badge variant={variant} size="sm" className="font-mono uppercase">
      {verdict}
    </Badge>
  );
}

function ImportanceBar({ value, showNumber = false }: { value: number; showNumber?: boolean }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const color =
    pct >= 70 ? 'bg-green-500' : pct >= 40 ? 'bg-amber-500' : 'bg-zinc-400';
  return (
    <div className="flex items-center gap-2.5">
      <div className="bg-muted h-1.5 w-16 overflow-hidden rounded-full">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-muted-foreground font-mono text-[11px] tabular-nums">
        {value.toFixed(2)}
      </span>
      {showNumber && (
        <span className="text-muted-foreground text-[11px]">({pct}%)</span>
      )}
    </div>
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
