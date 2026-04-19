import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { env } from '@/lib/env';
import * as schema from './schema';

const sql = neon(env.DATABASE_URL);
export const db = drizzle(sql, { schema });

/** Returns 'up' if SELECT 1 resolves within 2s, else 'down'. */
export async function ping(): Promise<'up' | 'down'> {
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('ping timeout')), 2000),
    );
    await Promise.race([sql`SELECT 1`, timeout]);
    return 'up';
  } catch {
    return 'down';
  }
}

/** Returns 'installed' if pg_extension has a row matching `name`, else 'missing'. */
export async function checkExtension(
  name: string,
): Promise<'installed' | 'missing'> {
  try {
    const rows = (await sql`
      SELECT 1 FROM pg_extension WHERE extname = ${name}
    `) as unknown[];
    return rows.length > 0 ? 'installed' : 'missing';
  } catch {
    return 'missing';
  }
}
