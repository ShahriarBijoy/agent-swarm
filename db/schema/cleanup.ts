import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { cleanupActionEnum } from './enums';
import { memories } from './memories';

export const memoryCleanupRuns = pgTable(
  'memory_cleanup_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    status: text('status').notNull().default('running'),
    candidatesConsidered: integer('candidates_considered').notNull().default(0),
    proposalsGenerated: integer('proposals_generated').notNull().default(0),
    proposalsContested: integer('proposals_contested').notNull().default(0),
    proposalsJudged: integer('proposals_judged').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 10, scale: 4 })
      .notNull()
      .default('0'),
    error: text('error'),
  },
  (t) => [
    check(
      'memory_cleanup_runs_status_check',
      sql`${t.status} IN ('running','completed','failed')`,
    ),
  ],
);

export const memoryCleanupProposals = pgTable(
  'memory_cleanup_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => memoryCleanupRuns.id, { onDelete: 'cascade' }),
    memoryId: uuid('memory_id')
      .notNull()
      .references(() => memories.id),
    targetMemoryId: uuid('target_memory_id').references(() => memories.id),
    action: cleanupActionEnum('action').notNull(),
    finalAction: cleanupActionEnum('final_action'),
    consolidator: jsonb('consolidator').notNull(),
    adversary: jsonb('adversary'),
    judge: jsonb('judge'),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('memory_cleanup_proposals_run_idx').on(t.runId),
    index('memory_cleanup_proposals_memory_idx').on(t.memoryId),
    index('memory_cleanup_proposals_applied_idx').on(t.appliedAt),
  ],
);
