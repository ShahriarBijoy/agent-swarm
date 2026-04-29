import { db } from '@/db/client';
import { invoices, customers } from '@/db/schema/domain';
import { desc, eq, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export default async function BillingPage() {
  const pending = await db
    .select()
    .from(invoices)
    .where(sql`${invoices.status} IN ('draft','pending')`)
    .orderBy(desc(invoices.dueAt))
    .limit(20);
  const paid = await db
    .select()
    .from(invoices)
    .where(eq(invoices.status, 'paid'))
    .orderBy(desc(invoices.paidAt))
    .limit(20);
  const top = await db
    .select({
      name: customers.name,
      email: customers.email,
      spend: sql<number>`coalesce(sum(${invoices.totalUsd}::numeric), 0)`,
    })
    .from(customers)
    .leftJoin(invoices, eq(invoices.customerId, customers.id))
    .groupBy(customers.id)
    .orderBy(
      sql`coalesce(sum(${invoices.totalUsd}::numeric), 0) desc`,
    )
    .limit(10);

  return (
    <div className="space-y-12 py-8">
      <h1 className="text-xl font-semibold">Billing</h1>
      <section>
        <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-400">
          Pending
        </h2>
        <BillingTable rows={pending} />
      </section>
      <section>
        <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-400">
          Paid (recent)
        </h2>
        <BillingTable rows={paid} />
      </section>
      <section>
        <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-400">
          Top customers
        </h2>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-neutral-400">
              <th className="pb-1">Customer</th>
              <th className="pb-1">Email</th>
              <th className="pb-1 text-right">Total spend</th>
            </tr>
          </thead>
          <tbody>
            {top.map((c) => (
              <tr key={c.email} className="border-t border-neutral-100 dark:border-[#1F1F21]">
                <td className="py-1.5">{c.name}</td>
                <td className="py-1.5 font-mono text-xs text-neutral-500">{c.email}</td>
                <td className="py-1.5 text-right tabular-nums">${Number(c.spend).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function BillingTable({
  rows,
}: {
  rows: Array<typeof invoices.$inferSelect>;
}) {
  if (rows.length === 0) {
    return (
      <p className="mt-3 text-sm text-neutral-400">No invoices.</p>
    );
  }
  return (
    <table className="mt-3 w-full text-sm">
      <thead>
        <tr className="text-left text-neutral-400">
          <th className="pb-1">Invoice</th>
          <th className="pb-1">Status</th>
          <th className="pb-1">Total</th>
          <th className="pb-1">Due</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t border-neutral-100 dark:border-[#1F1F21]">
            <td className="py-1.5 font-mono text-xs">
              {r.id.slice(0, 8)}
            </td>
            <td className="py-1.5">
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                r.status === 'paid'
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                  : r.status === 'pending'
                    ? 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400'
                    : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'
              }`}>
                {r.status}
              </span>
            </td>
            <td className="py-1.5">${Number(r.totalUsd).toFixed(2)}</td>
            <td className="py-1.5">
              {r.dueAt.toISOString().slice(0, 10)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
