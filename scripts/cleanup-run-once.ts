// Run with: pnpm cleanup:run-once
// Sends auto-ride/cleanup.requested. Inngest dev server picks it up and
// invokes memoryCleanupFn locally.
import { inngest } from '@/lib/inngest/client';
import { CLEANUP_REQUESTED, cleanupRequestedSchema } from '@/lib/inngest/events';

async function main() {
  const data = cleanupRequestedSchema.parse({
    reason: process.env.CLEANUP_REASON ?? 'manual-cli',
  });
  const sent = await inngest.send({ name: CLEANUP_REQUESTED, data });
  console.log('[cleanup] event sent:', sent.ids[0]);
  console.log('[cleanup] watch the run in the Inngest dev UI: http://localhost:8288');
}

main().catch((err) => {
  console.error('[cleanup] error:', err);
  process.exit(1);
});
