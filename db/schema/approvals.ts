import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { approvalStatusEnum } from './enums';
import { taskRuns, tasks } from './tasks';

export const approvalGates = pgTable(
  'approval_gates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => taskRuns.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    toolName: text('tool_name').notNull(),
    proposedInput: jsonb('proposed_input').notNull(),
    status: approvalStatusEnum('status').notNull().default('pending'),
    resolutionInput: jsonb('resolution_input'),
    reviewerNote: text('reviewer_note'),
    reviewerId: text('reviewer_id'),
    inngestEventKey: text('inngest_event_key'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    timedOutAt: timestamp('timed_out_at', { withTimezone: true }),
  },
  (t) => [
    index('approval_gates_run_idx').on(t.runId),
    index('approval_gates_status_idx').on(t.status),
  ],
);
