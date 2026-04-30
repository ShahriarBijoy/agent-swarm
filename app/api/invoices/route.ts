import { NextRequest } from 'next/server';
import { db } from '@/db/client';
import { invoices } from '@/db/schema/domain';
import { eq, desc } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status');
  const query = db.select().from(invoices).orderBy(desc(invoices.createdAt)).limit(50);
  if (status === 'draft' || status === 'pending' || status === 'paid' || status === 'cancelled') {
    const rows = await query.where(eq(invoices.status, status));
    return Response.json({ invoices: rows });
  }
  const rows = await query;
  return Response.json({ invoices: rows });
}
