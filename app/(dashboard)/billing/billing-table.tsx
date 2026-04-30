'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  ColumnDef,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  PaginationState,
  SortingState,
  useReactTable,
} from '@tanstack/react-table';
import { Filter as FilterIcon, FilterX, User, Mail, Car, BadgeCheck } from 'lucide-react';

import {
  DataGrid,
  DataGridContainer,
} from '@/components/reui/data-grid/data-grid';
import { DataGridColumnHeader } from '@/components/reui/data-grid/data-grid-column-header';
import { DataGridPagination } from '@/components/reui/data-grid/data-grid-pagination';
import { DataGridTable } from '@/components/reui/data-grid/data-grid-table';
import {
  Filters,
  type Filter,
  type FilterFieldConfig,
} from '@/components/reui/filters';
import { Button } from '@/components/ui/button';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';

import type {
  InvoiceRow,
  InvoiceStatus,
  VehicleSegment,
} from '@/lib/dashboard/billing-queries';

const SEGMENT_TINT: Record<VehicleSegment, string> = {
  sedan: '#3a6ee0',
  suv: '#d68a26',
  van: '#1f9a83',
  truck: '#8a3ec0',
};
const SEGMENT_LABEL: Record<VehicleSegment, string> = {
  sedan: 'Sedan',
  suv: 'SUV',
  van: 'Van',
  truck: 'Truck',
};

type StatusVisual = {
  label: string;
  // pill: muted ink-tone background + matching text. Picked manually so they
  // sit calmly against the cream surface instead of fighting it.
  bg: string;
  fg: string;
  ring: string;
};
const STATUS_VISUAL: Record<InvoiceStatus, StatusVisual> = {
  paid: {
    label: 'Paid',
    bg: 'rgba(31, 154, 131, 0.10)',
    fg: '#0d4e43',
    ring: 'rgba(31, 154, 131, 0.35)',
  },
  pending: {
    label: 'Pending',
    bg: 'rgba(214, 138, 38, 0.10)',
    fg: '#7d4c08',
    ring: 'rgba(214, 138, 38, 0.35)',
  },
  draft: {
    label: 'Draft',
    bg: 'rgba(10, 10, 10, 0.05)',
    fg: '#3a3a36',
    ring: 'rgba(10, 10, 10, 0.16)',
  },
  cancelled: {
    label: 'Cancelled',
    bg: 'rgba(215, 25, 33, 0.08)',
    fg: '#7e1217',
    ring: 'rgba(215, 25, 33, 0.30)',
  },
};

function formatUsd(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  });
}

function getActiveFilters(filters: Filter[]): Filter[] {
  return filters.filter((f) => {
    if (!f.values || f.values.length === 0) return false;
    if (f.values.every((v) => typeof v === 'string' && v.trim() === '')) return false;
    return true;
  });
}

function applyFilters(rows: InvoiceRow[], filters: Filter[]): InvoiceRow[] {
  const active = getActiveFilters(filters);
  if (active.length === 0) return rows;
  return rows.filter((row) => {
    for (const f of active) {
      const value = (row as unknown as Record<string, unknown>)[f.field];
      const text = String(value ?? '').toLowerCase();
      const targets = f.values.map((v) => String(v).toLowerCase());
      switch (f.operator) {
        case 'is':
        case 'equals':
          if (!targets.includes(text)) return false;
          break;
        case 'is_not':
        case 'not_equals':
          if (targets.includes(text)) return false;
          break;
        case 'contains':
          if (!targets.some((t) => text.includes(t))) return false;
          break;
        case 'not_contains':
          if (targets.some((t) => text.includes(t))) return false;
          break;
        default:
          if (!targets.includes(text)) return false;
      }
    }
    return true;
  });
}

