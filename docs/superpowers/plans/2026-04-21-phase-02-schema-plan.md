# Phase 02 — Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the full Auto-ride data model — 9 tables, 6 enums, the three critical indexes on `memories`, and 7 seeded segment-config rows — so phase 03 can query and phase 04/05/06/07 can write against a stable schema.

**Architecture:** Drizzle schema split by domain (`memories`, `cleanup`, `tasks`, `approvals`) with shared `enums.ts` and `types.ts`. Two new migrations: auto-generated DDL (`0001_core_schema.sql`) and custom idempotent seeds (`0002_seed_segment_config.sql`). Custom tsvector type + HNSW partial index declared in the Drizzle schema itself — no raw SQL monkey-patching needed.

**Tech Stack (unchanged from phase 01):** `drizzle-orm@^0.45.2`, `drizzle-kit@^0.31.10`, `postgres@^3.4.9`, `@neondatabase/serverless@^1.1.0`, `zod@^4`, `vitest@^4`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-21-phase-02-schema-design.md`
**Roadmap entry:** `docs/roadmap/ROADMAP.md` — phase 02

---

## Prerequisites (one-time, before Task 1)

- Phase 01 merged to `main` (commit `1cc267b` or later — merge of PR #1).
- Local `main` fast-forwarded to `origin/main`.
- Neon project reachable; `DATABASE_URL_UNPOOLED` in the developer's `.env.local` for migration.
- Phase 02 spec + plan committed to `main` (this file lands first as a small docs commit before Task 1 runs).
- The existing phase-01 worktree at `.worktree/phase-01-scaffold/` can stay — it will not conflict with phase-02.

---

## Task 1 — Create phase 02 worktree

**Files:** git plumbing only.

- [ ] **Step 1: From the main checkout, confirm clean main**

  ```bash
  git switch main
  git pull --ff-only origin main
  git status
  ```
  Expected: `On branch main`, `nothing to commit, working tree clean`, `Your branch is up to date with 'origin/main'.`

- [ ] **Step 2: Create worktree + branch**

  ```bash
  git worktree add .worktree/phase-02-schema -b phase/02-schema
  ```
  Expected: `Preparing worktree (new branch 'phase/02-schema')`.

- [ ] **Step 3: Set repo-local git identity in the new worktree**

  ```bash
  cd .worktree/phase-02-schema
  git config user.name  "shahriarbijoy"
  git config user.email "shahriarbijoy@gmail.com"
  git config user.name && git config user.email
  ```
  Expected stdout:
  ```
  shahriarbijoy
  shahriarbijoy@gmail.com
  ```

- [ ] **Step 4: Copy `.env.local` into the worktree**

  The worktree does not inherit the main checkout's `.env.local`. Copy it so `pnpm db:migrate` and tests can find `DATABASE_URL_UNPOOLED`:
  ```bash
  cp ../../.env.local .env.local   # or create fresh from .env.example
  ```
  Verify `DATABASE_URL` and `DATABASE_URL_UNPOOLED` are present. Do not commit.

- [ ] **Step 5: Install dependencies in the new worktree**

  Node_modules do not share across worktrees:
  ```bash
  pnpm install
  ```
  Expected: matches `pnpm-lock.yaml`, no lockfile churn.

- [ ] **Step 6: Push the new branch to origin**

  ```bash
  git push -u origin phase/02-schema
  ```
  Expected: `Branch 'phase/02-schema' set up to track remote branch 'phase/02-schema' from 'origin'.`

No commit yet — the branch starts at main's HEAD.

---

## Task 2 — Define shared enums and the tsvector custom type

**Files:**
- `db/schema/enums.ts` (new)
- `db/schema/types.ts` (new)

- [ ] **Step 1: Write `db/schema/enums.ts`**

  Six `pgEnum` declarations:
  ```ts
  import { pgEnum } from 'drizzle-orm/pg-core';

  export const segmentEnum = pgEnum('segment', [
    'identity',
    'correction',
    'preference',
    'relationship',
    'knowledge',
    'behavioral',
    'context',
  ]);

  export const bucketEnum = pgEnum('bucket', ['short', 'long', 'permanent']);

  export const taskStatusEnum = pgEnum('task_status', [
    'queued',
    'in_progress',
    'awaiting_approval',
    'done',
    'failed',
    'cancelled',
  ]);

  export const approvalStatusEnum = pgEnum('approval_status', [
    'pending',
    'approved',
    'modified',
    'denied',
    'timed_out',
  ]);

  export const cleanupActionEnum = pgEnum('cleanup_action', [
    'promote',
    'prune',
    'merge',
    'keep',
  ]);

  export const linkTypeEnum = pgEnum('link_type', ['merged', 'superseded']);
  ```

- [ ] **Step 2: Write `db/schema/types.ts`**

  Custom `tsvector` type:
  ```ts
  import { customType } from 'drizzle-orm/pg-core';

  export const tsvector = customType<{ data: string; notNull: true }>({
    dataType() {
      return 'tsvector';
    },
  });
  ```

- [ ] **Step 3: Typecheck**
  ```bash
  pnpm typecheck
  ```
  Expected: passes. `db/schema/index.ts` still has the placeholder `export {};` and is unaffected.

- [ ] **Commit:**
  ```bash
  git add db/schema/enums.ts db/schema/types.ts
  git commit -m "feat(phase-02): enums and tsvector custom type"
  ```

---

## Task 3 — Define `memories`, `memory_segment_config`, `memory_links`

**Files:**
- `db/schema/memories.ts` (new)

- [ ] **Step 1: Write the schema**

  Uses the APIs confirmed in the spec: `vector({ dimensions: 1536 })`, `tsvector(...).generatedAlwaysAs(sql\`...\`)`, `index(...).using('hnsw', col.op('vector_cosine_ops')).with({ m, ef_construction }).where(sql\`tombstoned_at IS NULL\`)`.

  ```ts
  import { sql } from 'drizzle-orm';
  import {
    pgTable,
    uuid,
    text,
    vector,
    numeric,
    integer,
    timestamp,
    jsonb,
    boolean,
    doublePrecision,
    index,
    uniqueIndex,
  } from 'drizzle-orm/pg-core';
  import { bucketEnum, linkTypeEnum, segmentEnum } from './enums';
  import { tsvector } from './types';

  export const memorySegmentConfig = pgTable('memory_segment_config', {
    segment: segmentEnum('segment').primaryKey(),
    defaultImportance: numeric('default_importance', { precision: 3, scale: 2 }).notNull(),
    decayLambdaShort: doublePrecision('decay_lambda_short').notNull(),
    decayLambdaLongFactor: doublePrecision('decay_lambda_long_factor')
      .notNull()
      .default(0.01),
    promotionThresholdLong: numeric('promotion_threshold_long', {
      precision: 3,
      scale: 2,
    })
      .notNull()
      .default('0.50'),
    promotionThresholdPermanent: numeric('promotion_threshold_permanent', {
      precision: 3,
      scale: 2,
    })
      .notNull()
      .default('0.80'),
    fastTrackPermanent: boolean('fast_track_permanent').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  });

  export const memories = pgTable(
    'memories',
    {
      id: uuid('id').primaryKey().defaultRandom(),
      segment: segmentEnum('segment').notNull(),
      bucket: bucketEnum('bucket').notNull().default('short'),
      content: text('content').notNull(),
      contentTsv: tsvector('content_tsv').generatedAlwaysAs(
        (): any => sql`to_tsvector('english', ${memories.content})`,
      ),
      embedding: vector('embedding', { dimensions: 1536 }),
      importance: numeric('importance', { precision: 3, scale: 2 }).notNull(),
      importanceStreak: integer('importance_streak').notNull().default(0),
      accessCount: integer('access_count').notNull().default(0),
      createdAt: timestamp('created_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
      lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
      tombstonedAt: timestamp('tombstoned_at', { withTimezone: true }),
      metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    },
    (t) => [
      index('memories_embedding_hnsw_idx')
        .using('hnsw', t.embedding.op('vector_cosine_ops'))
        .with({ m: 16, ef_construction: 64 })
        .where(sql`${t.tombstonedAt} IS NULL`),
      index('memories_content_tsv_gin_idx')
        .using('gin', t.contentTsv)
        .where(sql`${t.tombstonedAt} IS NULL`),
      index('memories_decay_btree_idx')
        .on(t.bucket, t.importance.desc(), t.lastAccessedAt.desc())
        .where(sql`${t.tombstonedAt} IS NULL`),
      index('memories_segment_tombstone_idx').on(t.segment, t.tombstonedAt),
    ],
  );

  export const memoryLinks = pgTable(
    'memory_links',
    {
      id: uuid('id').primaryKey().defaultRandom(),
      parentId: uuid('parent_id')
        .notNull()
        .references(() => memories.id),
      childId: uuid('child_id')
        .notNull()
        .references(() => memories.id),
      linkType: linkTypeEnum('link_type').notNull(),
      proposalId: uuid('proposal_id'),  // FK declared in cleanup.ts to avoid circular import
      createdAt: timestamp('created_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
    },
    (t) => [
      index('memory_links_parent_idx').on(t.parentId),
      index('memory_links_child_idx').on(t.childId),
      uniqueIndex('memory_links_pair_type_uq').on(t.parentId, t.childId, t.linkType),
    ],
  );
  ```

- [ ] **Step 2: Typecheck**
  ```bash
  pnpm typecheck
  ```

- [ ] **Commit:**
  ```bash
  git add db/schema/memories.ts
  git commit -m "feat(phase-02): memories + segment config + memory_links schema"
  ```

---

## Task 4 — Define `memory_cleanup_runs` and `memory_cleanup_proposals`

**Files:**
- `db/schema/cleanup.ts` (new)

- [ ] **Step 1: Write the schema**

  ```ts
  import { sql } from 'drizzle-orm';
  import {
    pgTable,
    uuid,
    text,
    timestamp,
    integer,
    numeric,
    jsonb,
    index,
    check,
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
  ```

  **Note on the circular FK:** `memory_links.proposal_id` → `memory_cleanup_proposals.id` is intentionally left as an unconstrained `uuid` in `memories.ts` (step 3 above) to avoid a TypeScript circular import between the two files. Add the FK in the generated SQL migration by hand if you want strict referential integrity; otherwise leave it (the proposal row always exists before the link row is written, enforced at the application layer).

- [ ] **Step 2: Typecheck**
  ```bash
  pnpm typecheck
  ```

- [ ] **Commit:**
  ```bash
  git add db/schema/cleanup.ts
  git commit -m "feat(phase-02): memory cleanup runs + proposals schema"
  ```

---

## Task 5 — Define `tasks`, `task_runs`, `task_events`

**Files:**
- `db/schema/tasks.ts` (new)

- [ ] **Step 1: Write the schema**

  Known event types (kept in sync with phase 06 `<AssistantTurn>` / `<ToolCall>` / etc. components):

  ```ts
  import { sql } from 'drizzle-orm';
  import {
    pgTable,
    uuid,
    text,
    timestamp,
    integer,
    numeric,
    jsonb,
    bigserial,
    index,
    uniqueIndex,
    check,
  } from 'drizzle-orm/pg-core';
  import { taskStatusEnum } from './enums';

  export const tasks = pgTable(
    'tasks',
    {
      id: uuid('id').primaryKey().defaultRandom(),
      prompt: text('prompt').notNull(),
      status: taskStatusEnum('status').notNull().default('queued'),
      createdBy: text('created_by'),
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
      index('task_events_run_seq_idx').on(t.runId, t.seq),
      uniqueIndex('task_events_run_seq_uq').on(t.runId, t.seq),
      check(
        'task_events_type_check',
        sql`${t.type} IN ('assistant_turn','tool_call','tool_result','approval_request','compact_boundary','run_result','user_message')`,
      ),
    ],
  );
  ```

- [ ] **Step 2: Typecheck**
  ```bash
  pnpm typecheck
  ```

- [ ] **Commit:**
  ```bash
  git add db/schema/tasks.ts
  git commit -m "feat(phase-02): tasks + task_runs + task_events schema"
  ```

---

## Task 6 — Define `approval_gates`

**Files:**
- `db/schema/approvals.ts` (new)

- [ ] **Step 1: Write the schema**

  ```ts
  import {
    pgTable,
    uuid,
    text,
    timestamp,
    jsonb,
    index,
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
  ```

- [ ] **Step 2: Update the barrel**

  Overwrite `db/schema/index.ts`:
  ```ts
  export * from './enums';
  export * from './types';
  export * from './memories';
  export * from './cleanup';
  export * from './tasks';
  export * from './approvals';
  ```

- [ ] **Step 3: Typecheck**
  ```bash
  pnpm typecheck
  ```

- [ ] **Commit:**
  ```bash
  git add db/schema/approvals.ts db/schema/index.ts
  git commit -m "feat(phase-02): approval_gates schema + barrel re-exports"
  ```

---

## Task 7 — Generate the DDL migration

**Files:**
- `drizzle/0001_core_schema.sql` (new — drizzle-kit produces this)
- `drizzle/meta/_journal.json` (updated by drizzle-kit)
- `drizzle/meta/0001_snapshot.json` (new, produced by drizzle-kit)

- [ ] **Step 1: Run the generator**
  ```bash
  pnpm db:generate
  ```
  Expected: `Your SQL migration file is saved at drizzle/0001_<kebab_name>.sql` (drizzle-kit picks a name — rename the file to `0001_core_schema.sql` if desired).

- [ ] **Step 2: Inspect the generated SQL carefully**

  Open `drizzle/0001_core_schema.sql`. Verify:
  - All six `CREATE TYPE … AS ENUM` statements in the right order.
  - `memories.content_tsv` is declared as:
    ```sql
    "content_tsv" tsvector GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED
    ```
  - HNSW index line looks like:
    ```sql
    CREATE INDEX "memories_embedding_hnsw_idx" ON "memories" USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 64) WHERE "tombstoned_at" IS NULL;
    ```
  - GIN index line looks like:
    ```sql
    CREATE INDEX "memories_content_tsv_gin_idx" ON "memories" USING gin ("content_tsv") WHERE "tombstoned_at" IS NULL;
    ```
  - Compound btree index uses `DESC` on `importance` and `last_accessed_at` where specified.
  - `task_events.id` is `BIGSERIAL PRIMARY KEY` (not `BIGINT`).
  - All `text` columns with check constraints in the Drizzle schema emit matching `CHECK (…)` clauses.
  - No FK is emitted for `memory_links.proposal_id` — the column is present but unconstrained (intentional, per Task 4 note).

  **If something looks wrong,** fix the Drizzle schema (not the SQL file), re-run `pnpm db:generate`, and re-inspect. Only hand-edit the SQL file as a last resort, and document the reason at the top of the file.

- [ ] **Step 3: Rename the generated file**

  drizzle-kit picks an auto-generated kebab name for the second migration. Rename to the convention used in the spec:
  ```bash
  # example — adjust the source name to whatever drizzle-kit produced
  git mv drizzle/0001_<auto_name>.sql drizzle/0001_core_schema.sql
  ```
  Update `drizzle/meta/_journal.json` to reflect the new filename if the journal references it by name.

- [ ] **Commit:**
  ```bash
  git add drizzle/0001_core_schema.sql drizzle/meta/_journal.json drizzle/meta/0001_snapshot.json
  git commit -m "chore(phase-02): generate 0001_core_schema migration"
  ```

---

## Task 8 — Write the seed migration

**Files:**
- `drizzle/0002_seed_segment_config.sql` (new — custom)
- `drizzle/meta/_journal.json` (updated by drizzle-kit)
- `drizzle/meta/0002_snapshot.json` (new)

- [ ] **Step 1: Scaffold the custom migration**
  ```bash
  pnpm exec drizzle-kit generate --custom --name seed_segment_config
  ```
  Expected: an empty `0002_seed_segment_config.sql` at `drizzle/`, plus `meta/_journal.json` updated and `meta/0002_snapshot.json` added.

- [ ] **Step 2: Write the INSERTs**

  Edit `drizzle/0002_seed_segment_config.sql`:
  ```sql
  -- Seed memory_segment_config with the seven defaults from auto-ride-initial-plan.md §5.
  -- Idempotent: safe to re-run via `ON CONFLICT (segment) DO NOTHING`.

  INSERT INTO "memory_segment_config"
    ("segment", "default_importance", "decay_lambda_short", "decay_lambda_long_factor",
     "promotion_threshold_long", "promotion_threshold_permanent", "fast_track_permanent")
  VALUES
    ('identity',     0.90, 0.0834, 0.01, 0.50, 0.80, true),
    ('correction',   0.80, 0.0834, 0.01, 0.50, 0.80, false),
    ('preference',   0.70, 0.0834, 0.01, 0.50, 0.80, false),
    ('relationship', 0.65, 0.0834, 0.01, 0.50, 0.80, false),
    ('knowledge',    0.60, 0.0834, 0.01, 0.50, 0.80, false),
    ('behavioral',   0.55, 0.0834, 0.01, 0.50, 0.80, false),
    ('context',      0.40, 0.0834, 0.01, 0.50, 0.80, false)
  ON CONFLICT ("segment") DO NOTHING;
  ```

- [ ] **Step 3: Apply both migrations**
  ```bash
  pnpm db:migrate
  ```
  Expected: `0001_core_schema.sql` applies, then `0002_seed_segment_config.sql` applies, neither errors.

- [ ] **Step 4: Verify idempotency**
  ```bash
  pnpm db:migrate
  ```
  Expected: `No migrations to run.` (or similar no-op output). Seed INSERTs are gated by `_journal.json`, not re-run.

- [ ] **Step 5: Manual verification**

  Open studio:
  ```bash
  pnpm db:studio
  ```
  Check that `memory_segment_config` has 7 rows and `identity.fast_track_permanent` is `true`.

- [ ] **Commit:**
  ```bash
  git add drizzle/0002_seed_segment_config.sql drizzle/meta/_journal.json drizzle/meta/0002_snapshot.json
  git commit -m "feat(phase-02): seed 7 memory_segment_config rows"
  ```

---

## Task 9 — Schema introspection tests

**Files:**
- `tests/schema.test.ts` (new)

- [ ] **Step 1: Write the test**

  Seven assertions as listed in the spec. Uses `postgres` directly (not drizzle) so we can hit the catalog:

  ```ts
  import { describe, it, expect, afterAll } from 'vitest';
  import postgres from 'postgres';

  const url = process.env.DATABASE_URL_UNPOOLED;

  const skipSuite = url ? describe : describe.skip;

  skipSuite('phase-02 schema', () => {
    const sql = postgres(url!, { max: 1, idle_timeout: 2 });

    afterAll(async () => {
      await sql.end();
    });

    const expectedTables = [
      'memories',
      'memory_segment_config',
      'memory_links',
      'memory_cleanup_runs',
      'memory_cleanup_proposals',
      'tasks',
      'task_runs',
      'task_events',
      'approval_gates',
    ];

    it('creates all 9 tables', async () => {
      const rows = await sql`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY(${sql.array(expectedTables)})
      `;
      expect(rows.map((r) => r.table_name).sort()).toEqual(
        [...expectedTables].sort(),
      );
    });

    it('creates all 6 enums with expected values', async () => {
      const rows = await sql`
        SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
        FROM pg_type t
        JOIN pg_enum e ON e.enumtypid = t.oid
        GROUP BY t.typname
      `;
      const map = Object.fromEntries(rows.map((r) => [r.typname, r.labels]));
      expect(map.segment).toEqual([
        'identity',
        'correction',
        'preference',
        'relationship',
        'knowledge',
        'behavioral',
        'context',
      ]);
      expect(map.bucket).toEqual(['short', 'long', 'permanent']);
      expect(map.task_status).toEqual([
        'queued',
        'in_progress',
        'awaiting_approval',
        'done',
        'failed',
        'cancelled',
      ]);
      expect(map.approval_status).toEqual([
        'pending',
        'approved',
        'modified',
        'denied',
        'timed_out',
      ]);
      expect(map.cleanup_action).toEqual(['promote', 'prune', 'merge', 'keep']);
      expect(map.link_type).toEqual(['merged', 'superseded']);
    });

    it('has HNSW, GIN, and compound btree partial indexes on memories', async () => {
      const rows = await sql`
        SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'memories'
      `;
      const defs = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
      expect(defs.memories_embedding_hnsw_idx).toMatch(/USING hnsw/);
      expect(defs.memories_embedding_hnsw_idx).toMatch(/vector_cosine_ops/);
      expect(defs.memories_embedding_hnsw_idx).toMatch(/m\s*=\s*'?16'?/);
      expect(defs.memories_embedding_hnsw_idx).toMatch(
        /ef_construction\s*=\s*'?64'?/,
      );
      expect(defs.memories_embedding_hnsw_idx).toMatch(
        /WHERE\s+\(?tombstoned_at\s+IS NULL\)?/i,
      );
      expect(defs.memories_content_tsv_gin_idx).toMatch(/USING gin/);
      expect(defs.memories_content_tsv_gin_idx).toMatch(
        /WHERE\s+\(?tombstoned_at\s+IS NULL\)?/i,
      );
      expect(defs.memories_decay_btree_idx).toMatch(/bucket/);
      expect(defs.memories_decay_btree_idx).toMatch(/importance DESC/);
      expect(defs.memories_decay_btree_idx).toMatch(/last_accessed_at DESC/);
    });

    it('has 7 seeded segment configs with correct default_importance', async () => {
      const rows = await sql`
        SELECT segment, default_importance, fast_track_permanent
        FROM memory_segment_config
        ORDER BY default_importance DESC
      `;
      expect(rows).toHaveLength(7);
      expect(rows[0].segment).toBe('identity');
      expect(Number(rows[0].default_importance)).toBeCloseTo(0.9);
      expect(rows[0].fast_track_permanent).toBe(true);
      expect(rows[rows.length - 1].segment).toBe('context');
      expect(Number(rows[rows.length - 1].default_importance)).toBeCloseTo(0.4);
    });

    it('accepts an INSERT into memories with defaults', async () => {
      const [row] = await sql`
        INSERT INTO memories (segment, content, importance)
        VALUES ('knowledge', 'hello world', 0.6)
        RETURNING id, bucket, access_count, importance_streak
      `;
      expect(row.bucket).toBe('short');
      expect(row.access_count).toBe(0);
      expect(row.importance_streak).toBe(0);
      await sql`DELETE FROM memories WHERE id = ${row.id}`;
    });

    it('rejects a wrong-dim vector on INSERT', async () => {
      await expect(
        sql`
          INSERT INTO memories (segment, content, importance, embedding)
          VALUES ('knowledge', 'x', 0.6, '[1,2,3]'::vector)
        `,
      ).rejects.toThrow();
    });

    it('populates content_tsv automatically via the STORED generated column', async () => {
      const [row] = await sql`
        INSERT INTO memories (segment, content, importance)
        VALUES ('knowledge', 'the quick brown fox', 0.6)
        RETURNING id, content_tsv
      `;
      expect(String(row.content_tsv)).toMatch(/brown/);
      expect(String(row.content_tsv)).toMatch(/fox/);
      await sql`DELETE FROM memories WHERE id = ${row.id}`;
    });
  });
  ```

- [ ] **Step 2: Run tests**
  ```bash
  pnpm test
  ```
  Expected: `phase-02 schema` suite reports 7/7 passing (or skips cleanly if `DATABASE_URL_UNPOOLED` is unset — the phase-01 `/health` test continues to pass in any case).

- [ ] **Commit:**
  ```bash
  git add tests/schema.test.ts
  git commit -m "test(phase-02): schema introspection + insert/reject assertions"
  ```

---

## Task 10 — Full CI loop and README update

- [ ] **Step 1: Run the full gauntlet**
  ```bash
  pnpm typecheck && pnpm lint && pnpm test && pnpm build
  ```
  Expected: all four pass. If `pnpm build` fails because of unused imports in the schema files, trim them (keep only what's exported or referenced).

- [ ] **Step 2: Update `README.md` with the phase-02 migration command**

  The existing Quickstart section says `pnpm install && pnpm db:migrate && pnpm dev`. That still works — `pnpm db:migrate` now applies `0000_enable_vector.sql`, `0001_core_schema.sql`, and `0002_seed_segment_config.sql` in order. Add a short paragraph under Quickstart noting that after phase 02, the DB has nine tables and seven segment-config rows seeded.

- [ ] **Commit:**
  ```bash
  git add README.md
  git commit -m "docs(phase-02): note the new tables and seeds in README quickstart"
  ```

---

## Task 11 — Open the phase 02 PR

- [ ] **Step 1: Final push**
  ```bash
  git push origin phase/02-schema
  ```

- [ ] **Step 2: Open PR via `gh`**

  Title **must** start with `phase 02:`. Body **must** link the plan doc sections.

  ```bash
  gh pr create --base main --head phase/02-schema \
    --title "phase 02: schema" \
    --body "$(cat <<'EOF'
  ## Summary

  - Adds the full Auto-ride data model: 9 tables (memories, memory_segment_config, memory_links, memory_cleanup_runs, memory_cleanup_proposals, tasks, task_runs, task_events, approval_gates), 6 pg enums, and 7 seeded `memory_segment_config` rows.
  - Drops in the three critical indexes on `memories` (HNSW on `embedding` + `vector_cosine_ops`, GIN on generated `content_tsv`, compound btree `(bucket, importance DESC, last_accessed_at DESC)`) — all partial on `WHERE tombstoned_at IS NULL`.
  - Splits schema by domain (enums / types / memories / cleanup / tasks / approvals) for diff-friendly follow-ups.

  ## Plan references

  - `auto-ride-initial-plan.md` §5 (memory buckets, decay, schema)
  - `auto-ride-initial-plan.md` §6 (retrieval stack, pgvector HNSW)
  - `docs/roadmap/ROADMAP.md` — phase 02 row
  - Design: `docs/superpowers/specs/2026-04-21-phase-02-schema-design.md`
  - Plan: `docs/superpowers/plans/2026-04-21-phase-02-schema-plan.md`

  ## Test plan

  - [ ] Worktree identity verified (`shahriarbijoy` / `shahriarbijoy@gmail.com`)
  - [ ] `pnpm db:migrate` applies both new migrations from an empty state
  - [ ] `pnpm db:migrate` on a second run is a no-op (idempotency)
  - [ ] `pnpm test` — `phase-02 schema` suite passes all 7 assertions
  - [ ] `pnpm typecheck` passes strict
  - [ ] `pnpm lint` passes
  - [ ] `pnpm build` passes (phase 01 `/health` route still healthy)
  - [ ] Manual: `pnpm db:studio` shows 9 tables with expected columns and FK arrows
  - [ ] Manual: `SELECT COUNT(*) FROM memory_segment_config` → 7
  EOF
  )"
  ```

- [ ] **Step 3: Link the PR in this plan file** (optional — overwrite the URL here after creation).

---

## Post-merge housekeeping

After the PR is squash-merged on GitHub:

- [ ] Fast-forward local main: `git switch main && git pull --ff-only origin main`.
- [ ] `git worktree remove .worktree/phase-02-schema` (only if nothing uncommitted — guardrails hook blocks `--force`).
- [ ] `git branch -d phase/02-schema` (safe delete — guardrail hook blocks `-D`).
- [ ] The phase-01 worktree can be cleaned up the same way if it's still around and no longer needed for reference.

Phase 03 (memory MCP — read) picks up from the same main HEAD.
