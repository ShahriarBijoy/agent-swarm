import { NextRequest } from 'next/server';
import { db } from '@/db/client';
import { trips, vehicles, customers } from '@/db/schema/domain';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const status = req.nextUrl.searchParams.get('status') ?? 'in-route';
  const rows = await db
    .select({
      trip: trips,
      vehicle: vehicles,
      customer: customers,
    })
    .from(trips)
    .leftJoin(vehicles, eq(trips.vehicleId, vehicles.id))
    .leftJoin(customers, eq(trips.customerId, customers.id))
    .where(eq(trips.status, status as 'requested' | 'confirmed' | 'in-route' | 'completed' | 'cancelled'));
  return Response.json({ trips: rows });
}
