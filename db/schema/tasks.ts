import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { taskStatusEnum } from './enums';
import { conversations } from './conversations';

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    prompt: text('prompt').notNull(),
    status: taskStatusEnum('status').notNull().default('queued'),
    createdBy: text('created_by'),
    // Phase 11.5 — optional link to a chat conversation. Tasks created from
    // the chat surface set this; CLI / smoke-test tasks leave it null.
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'set null',
    }),
    maxBudgetUsd: numeric('max_budget_usd', { precision: 10, scale: 4 }),
    maxTurns: integer('max_turns'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [
    index('tasks_status_idx').on(t.status),
    index('tasks_created_at_idx').on(t.createdAt.desc()),
    index('tasks_conversation_id_idx').on(t.conversationId),
  ],
);

export const taskRuns = pgTable(
  'task_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    attempt: integer('attempt').notNull().default(1),
    status: taskStatusEnum('status').notNull().default('in_progress'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    totalCostUsd: numeric('total_cost_usd', { precision: 10, scale: 4 })
      .notNull()
      .default('0'),
    totalInputTokens: integer('total_input_tokens').notNull().default(0),
    totalOutputTokens: integer('total_output_tokens').notNull().default(0),
    error: text('error'),
    sessionId: text('session_id'),
  },
  (t) => [
    index('task_runs_task_idx').on(t.taskId),
    uniqueIndex('task_runs_task_attempt_uq').on(t.taskId, t.attempt),
  ],
);

export const taskEvents = pgTable(
  'task_events',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => taskRuns.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    seq: integer('seq').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('task_events_task_id_idx').on(t.taskId, t.id),
    uniqueIndex('task_events_run_seq_uq').on(t.runId, t.seq),
    check(
      'task_events_type_check',
      sql`${t.type} IN ('assistant_turn','tool_call','tool_result','approval_request','compact_boundary','run_result','user_message')`,
    ),
  ],
);
