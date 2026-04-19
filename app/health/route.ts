import { ping, checkExtension } from '@/db/client';
import pkg from '../../package.json';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [db, vector] = await Promise.all([
    ping(),
    checkExtension('vector'),
  ]);
  const ok = db === 'up' && vector === 'installed';
  return Response.json(
    {
      ok,
      version: pkg.version,
      checks: { db, vector },
      ts: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 },
  );
}
