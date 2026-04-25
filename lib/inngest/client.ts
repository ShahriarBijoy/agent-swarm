import { EventSchemas, Inngest } from 'inngest';
import type { ApprovalDecidedData, TaskStartedData } from './events';
import { APPROVAL_DECIDED, TASK_STARTED } from './events';

/**
 * Inngest event registry. We use `fromRecord` (TS-types only) instead of
 * `fromZod` because inngest 3.x's zod adapter still expects the zod-3
 * `_def.typeName` shape; we're on zod 4 (no `typeName`). Validation at the
 * boundary still happens via the schemas in events.ts — the route handler
 * and Server Action call `taskStartedSchema.parse` / `approvalDecidedSchema
 * .parse` before invoking `inngest.send`.
 */
type AutoRideEvents = {
  [TASK_STARTED]: { data: TaskStartedData };
  [APPROVAL_DECIDED]: { data: ApprovalDecidedData };
};

/**
 * Singleton Inngest client for the auto-ride app. Imported by the route
 * handler (`app/api/inngest/route.ts`), the runner (`lib/runner/start-task.ts`),
 * and the approval Server Action (`app/tasks/[id]/actions.ts`).
 *
 * The client auto-detects local vs cloud:
 * - In dev, the inngest-cli dev server (run via `pnpm inngest:dev`) discovers
 *   the function on `http://localhost:3000/api/inngest` and routes events
 *   to it. No env vars needed.
 * - In prod (phase 12), `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` switch
 *   to the cloud broker.
 */
export const inngest = new Inngest({
  id: 'auto-ride',
  schemas: new EventSchemas().fromRecord<AutoRideEvents>(),
});

export type AutoRideInngest = typeof inngest;