export function BillingTable({ rows }: { rows: InvoiceRow[] }) {
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'dueAtIso', desc: false },
  ]);
  // Default to no filter so the table loads with everything visible. Operators
  // narrow down themselves via "Add filter".
  const [filters, setFilters] = useState<Filter[]>([]);

  const filtered = useMemo(() => applyFilters(rows, filters), [rows, filters]);

  const fields: FilterFieldConfig[] = useMemo(
    () => [
      {
        key: 'customerName',
        label: 'Customer',
        icon: <User className="size-3.5" strokeWidth={2} />,
        type: 'text',
        className: 'w-44',
        placeholder: 'Search by name',
      },
      {
        key: 'customerEmail',
        label: 'Email',
        icon: <Mail className="size-3.5" strokeWidth={2} />,
        type: 'text',
        className: 'w-52',
        placeholder: 'name@company.com',
      },
      {
        key: 'status',
        label: 'Status',
        icon: <BadgeCheck className="size-3.5" strokeWidth={2} />,
        type: 'select',
        searchable: false,
        className: 'w-40',
        options: (Object.keys(STATUS_VISUAL) as InvoiceStatus[]).map((s) => ({
          value: s,
          label: STATUS_VISUAL[s].label,
          icon: (
            <div
              className="size-2 rounded-full"
              style={{ backgroundColor: STATUS_VISUAL[s].fg }}
            />
          ),
        })),
      },
      {
        key: 'vehicleSegment',
        label: 'Segment',
        icon: <Car className="size-3.5" strokeWidth={2} />,
        type: 'select',
        searchable: false,
        className: 'w-40',
        options: (Object.keys(SEGMENT_TINT) as VehicleSegment[]).map((s) => ({
          value: s,
          label: SEGMENT_LABEL[s],
          icon: (
            <div
              className="size-2 rounded-full"
              style={{ backgroundColor: SEGMENT_TINT[s] }}
            />
          ),
        })),
      },
      {
        key: 'vehiclePlate',
        label: 'Plate',
        icon: <Car className="size-3.5" strokeWidth={2} />,
        type: 'text',
        className: 'w-36',
        placeholder: 'B-AR 1234',
      },
    ],
    [],
  );

  const handleFiltersChange = useCallback((next: Filter[]) => {
    setFilters(next);
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, []);

  const columns = useMemo<ColumnDef<InvoiceRow>[]>(
    () => [
      {
        accessorKey: 'shortId',
        id: 'shortId',
        header: ({ column }) => <DataGridColumnHeader title="Invoice" column={column} />,
        cell: ({ row }) => (
          <span className="font-mono text-[11px] tracking-tight text-[var(--color-muted)]">
            {row.original.shortId}
          </span>
        ),
        size: 100,
        enableSorting: true,
        meta: { skeleton: <Skeleton className="h-4 w-16" /> },
      },
      {
        accessorKey: 'customerName',
        id: 'customerName',
        header: ({ column }) => <DataGridColumnHeader title="Customer" column={column} />,
        cell: ({ row }) => (
          <div className="space-y-px">
            <div className="text-[13px] font-medium tracking-tight text-[var(--color-ink)]">
              {row.original.customerName}
            </div>
            <div className="font-mono text-[10.5px] text-[var(--color-muted)]">
              {row.original.customerEmail}
            </div>
          </div>
        ),
        size: 220,
        enableSorting: true,
        meta: {
          skeleton: (
            <div className="space-y-1">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-20" />
            </div>
          ),
        },
      },
      {
        accessorKey: 'vehicleSegment',
        id: 'vehicleSegment',
        header: ({ column }) => <DataGridColumnHeader title="Vehicle" column={column} />,
        cell: ({ row }) => {
          const seg = row.original.vehicleSegment;
          return (
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden
                className="size-2.5 rounded-[3px]"
                style={{ backgroundColor: SEGMENT_TINT[seg] }}
              />
              <div className="min-w-0">
                <div className="font-mono text-[11.5px] tracking-tight text-[var(--color-ink)]">
                  {row.original.vehiclePlate || SEGMENT_LABEL[seg]}
                </div>
                <div className="text-[10.5px] text-[var(--color-muted)]">
                  {row.original.vehicleLabel || SEGMENT_LABEL[seg]}
                </div>
              </div>
            </div>
          );
        },
        size: 180,
        enableSorting: true,
        meta: {
          skeleton: (
            <div className="flex items-center gap-2">
              <Skeleton className="size-2.5 rounded-sm" />
              <Skeleton className="h-4 w-24" />
            </div>
          ),
        },
      },
      {
        accessorKey: 'status',
        id: 'status',
        header: ({ column }) => <DataGridColumnHeader title="Status" column={column} />,
        cell: ({ row }) => {
          const v = STATUS_VISUAL[row.original.status];
          return (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] ring-1"
              style={{ backgroundColor: v.bg, color: v.fg, '--tw-ring-color': v.ring } as React.CSSProperties}
            >
              <span
                aria-hidden
                className="size-1.5 rounded-full"
                style={{ backgroundColor: v.fg }}
              />
              {v.label}
              {row.original.isOverdue && (
                <span className="ml-0.5 text-[var(--color-red)]">·overdue</span>
              )}
            </span>
          );
        },
        size: 140,
        enableSorting: true,
        meta: { skeleton: <Skeleton className="h-5 w-20 rounded-full" /> },
      },
      {
        accessorKey: 'totalUsd',
        id: 'totalUsd',
        header: ({ column }) => (
          <DataGridColumnHeader title="Total" column={column} />
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-[12.5px] font-semibold tabular-nums tracking-tight text-[var(--color-ink)]">
            {formatUsd(row.original.totalUsd)}
          </div>
        ),
        size: 110,
        enableSorting: true,
        meta: {
          headerClassName: 'text-right',
          cellClassName: 'text-right',
          skeleton: <Skeleton className="ml-auto h-4 w-16" />,
        },
      },
      {
        accessorKey: 'dueAtIso',
        id: 'dueAtIso',
        header: ({ column }) => <DataGridColumnHeader title="Due" column={column} />,
        cell: ({ row }) => (
          <span className="font-mono text-[11px] tabular-nums text-[var(--color-muted)]">
            {formatDate(row.original.dueAtIso)}
          </span>
        ),
        size: 110,
        enableSorting: true,
        meta: { skeleton: <Skeleton className="h-4 w-16" /> },
      },
      {
        accessorKey: 'paidAtIso',
        id: 'paidAtIso',
        header: ({ column }) => <DataGridColumnHeader title="Paid" column={column} />,
        cell: ({ row }) => (
          <span className="font-mono text-[11px] tabular-nums text-[var(--color-muted)]">
            {row.original.paidAtIso ? formatDate(row.original.paidAtIso) : ''}
          </span>
        ),
        size: 110,
        enableSorting: true,
        meta: { skeleton: <Skeleton className="h-4 w-16" /> },
      },
    ],
    [],
  );

  const [columnOrder, setColumnOrder] = useState<string[]>(
    columns.map((c) => c.id as string),
  );

  const table = useReactTable({
    columns,
    data: filtered,
    pageCount: Math.ceil((filtered.length || 0) / pagination.pageSize),
    getRowId: (row) => row.id,
    state: { pagination, sorting, columnOrder },
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    onColumnOrderChange: setColumnOrder,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const activeCount = getActiveFilters(filters).length;

  return (
    <div className="w-full space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-2 overflow-x-auto">
          <Filters
            filters={filters}
            fields={fields}
            onChange={handleFiltersChange}
            size="sm"
            trigger={
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 rounded-full border-[var(--color-line-strong)] bg-[var(--color-surface)]/60 px-3 font-mono text-[10.5px] uppercase tracking-[0.18em] text-[var(--color-ink)] hover:bg-[var(--color-surface)]"
              >
                <FilterIcon className="size-3.5" strokeWidth={2} />
                Add filter
              </Button>
            }
          />
          {activeCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFilters([])}
              className="h-8 gap-1.5 rounded-full border-[var(--color-line)] bg-transparent px-3 font-mono text-[10.5px] uppercase tracking-[0.18em] text-[var(--color-muted)] hover:bg-[var(--color-surface)]"
            >
              <FilterX className="size-3.5" strokeWidth={2} />
              Clear
            </Button>
          )}
        </div>
        <div className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-[var(--color-muted)] tabular-nums">
          <span className="text-[var(--color-ink)]">{filtered.length}</span> /{' '}
          {rows.length} invoices
        </div>
      </div>

      <DataGrid
        table={table}
        recordCount={filtered.length}
        tableLayout={{ dense: true, headerBackground: true, headerBorder: true }}
        tableClassNames={{
          base: 'bg-transparent',
          header: 'bg-transparent',
          headerRow: 'border-b border-[var(--color-line)]',
          bodyRow:
            'border-b border-[var(--color-line)] last:border-b-0 hover:bg-[var(--color-surface)]/55 transition-colors',
        }}
      >
        <div className="space-y-2.5">
          <DataGridContainer
            border={false}
            className="overflow-hidden rounded-[10px] border border-[var(--color-line)] bg-[var(--color-surface)]/40"
          >
            <ScrollArea>
              <DataGridTable />
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </DataGridContainer>
          <DataGridPagination />
        </div>
      </DataGrid>
    </div>
  );
}
