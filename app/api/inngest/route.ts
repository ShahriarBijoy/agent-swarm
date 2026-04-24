import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { taskStartedFn } from '@/lib/inngest/functions';

/**
 * Serves the auto-ride Inngest functions. The dev server
 * (`pnpm inngest:dev` → `npx inngest-cli@latest dev`) discovers this URL,
 * registers the functions, and routes `inngest.send()` events to them.
 *
 * `force-dynamic` is required because Next.js otherwise tries to cache the
 * GET introspection response.
 */
export const dynamic = 'force-dynamic';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [taskStartedFn],
});
