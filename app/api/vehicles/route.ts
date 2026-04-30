import { NextRequest } from 'next/server';
import { queryVehicles } from '@/db/queries/domain';
import { auth } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const args: Parameters<typeof queryVehicles>[0] = {};
  const status = sp.get('status');
  if (status === 'available' || status === 'in-use' || status === 'maintenance') {
    args.status = status;
  }
  const seg = sp.get('segment');
  if (seg === 'sedan' || seg === 'suv' || seg === 'van' || seg === 'truck') {
    args.segment = seg;
  }
  const seatsMin = sp.get('seats_min');
  if (seatsMin) {
    const n = parseInt(seatsMin, 10);
    if (!Number.isNaN(n)) args.seats_min = n;
  }
  const rangeMin = sp.get('range_min_km');
  if (rangeMin) {
    const n = parseInt(rangeMin, 10);
    if (!Number.isNaN(n)) args.range_min_km = n;
  }
  const rows = await queryVehicles(args);
  return Response.json({ vehicles: rows });
}
