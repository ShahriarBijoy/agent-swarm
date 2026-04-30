// lib/dashboard/billing-queries.ts
import { db } from '@/db/client';
import { invoices, customers, trips, vehicles } from '@/db/schema/domain';
import { desc, eq, sql } from 'drizzle-orm';

export type InvoiceStatus = 'draft' | 'pending' | 'paid' | 'cancelled';
export type VehicleSegment = 'sedan' | 'suv' | 'van' | 'truck';

/**
 * Single hydrated invoice row used by the billing table. We flatten the
 * customer + trip + vehicle joins so the client filter/sort layer can operate
 * on plain primitives without needing nested object accessors.
 */
export type InvoiceRow = {
  id: string;
  shortId: string;
  customerName: string;
  customerEmail: string;
  vehiclePlate: string;
  vehicleSegment: VehicleSegment;
  vehicleLabel: string;
  status: InvoiceStatus;
  amountUsd: number;
  taxUsd: number;
  totalUsd: number;
  createdAtIso: string;
  dueAtIso: string;
  paidAtIso: string | null;
  isOverdue: boolean;
};

export type BillingKpis = {
  outstandingUsd: number;
  paidThisMonthUsd: number;
  openCount: number;
  pendingCount: number;
  draftCount: number;
  overdueCount: number;
  paidCount: number;
};

export type TopCustomer = {
  name: string;
  email: string;
  spendUsd: number;
  invoiceCount: number;
};

export async function getInvoiceRows(limit = 200): Promise<InvoiceRow[]> {
  const now = Date.now();
  const rows = await db
    .select({
      id: invoices.id,
      status: invoices.status,
      amountUsd: invoices.amountUsd,
      taxUsd: invoices.taxUsd,
      totalUsd: invoices.totalUsd,
      createdAt: invoices.createdAt,
      dueAt: invoices.dueAt,
      paidAt: invoices.paidAt,
      customerName: customers.name,
      customerEmail: customers.email,
      vehiclePlate: vehicles.plate,
      vehicleSegment: vehicles.segment,
      vehicleMake: vehicles.make,
      vehicleModel: vehicles.model,
    })
    .from(invoices)
    .leftJoin(customers, eq(invoices.customerId, customers.id))
    .leftJoin(trips, eq(invoices.tripId, trips.id))
    .leftJoin(vehicles, eq(trips.vehicleId, vehicles.id))
    .orderBy(desc(invoices.createdAt))
    .limit(limit);

  return rows.map((r) => {
    const dueAtMs = r.dueAt ? new Date(r.dueAt).getTime() : 0;
    const isOverdue =
      r.status === 'pending' && dueAtMs > 0 && dueAtMs < now;
    return {
      id: r.id,
      shortId: r.id.slice(0, 8).toUpperCase(),
      customerName: r.customerName ?? 'unknown',
      customerEmail: r.customerEmail ?? '',
      vehiclePlate: r.vehiclePlate ?? '',
      vehicleSegment: (r.vehicleSegment ?? 'sedan') as VehicleSegment,
      vehicleLabel: r.vehicleMake && r.vehicleModel
        ? `${r.vehicleMake} ${r.vehicleModel}`
        : '',
      status: r.status as InvoiceStatus,
      amountUsd: Number(r.amountUsd ?? 0),
      taxUsd: Number(r.taxUsd ?? 0),
      totalUsd: Number(r.totalUsd ?? 0),
      createdAtIso: (r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt as unknown as string)).toISOString(),
      dueAtIso: (r.dueAt instanceof Date ? r.dueAt : new Date(r.dueAt as unknown as string)).toISOString(),
      paidAtIso: r.paidAt
        ? (r.paidAt instanceof Date ? r.paidAt : new Date(r.paidAt as unknown as string)).toISOString()
        : null,
      isOverdue,
    };
  });
}

type KpiRow = {
  outstanding: string;
  paid_month: string;
  pending_ct: number;
  draft_ct: number;
  overdue_ct: number;
  paid_ct: number;
};

function toRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as T[];
  }
  return [];
}

export async function getBillingKpis(): Promise<BillingKpis> {
  const result = await db.execute(sql`
    SELECT
      coalesce(sum(${invoices.totalUsd}::numeric)
        FILTER (WHERE ${invoices.status} IN ('pending','draft')), 0) AS outstanding,
      coalesce(sum(${invoices.totalUsd}::numeric)
        FILTER (WHERE ${invoices.status} = 'paid'
          AND ${invoices.paidAt} >= date_trunc('month', now())), 0) AS paid_month,
      coalesce(count(*)
        FILTER (WHERE ${invoices.status} = 'pending'), 0)::int AS pending_ct,
      coalesce(count(*)
        FILTER (WHERE ${invoices.status} = 'draft'), 0)::int AS draft_ct,
      coalesce(count(*)
        FILTER (WHERE ${invoices.status} = 'pending'
          AND ${invoices.dueAt} < now()), 0)::int AS overdue_ct,
      coalesce(count(*) FILTER (WHERE ${invoices.status} = 'paid'), 0)::int AS paid_ct
    FROM ${invoices}
  `);
  const agg = toRows<KpiRow>(result)[0];
  const pending = Number(agg?.pending_ct ?? 0);
  const draft = Number(agg?.draft_ct ?? 0);
  return {
    outstandingUsd: Number(agg?.outstanding ?? 0),
    paidThisMonthUsd: Number(agg?.paid_month ?? 0),
    openCount: pending + draft,
    pendingCount: pending,
    draftCount: draft,
    overdueCount: Number(agg?.overdue_ct ?? 0),
    paidCount: Number(agg?.paid_ct ?? 0),
  };
}

export async function getTopCustomers(limit = 8): Promise<TopCustomer[]> {
  const rows = await db
    .select({
      name: customers.name,
      email: customers.email,
      spend: sql<string>`coalesce(sum(${invoices.totalUsd}::numeric), 0)`,
      count: sql<number>`coalesce(count(${invoices.id}), 0)::int`,
    })
    .from(customers)
    .leftJoin(invoices, eq(invoices.customerId, customers.id))
    .groupBy(customers.id)
    .orderBy(sql`coalesce(sum(${invoices.totalUsd}::numeric), 0) desc`)
    .limit(limit);
  return rows.map((r) => ({
    name: r.name,
    email: r.email,
    spendUsd: Number(r.spend ?? 0),
    invoiceCount: Number(r.count ?? 0),
  }));
}
