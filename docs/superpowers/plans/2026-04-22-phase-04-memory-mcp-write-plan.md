# Phase 04 — Memory MCP (write / reinforce / forget) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend phase 03's `memory` MCP server with three lifecycle tools (`write`, `reinforce`, `forget`), wire recall-time auto-reinforcement into the existing `recallMemories`, and land the two pure promotion/expiry functions (`evaluatePromotions`, `expireTombstones`) that phase 09's nightly cron will later schedule. No Inngest cron, no 3-agent debate, no new deps.

**Architecture:** Three new query files (`db/queries/memory-write.ts`, `db/queries/memory-forget.ts`, `db/queries/memory-lifecycle.ts`), one new SQL helper (`lib/memory/decay-sql.ts` — the continuous-exponential effective-importance fragment phase 03 inlined), one edit to `db/queries/memory-recall.ts` (add `reinforceHits` option + consume the shared fragment), one edit to `lib/mcp/memory.ts` (register three new tools alongside `recall`), one new `scripts/memory-demo.ts` as the visible done signal, four new test files + two edited test files. Reinforcement math (`I ← min(1.0, I + 0.05·(1 − I))`), decay math, and promotion thresholds all live server-side in SQL — no JS arithmetic on `numeric(3,2)` values.

**Tech Stack:** phase 03 stack, no additions.

**Spec:** `docs/superpowers/specs/2026-04-22-phase-04-memory-mcp-write-design.md`
**Roadmap entry:** `docs/roadmap/ROADMAP.md` — phase 04

---

## Prerequisites (one-time, before Task 1)

- Phase 03 merged to `main` (commit `a3431d1` — PR #4) — ✅ done.
- Local `main` fast-forwarded to `origin/main` — ✅ done.
- Neon project reachable; `DATABASE_URL_UNPOOLED` in the developer's `.env.local`.
- `GEMINI_API_KEY` (added in phase 03) still present in `.env.local`.
- Phase 04 spec lands on the phase branch in the same commit bundle as this plan (Task 2).
- Phase 03 worktree at `.worktree/phase-03-memory-mcp-read/` can stay — it will not conflict with phase 04.

---

## Task 1 — Phase 04 worktree (already created)

**Files:** git plumbing only. This task was completed before the plan was written; checkboxes record the verification steps an engineer re-running the plan should execute.

- [x] **Step 1: Worktree already exists at `.worktree/phase-04-memory-mcp-write/`** with branch `phase/04-memory-mcp-write` cut from `main` at commit `a3431d1`.

- [x] **Step 2: Git identity already set** in the new worktree (`shahriarbijoy` / `shahriarbijoy@gmail.com`). Verify:

  ```bash
  git -C .worktree/phase-04-memory-mcp-write config user.name
  git -C .worktree/phase-04-memory-mcp-write config user.email
  ```
  Expected: `shahriarbijoy`, `shahriarbijoy@gmail.com`.

- [ ] **Step 3: Copy `.env.local` into the worktree** if not already done

  Worktrees do not inherit the main checkout's `.env.local`:
  ```bash
  cp .env.local .worktree/phase-04-memory-mcp-write/.env.local
  ```
  Verify `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `GEMINI_API_KEY` are all present. Do not commit.

- [ ] **Step 4: Install dependencies in the new worktree**

  ```bash
  cd .worktree/phase-04-memory-mcp-write
  pnpm install
  ```
  Expected: no lockfile churn — phase 04 adds zero deps.

- [ ] **Step 5: Push the new branch to origin**

  ```bash
  git push -u origin phase/04-memory-mcp-write
  ```
  Expected: `Branch 'phase/04-memory-mcp-write' set up to track remote branch 'phase/04-memory-mcp-write' from 'origin'.`

No commit yet — the branch starts at main's HEAD.

---

## Task 2 — Commit phase 04 design spec + this plan

**Files:**
- `docs/superpowers/specs/2026-04-22-phase-04-memory-mcp-write-design.md` (already written before Task 1)
- `docs/superpowers/plans/2026-04-22-phase-04-memory-mcp-write-plan.md` (this file)

- [ ] **Step 1: Confirm both doc files exist on the phase branch**

  ```bash
  ls docs/superpowers/specs/2026-04-22-phase-04-memory-mcp-write-design.md
  ls docs/superpowers/plans/2026-04-22-phase-04-memory-mcp-write-plan.md
  ```

- [ ] **Step 2: Two focused commits**

  ```bash
  git add docs/superpowers/specs/2026-04-22-phase-04-memory-mcp-write-design.md
  git commit -m "docs(phase-04): memory MCP write/reinforce/forget design spec"

  git add docs/superpowers/plans/2026-04-22-phase-04-memory-mcp-write-plan.md
  git commit -m "docs(phase-04): memory MCP write/reinforce/forget implementation plan"
  ```

  Push optional here; pushed at the end via `git push` or `/finish-phase 04`.

---

## Task 3 — Extract shared decay SQL fragment; refactor phase-03 recall to use it

**Files:**
- `lib/memory/decay-sql.ts` (new)
- `db/queries/memory-recall.ts` (edit — replace inline decay expression; no behavior change)

This task is a pure refactor. Phase 03's recall integration tests must continue to pass unmodified — any test failure signals math drift introduced by the extraction and must be fixed before moving on.

- [ ] **Step 1: Create `lib/memory/decay-sql.ts`**

  ```ts
  import { sql } from 'drizzle-orm';
  import type { AnyColumn, SQL } from 'drizzle-orm';

  /** Any SQL reference — a raw column, a subquery column, or a pre-built sql`` fragment. */
  type SqlRef = SQL | AnyColumn | SQL.Aliased;

  /**
   * Builds a SQL fragment that evaluates effective importance for a single row.
   *
   * effective(row, asOf) =
   *   CASE row.bucket
   *     WHEN 'permanent' THEN row.importance
   *     WHEN 'short'     THEN row.importance * exp(-config.lambda_short * days_since(row.last_accessed_at, asOf))
   *     WHEN 'long'      THEN row.importance * exp(-config.lambda_long_factor * (1 - 0.8*row.importance) * days_since(…))
   *   END
   *
   * The caller owns the JOIN between `memories` and `memory_segment_config`; this helper
   * only composes the math. `asOf` defaults to `now()`; override it with a `sql`timestamp`
   * fragment for deterministic time-travel in tests or promotion-evaluation.
   */
  export function effectiveImportanceSql(refs: {
    bucket: SqlRef;
    importance: SqlRef;
    lastAccessed: SqlRef;
    decayLambdaShort: SqlRef;
    decayLambdaLongFactor: SqlRef;
    asOf?: SqlRef;
  }): SQL<number> {
    const asOf = refs.asOf ?? sql`now()`;
    const ageDays = sql<number>`(extract(epoch from (${asOf} - ${refs.lastAccessed})) / 86400.0)`;
    const lambda = sql<number>`(
      CASE ${refs.bucket}
        WHEN 'permanent' THEN 0
        WHEN 'short'     THEN ${refs.decayLambdaShort}
        WHEN 'long'      THEN ${refs.decayLambdaLongFactor} * (1 - 0.8 * ${refs.importance}::float8)
      END
    )`;
    return sql<number>`(${refs.importance}::float8 * exp(-${lambda} * ${ageDays}))`;
  }
  ```

- [ ] **Step 2: Edit `db/queries/memory-recall.ts` to consume the helper**

  Replace the inline `lambda` / `effImp` declarations (currently lines ~73–80 of `db/queries/memory-recall.ts`) with a call to `effectiveImportanceSql`. Keep `cosineSim`, `tsRank`, and `score` as-is.

  Current:

  ```ts
  const lambda = sql<number>`(
    CASE ${candidateWindow.bucket}
      WHEN 'permanent' THEN 0
      WHEN 'short' THEN ${memorySegmentConfig.decayLambdaShort}
      WHEN 'long'  THEN ${memorySegmentConfig.decayLambdaLongFactor} * (1 - 0.8 * ${candidateWindow.importance}::float8)
    END
  )`;
  const effImp = sql<number>`(${candidateWindow.importance}::float8 * exp(-${lambda} * ${ageDays}))`;
  ```

  Replace with (also remove the now-unused `ageDays` declaration — the helper owns it):

  ```ts
  const effImp = effectiveImportanceSql({
    bucket: candidateWindow.bucket,
    importance: candidateWindow.importance,
    lastAccessed: candidateWindow.lastAccessedAt,
    decayLambdaShort: memorySegmentConfig.decayLambdaShort,
    decayLambdaLongFactor: memorySegmentConfig.decayLambdaLongFactor,
    // asOf: defaults to now()
  });
  ```

  Add the import at the top of `db/queries/memory-recall.ts`:

  ```ts
  import { effectiveImportanceSql } from '@/lib/memory/decay-sql';
  ```

- [ ] **Step 3: Run the phase-03 recall integration tests — they must pass unmodified**

  ```bash
  pnpm test -- memory-recall.test.ts
  ```
  Expected: all 6 existing phase-03 cases pass (cosine ranking, segment filter, decay ordering, importance ordering, top_k cap, HNSW index). Any failure = math drift; revert the helper and re-inline until the helper produces bit-identical SQL.

- [ ] **Step 4: Typecheck + lint**

  ```bash
  pnpm typecheck && pnpm lint
  ```

- [ ] **Commit:**

  ```bash
  git add lib/memory/decay-sql.ts db/queries/memory-recall.ts
  git commit -m "refactor(phase-04): extract effective-importance SQL fragment (no behavior change)"
  ```

---

## Task 4 — Write query + `write` tool (plus tests)

**Files:**
- `db/queries/memory-write.ts` (new)
- `tests/memory-write.test.ts` (new)

TDD order for this task: write the tests first against stubbed embeddings, watch them fail, then implement.

- [ ] **Step 1: Write the test file**

  Create `tests/memory-write.test.ts`:

  ```ts
  import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
  import postgres from 'postgres';

  // Stub embeddings to avoid hitting Gemini in CI; deterministic unit vector.
  vi.mock('@/lib/embeddings', () => ({
    embedForDocument: vi.fn(async () => {
      const v = new Array<number>(1536).fill(0);
      v[0] = 1;
      return v;
    }),
    embedForQuery: vi.fn(),
    l2Normalize: (v: number[]) => v,
    EMBEDDING_DIMS: 1536,
    EMBEDDING_MODEL: 'stub',
  }));

  const url = process.env.DATABASE_URL_UNPOOLED;
  const skipSuite = url ? describe : describe.skip;

  skipSuite('phase-04 memory-write integration', () => {
    const rawSql = postgres(url!, { max: 1, idle_timeout: 2 });
    const TEST_ID = 'phase-04-write';

    beforeEach(async () => {
      await rawSql`DELETE FROM memories WHERE metadata->>'test_id' = ${TEST_ID}`;
    });

    afterAll(async () => {
      await rawSql`DELETE FROM memories WHERE metadata->>'test_id' = ${TEST_ID}`;
      await rawSql.end();
    });

    it('defaults bucket to short and importance to segment default (knowledge = 0.60)', async () => {
      const { writeMemory } = await import('@/db/queries/memory-write');
      const result = await writeMemory({
        content: 'oil change interval is 5000 miles',
        segment: 'knowledge',
        metadata: { test_id: TEST_ID },
      });
      expect(result.bucket).toBe('short');
      expect(result.importance).toBeCloseTo(0.60, 5);

      const [row] = await rawSql<
        Array<{
          bucket: string;
          importance: string;
          importance_streak: number;
          tombstoned_at: Date | null;
          content_tsv: string | null;
          embedding_len: number;
        }>
      >`
        SELECT bucket, importance, importance_streak, tombstoned_at,
               content_tsv::text AS content_tsv,
               array_length(embedding::real[], 1) AS embedding_len
        FROM memories WHERE id = ${result.id}
      `;
      expect(row!.bucket).toBe('short');
      expect(row!.importance).toBe('0.60');
      expect(row!.importance_streak).toBe(0);
      expect(row!.tombstoned_at).toBeNull();
      expect(row!.content_tsv).not.toBeNull();
      expect(row!.embedding_len).toBe(1536);
    });

    it('uses identity default importance 0.90', async () => {
      const { writeMemory } = await import('@/db/queries/memory-write');
      const result = await writeMemory({
        content: 'user name is alice',
        segment: 'identity',
        metadata: { test_id: TEST_ID },
      });
      expect(result.importance).toBeCloseTo(0.90, 5);
    });

    it('uses context default importance 0.40', async () => {
      const { writeMemory } = await import('@/db/queries/memory-write');
      const result = await writeMemory({
        content: 'session started at 09:00',
        segment: 'context',
        metadata: { test_id: TEST_ID },
      });
      expect(result.importance).toBeCloseTo(0.40, 5);
    });

    it('round-trips arbitrary metadata', async () => {
      const { writeMemory } = await import('@/db/queries/memory-write');
      const md = { test_id: TEST_ID, vehicle_id: 'L-42', tags: ['a', 'b'] };
      const result = await writeMemory({
        content: 'lease vehicle L-42',
        segment: 'knowledge',
        metadata: md,
      });
      const [row] = await rawSql<Array<{ metadata: unknown }>>`
        SELECT metadata FROM memories WHERE id = ${result.id}
      `;
      expect(row!.metadata).toEqual(md);
    });

    it('undefined metadata defaults to empty jsonb', async () => {
      const { writeMemory } = await import('@/db/queries/memory-write');
      const result = await writeMemory({
        content: 'no metadata row',
        segment: 'knowledge',
      });
      const [row] = await rawSql<Array<{ metadata: unknown }>>`
        SELECT metadata FROM memories WHERE id = ${result.id}
      `;
      expect(row!.metadata).toEqual({});
      // Direct cleanup since no test_id tag.
      await rawSql`DELETE FROM memories WHERE id = ${result.id}`;
    });
  });

  describe.skip('[live] Gemini write round-trip', () => {
    it('embeds a real document and inserts', async () => {
      vi.doUnmock('@/lib/embeddings');
      const { writeMemory } = await import('@/db/queries/memory-write');
      const result = await writeMemory({
        content: 'live gemini round-trip memory',
        segment: 'knowledge',
        metadata: { test_id: 'phase-04-write-live' },
      });
      expect(result.bucket).toBe('short');
      expect(result.importance).toBeGreaterThan(0);
      // cleanup
      const rawSql = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1 });
      await rawSql`DELETE FROM memories WHERE id = ${result.id}`;
      await rawSql.end();
    });
  });
  ```

- [ ] **Step 2: Run tests — confirm they fail (no writeMemory yet)**

  ```bash
  pnpm test -- memory-write.test.ts
  ```
  Expected: all 5 cases fail (`Cannot find module '@/db/queries/memory-write'`).

- [ ] **Step 3: Implement `db/queries/memory-write.ts`**

  ```ts
  import { sql } from 'drizzle-orm';
  import { db } from '@/db/client';
  import { memories } from '@/db/schema/memories';
  import type { SegmentValue } from '@/db/queries/memory-recall';
  import { embedForDocument } from '@/lib/embeddings';

  export interface WriteArgs {
    content: string;
    segment: SegmentValue;
    metadata?: Record<string, unknown>;
  }

  export interface WriteResult {
    id: string;
    bucket: 'short';
    importance: number;
  }

  /**
   * Create a new memory. Server owns bucket ('short') and importance
   * (memory_segment_config.default_importance for the segment). Embedding
   * is computed via Gemini embedForDocument.
   */
  export async function writeMemory(args: WriteArgs): Promise<WriteResult> {
    const embedding = await embedForDocument(args.content);

    const [row] = await db
      .insert(memories)
      .values({
        segment: args.segment,
        // bucket omitted — column defaults to 'short'.
        content: args.content,
        embedding,
        importance: sql`(SELECT default_importance FROM memory_segment_config WHERE segment = ${args.segment})`,
        metadata: args.metadata ?? {},
      })
      .returning({
        id: memories.id,
        bucket: memories.bucket,
        importance: memories.importance,
      });

    if (!row) {
      throw new Error(`writeMemory: INSERT returned no rows`);
    }

    return {
      id: row.id,
      bucket: 'short',
      importance: Number(row.importance),
    };
  }
  ```

- [ ] **Step 4: Run tests — expect pass**

  ```bash
  pnpm test -- memory-write.test.ts
  ```
  Expected: 5/5 pass; live-Gemini describe.skip remains skipped.

- [ ] **Step 5: Typecheck**

  ```bash
  pnpm typecheck
  ```

- [ ] **Commit:**

  ```bash
  git add db/queries/memory-write.ts tests/memory-write.test.ts
  git commit -m "feat(phase-04): writeMemory + test suite"
  ```

---

## Task 5 — Reinforce query + recall auto-reinforce (plus tests)

**Files:**
- `db/queries/memory-lifecycle.ts` (new — reinforce half only in this task; promote/expire in Task 7)
- `db/queries/memory-recall.ts` (edit — add `reinforceHits` option)
- `tests/memory-reinforce.test.ts` (new)
- `tests/memory-recall.test.ts` (edit — add auto-reinforce cases)

- [ ] **Step 1: Write the reinforce test file**

  Create `tests/memory-reinforce.test.ts`:

  ```ts
  import { afterAll, beforeEach, describe, expect, it } from 'vitest';
  import postgres from 'postgres';

  const url = process.env.DATABASE_URL_UNPOOLED;
  const skipSuite = url ? describe : describe.skip;

  skipSuite('phase-04 memory-reinforce integration', () => {
    const rawSql = postgres(url!, { max: 1, idle_timeout: 2 });
    const TEST_ID = 'phase-04-reinforce';

    function zeroEmbedding(): number[] {
      const v = new Array<number>(1536).fill(0);
      v[0] = 1; // unit-norm
      return v;
    }

    async function seedRow(importance: string, opts?: { tombstoned?: boolean }): Promise<string> {
      const [row] = await rawSql<Array<{ id: string }>>`
        INSERT INTO memories (segment, bucket, content, importance, embedding, tombstoned_at, metadata)
        VALUES ('knowledge', 'short', 'seed', ${importance}, ${JSON.stringify(zeroEmbedding())}::vector,
          ${opts?.tombstoned ? rawSql`now()` : null},
          ${rawSql.json({ test_id: TEST_ID })})
        RETURNING id
      `;
      return row!.id;
    }

    beforeEach(async () => {
      await rawSql`DELETE FROM memories WHERE metadata->>'test_id' = ${TEST_ID}`;
    });

    afterAll(async () => {
      await rawSql`DELETE FROM memories WHERE metadata->>'test_id' = ${TEST_ID}`;
      await rawSql.end();
    });

    it('boost from 0.50 → 0.525 matches I + 0.05*(1-I)', async () => {
      const { reinforceMemories } = await import('@/db/queries/memory-lifecycle');
      const id = await seedRow('0.50');
      const [result] = await reinforceMemories([id]);
      expect(result?.importanceBefore).toBeCloseTo(0.50, 5);
      // numeric(3,2) stores 0.525 as 0.53 (rounds half-up) — verify what actually landed.
      expect(result?.importance).toBeCloseTo(0.53, 5);
    });

    it('boost near saturation: 0.99 → stored 0.99 (numeric(3,2) rounds 0.9905 → 0.99)', async () => {
      const { reinforceMemories } = await import('@/db/queries/memory-lifecycle');
      const id = await seedRow('0.99');
      const [result] = await reinforceMemories([id]);
      expect(result?.importanceBefore).toBeCloseTo(0.99, 5);
      expect(result?.importance).toBeCloseTo(0.99, 5);
    });

    it('saturation at 1.00 stays at 1.00', async () => {
      const { reinforceMemories } = await import('@/db/queries/memory-lifecycle');
      const id = await seedRow('1.00');
      const [result] = await reinforceMemories([id]);
      expect(result?.importance).toBeCloseTo(1.00, 5);
    });

    it('increments access_count by 1 and bumps last_accessed_at', async () => {
      const { reinforceMemories } = await import('@/db/queries/memory-lifecycle');
      const id = await seedRow('0.50');
      // Pin last_accessed_at to a known past value so we can assert the bump.
      await rawSql`UPDATE memories SET last_accessed_at = now() - interval '2 days', access_count = 3 WHERE id = ${id}`;
      await reinforceMemories([id]);
      const [row] = await rawSql<Array<{ access_count: number; last_accessed_at: Date }>>`
        SELECT access_count, last_accessed_at FROM memories WHERE id = ${id}
      `;
      expect(row!.access_count).toBe(4);
      // bumped — last_accessed_at is within the last 5 seconds
      const ageMs = Date.now() - new Date(row!.last_accessed_at).getTime();
      expect(ageMs).toBeLessThan(5_000);
    });

    it('is a no-op on a tombstoned row (empty result)', async () => {
      const { reinforceMemories } = await import('@/db/queries/memory-lifecycle');
      const id = await seedRow('0.50', { tombstoned: true });
      const results = await reinforceMemories([id]);
      expect(results).toHaveLength(0);
    });

    it('bulk-reinforces 3 ids in one call', async () => {
      const { reinforceMemories } = await import('@/db/queries/memory-lifecycle');
      const ids = [
        await seedRow('0.50'),
        await seedRow('0.60'),
        await seedRow('0.70'),
      ];
      const results = await reinforceMemories(ids);
      expect(results).toHaveLength(3);
      const byId = new Map(results.map((r) => [r.id, r]));
      expect(byId.get(ids[0]!)?.importanceBefore).toBeCloseTo(0.50, 5);
      expect(byId.get(ids[1]!)?.importanceBefore).toBeCloseTo(0.60, 5);
      expect(byId.get(ids[2]!)?.importanceBefore).toBeCloseTo(0.70, 5);
    });

    it('returns empty array on empty id list', async () => {
      const { reinforceMemories } = await import('@/db/queries/memory-lifecycle');
      const results = await reinforceMemories([]);
      expect(results).toEqual([]);
    });
  });
  ```

- [ ] **Step 2: Run tests — expect fail**

  ```bash
  pnpm test -- memory-reinforce.test.ts
  ```
  Expected: 7 fails with `Cannot find module '@/db/queries/memory-lifecycle'`.

- [ ] **Step 3: Implement `db/queries/memory-lifecycle.ts` (reinforce half)**

  ```ts
  import { sql } from 'drizzle-orm';
  import { db } from '@/db/client';

  /** Reinforcement result row — importance values already float-casted in SQL. */
  export interface ReinforceResult {
    id: string;
    importanceBefore: number;
    importance: number;
  }

  /**
   * Boost importance on hit using the diminishing-returns formula:
   *   I ← min(1.0, I + 0.05 * (1 − I))
   *
   * Applied in a single UPDATE so concurrent reinforces against the same
   * row serialize correctly. Tombstoned rows are silently excluded.
   * Also increments access_count and bumps last_accessed_at.
   *
   * Returns one row per successfully-updated id. An empty input array
   * returns an empty result (no SQL round-trip).
   */
  export async function reinforceMemories(ids: string[]): Promise<ReinforceResult[]> {
    if (ids.length === 0) return [];

    const rows = (await db.execute(sql`
      WITH before AS (
        SELECT id, importance::float8 AS importance_before
        FROM memories
        WHERE id = ANY(${ids}::uuid[]) AND tombstoned_at IS NULL
      ),
      updated AS (
        UPDATE memories
        SET importance = LEAST(1.0, importance::float8 + 0.05 * (1 - importance::float8))::numeric(3,2),
            access_count = access_count + 1,
            last_accessed_at = now()
        WHERE id = ANY(${ids}::uuid[]) AND tombstoned_at IS NULL
        RETURNING id, importance::float8 AS importance_after
      )
      SELECT b.id::text AS id, b.importance_before, u.importance_after AS importance
      FROM before b JOIN updated u USING (id)
    `)) as unknown as Array<{
      id: string;
      importance_before: number;
      importance: number;
    }>;

    return rows.map((r) => ({
      id: r.id,
      importanceBefore: Number(r.importance_before),
      importance: Number(r.importance),
    }));
  }
  ```

- [ ] **Step 4: Run the reinforce tests — expect pass**

  ```bash
  pnpm test -- memory-reinforce.test.ts
  ```
  Expected: 7/7 pass.

  **Note on numeric rounding:** test 1 asserts `0.53` (not `0.525`) because Postgres `numeric(3,2)` rounds half-up on assignment. If the actual result is `0.52` (round half-to-even), update the assertion to match — the test documents the database's behavior, not a math proof.

- [ ] **Step 5: Edit `db/queries/memory-recall.ts` to add `reinforceHits` option**

  Add a `reinforceHits?: boolean` field to `RecallArgs`:

  ```ts
  export interface RecallArgs {
    queryVector: number[];
    queryText: string;
    segment?: SegmentValue;
    topK: number;
    /** When true, hit rows are reinforced (importance boost + access_count + last_accessed_at) in one bulk UPDATE and post-boost values are merged into the returned rows. Default false. */
    reinforceHits?: boolean;
  }
  ```

  At the bottom of `recallMemories`, just before `return rows as RecallRow[];`, insert the side-effect:

  ```ts
  if (args.reinforceHits && rows.length > 0) {
    const { reinforceMemories } = await import('@/db/queries/memory-lifecycle');
    const boosted = await reinforceMemories(rows.map((r) => r.id));
    const byId = new Map(boosted.map((b) => [b.id, b.importance]));
    for (const row of rows) {
      const newImp = byId.get(row.id);
      if (newImp !== undefined) {
        // Mutate the returned row to reflect post-boost importance.
        (row as { importance: string }).importance = newImp.toFixed(2);
      }
    }
  }
  ```

  Dynamic `await import(...)` avoids a circular import between `memory-recall.ts` and `memory-lifecycle.ts` if future phases extend lifecycle with a back-reference to recall.

- [ ] **Step 6: Edit `tests/memory-recall.test.ts` — add three cases**

  Locate the existing `skipSuite('phase-03 memory-recall integration', …)` block in `tests/memory-recall.test.ts`. Immediately before its closing `});` (matching `skipSuite`), insert:

  ```ts
    it('does not reinforce rows when reinforceHits is false (default)', async () => {
      // Seed a fresh row with a known importance; recall twice without reinforce; ensure no mutation.
      const [seed] = await rawSql<Array<{ id: string }>>`
        INSERT INTO memories (segment, bucket, content, importance, embedding, metadata)
        VALUES ('knowledge', 'short', 'no-reinforce probe', '0.50',
          ${JSON.stringify(basisPerturbed(5, 0))}::vector,
          ${rawSql.json({ test_id: TEST_ID })})
        RETURNING id
      `;
      await recallMemories({
        queryVector: basisPerturbed(5, 0, 0.001),
        queryText: 'probe',
        topK: 3,
      });
      const [after] = await rawSql<Array<{ importance: string }>>`
        SELECT importance FROM memories WHERE id = ${seed!.id}
      `;
      expect(after!.importance).toBe('0.50');
    });

    it('reinforces every returned row when reinforceHits is true', async () => {
      const [seed] = await rawSql<Array<{ id: string }>>`
        INSERT INTO memories (segment, bucket, content, importance, embedding, metadata)
        VALUES ('knowledge', 'short', 'reinforce probe', '0.60',
          ${JSON.stringify(basisPerturbed(6, 0))}::vector,
          ${rawSql.json({ test_id: TEST_ID })})
        RETURNING id
      `;
      const rows = await recallMemories({
        queryVector: basisPerturbed(6, 0, 0.001),
        queryText: 'probe',
        topK: 3,
        reinforceHits: true,
      });
      // returned row reflects post-boost importance: 0.60 + 0.05*0.40 = 0.62
      const hit = rows.find((r) => r.id === seed!.id);
      expect(hit?.importance).toBe('0.62');
      // DB also updated
      const [after] = await rawSql<Array<{ importance: string; access_count: number }>>`
        SELECT importance, access_count FROM memories WHERE id = ${seed!.id}
      `;
      expect(after!.importance).toBe('0.62');
      expect(after!.access_count).toBe(1);
    });

  ```

  The third spec item — "EXPLAIN HNSW regression after the decay-sql refactor" — is already covered by Task 3 Step 3, which runs all existing phase-03 recall tests (including the EXPLAIN case) after the refactor. No additional test case needed here.

- [ ] **Step 7: Run the updated recall suite**

  ```bash
  pnpm test -- memory-recall.test.ts
  ```
  Expected: all phase-03 cases (6) still pass; the three new cases pass.

- [ ] **Step 8: Typecheck**

  ```bash
  pnpm typecheck
  ```

- [ ] **Commit:**

  ```bash
  git add db/queries/memory-lifecycle.ts db/queries/memory-recall.ts tests/memory-reinforce.test.ts tests/memory-recall.test.ts
  git commit -m "feat(phase-04): reinforceMemories + recall auto-reinforce hook"
  ```

---

## Task 6 — Forget query + tests

**Files:**
- `db/queries/memory-forget.ts` (new)
- `tests/memory-forget.test.ts` (new)

- [ ] **Step 1: Write the test file**

  Create `tests/memory-forget.test.ts`:

  ```ts
  import { afterAll, beforeEach, describe, expect, it } from 'vitest';
  import postgres from 'postgres';
  import { recallMemories } from '@/db/queries/memory-recall';

  const url = process.env.DATABASE_URL_UNPOOLED;
  const skipSuite = url ? describe : describe.skip;

  skipSuite('phase-04 memory-forget integration', () => {
    const rawSql = postgres(url!, { max: 1, idle_timeout: 2 });
    const TEST_ID = 'phase-04-forget';

    function basis(primary: number, eps = 0.01): number[] {
      const v = new Array<number>(1536).fill(0);
      v[primary] = 1;
      v[primary + 1] = eps;
      const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
      return v.map((x) => x / norm);
    }

    async function seed(content: string, metadata: Record<string, unknown>): Promise<string> {
      const [row] = await rawSql<Array<{ id: string }>>`
        INSERT INTO memories (segment, bucket, content, importance, embedding, metadata)
        VALUES ('knowledge', 'short', ${content}, '0.50',
          ${JSON.stringify(basis(10))}::vector,
          ${rawSql.json({ test_id: TEST_ID, ...metadata })})
        RETURNING id
      `;
      return row!.id;
    }

    beforeEach(async () => {
      await rawSql`DELETE FROM memories WHERE metadata->>'test_id' = ${TEST_ID}`;
    });

    afterAll(async () => {
      await rawSql`DELETE FROM memories WHERE metadata->>'test_id' = ${TEST_ID}`;
      await rawSql.end();
    });

    it('sets tombstoned_at and stores tombstone_reason, preserves other metadata keys', async () => {
      const { forgetMemory } = await import('@/db/queries/memory-forget');
      const id = await seed('to-forget', { vehicle_id: 'L-42' });
      const result = await forgetMemory({ id, reason: 'superseded' });
      expect(result?.id).toBe(id);
      expect(result?.tombstonedAt).toBeInstanceOf(Date);

      const [row] = await rawSql<Array<{ tombstoned_at: Date; metadata: Record<string, unknown> }>>`
        SELECT tombstoned_at, metadata FROM memories WHERE id = ${id}
      `;
      expect(row!.tombstoned_at).not.toBeNull();
      expect(row!.metadata).toMatchObject({
        test_id: TEST_ID,
        vehicle_id: 'L-42',
        tombstone_reason: 'superseded',
      });
    });

    it('recall excludes forgotten rows even on near-perfect cosine match', async () => {
      const { forgetMemory } = await import('@/db/queries/memory-forget');
      const id = await seed('vehicle maintenance log', {});
      await forgetMemory({ id, reason: 'duplicate' });
      const rows = await recallMemories({
        queryVector: basis(10, 0.001),
        queryText: 'vehicle maintenance',
        topK: 5,
      });
      expect(rows.find((r) => r.id === id)).toBeUndefined();
    });

    it('returns null on an already-tombstoned row', async () => {
      const { forgetMemory } = await import('@/db/queries/memory-forget');
      const id = await seed('already-gone', {});
      await forgetMemory({ id });
      const second = await forgetMemory({ id, reason: 'should not apply' });
      expect(second).toBeNull();
    });

    it('returns null on a missing id', async () => {
      const { forgetMemory } = await import('@/db/queries/memory-forget');
      const result = await forgetMemory({
        id: '00000000-0000-0000-0000-000000000000',
        reason: 'ghost',
      });
      expect(result).toBeNull();
    });

    it('omits tombstone_reason when no reason supplied', async () => {
      const { forgetMemory } = await import('@/db/queries/memory-forget');
      const id = await seed('no-reason', { vehicle_id: 'L-99' });
      await forgetMemory({ id });
      const [row] = await rawSql<Array<{ metadata: Record<string, unknown> }>>`
        SELECT metadata FROM memories WHERE id = ${id}
      `;
      expect(row!.metadata).not.toHaveProperty('tombstone_reason');
      expect(row!.metadata).toMatchObject({ test_id: TEST_ID, vehicle_id: 'L-99' });
    });
  });
  ```

- [ ] **Step 2: Run tests — expect fail**

  ```bash
  pnpm test -- memory-forget.test.ts
  ```
  Expected: 5 fails with `Cannot find module '@/db/queries/memory-forget'`.

- [ ] **Step 3: Implement `db/queries/memory-forget.ts`**

  ```ts
  import { and, eq, isNull, sql } from 'drizzle-orm';
  import { db } from '@/db/client';
  import { memories } from '@/db/schema/memories';

  export interface ForgetArgs {
    id: string;
    reason?: string;
  }

  export interface ForgetResult {
    id: string;
    tombstonedAt: Date;
  }

  /**
   * Soft-delete a memory by setting tombstoned_at. Merges an optional
   * `tombstone_reason` into the existing metadata (jsonb `||` concat).
   * Returns null if the row is missing or already tombstoned — the caller
   * surfaces that as an isError at the MCP layer so the agent gets a loud
   * "already forgotten" signal instead of a silent no-op.
   */
  export async function forgetMemory(args: ForgetArgs): Promise<ForgetResult | null> {
    const setClause: {
      tombstonedAt: Date;
      metadata?: ReturnType<typeof sql>;
    } = { tombstonedAt: new Date() };

    if (args.reason !== undefined) {
      setClause.metadata = sql`${memories.metadata} || jsonb_build_object('tombstone_reason', ${args.reason}::text)`;
    }

    const [row] = await db
      .update(memories)
      .set(setClause)
      .where(and(eq(memories.id, args.id), isNull(memories.tombstonedAt)))
      .returning({
        id: memories.id,
        tombstonedAt: memories.tombstonedAt,
      });

    if (!row || row.tombstonedAt === null) return null;
    return { id: row.id, tombstonedAt: row.tombstonedAt };
  }
  ```

- [ ] **Step 4: Run tests — expect pass**

  ```bash
  pnpm test -- memory-forget.test.ts
  ```
  Expected: 5/5 pass.

- [ ] **Step 5: Typecheck**

  ```bash
  pnpm typecheck
  ```

- [ ] **Commit:**

  ```bash
  git add db/queries/memory-forget.ts tests/memory-forget.test.ts
  git commit -m "feat(phase-04): forgetMemory (tombstone + reason merge)"
  ```

---

## Task 7 — Promotion + expire pure functions + tests

**Files:**
- `db/queries/memory-lifecycle.ts` (edit — append `evaluatePromotions`, `applyPromotions`, `expireTombstones`)
- `tests/memory-lifecycle.test.ts` (new)

- [ ] **Step 1: Write the test file**

  Create `tests/memory-lifecycle.test.ts`:

  ```ts
  import { afterAll, beforeEach, describe, expect, it } from 'vitest';
  import postgres from 'postgres';

  const url = process.env.DATABASE_URL_UNPOOLED;
  const skipSuite = url ? describe : describe.skip;

  skipSuite('phase-04 memory-lifecycle integration', () => {
    const rawSql = postgres(url!, { max: 1, idle_timeout: 2 });
    const TEST_ID = 'phase-04-lifecycle';

    function zeroEmbedding(): number[] {
      const v = new Array<number>(1536).fill(0);
      v[0] = 1;
      return v;
    }

    type SeedRow = {
      segment: 'identity' | 'correction' | 'knowledge';
      bucket: 'short' | 'long' | 'permanent';
      importance: string;
      importanceStreak: number;
      tombstonedAt?: 'expired' | 'fresh' | null;
    };

    async function seed(r: SeedRow): Promise<string> {
      const tomb =
        r.tombstonedAt === 'expired'
          ? rawSql`now() - interval '15 days'`
          : r.tombstonedAt === 'fresh'
          ? rawSql`now()`
          : null;
      const [row] = await rawSql<Array<{ id: string }>>`
        INSERT INTO memories (segment, bucket, content, importance, importance_streak, embedding, tombstoned_at, last_accessed_at, metadata)
        VALUES (${r.segment}, ${r.bucket}, 'lifecycle-seed',
          ${r.importance}, ${r.importanceStreak},
          ${JSON.stringify(zeroEmbedding())}::vector,
          ${tomb},
          now(),
          ${rawSql.json({ test_id: TEST_ID })})
        RETURNING id
      `;
      return row!.id;
    }

    beforeEach(async () => {
      await rawSql`DELETE FROM memories WHERE metadata->>'test_id' = ${TEST_ID}`;
    });

    afterAll(async () => {
      await rawSql`DELETE FROM memories WHERE metadata->>'test_id' = ${TEST_ID}`;
      await rawSql.end();
    });

    it('proposes promote-to-long when short streak crosses 7', async () => {
      const { evaluatePromotions } = await import('@/db/queries/memory-lifecycle');
      const id = await seed({ segment: 'knowledge', bucket: 'short', importance: '0.60', importanceStreak: 6 });
      const proposals = await evaluatePromotions();
      const p = proposals.find((x) => x.id === id);
      expect(p?.action).toBe('promote-to-long');
    });

    it('proposes reset-streak when short effective importance falls below threshold (and streak > 0)', async () => {
      const { evaluatePromotions } = await import('@/db/queries/memory-lifecycle');
      const id = await seed({ segment: 'knowledge', bucket: 'short', importance: '0.40', importanceStreak: 3 });
      const proposals = await evaluatePromotions();
      const p = proposals.find((x) => x.id === id);
      expect(p?.action).toBe('reset-streak');
    });

    it('emits no proposal when streak is already 0 and importance is below threshold', async () => {
      const { evaluatePromotions } = await import('@/db/queries/memory-lifecycle');
      const id = await seed({ segment: 'knowledge', bucket: 'short', importance: '0.40', importanceStreak: 0 });
      const proposals = await evaluatePromotions();
      expect(proposals.find((x) => x.id === id)).toBeUndefined();
    });

    it('proposes promote-to-permanent when long streak crosses 30', async () => {
      const { evaluatePromotions } = await import('@/db/queries/memory-lifecycle');
      const id = await seed({ segment: 'knowledge', bucket: 'long', importance: '0.85', importanceStreak: 29 });
      const proposals = await evaluatePromotions();
      const p = proposals.find((x) => x.id === id);
      expect(p?.action).toBe('promote-to-permanent');
    });

    it('fast-tracks identity short to permanent at streak=2 with one call (newStreak=3)', async () => {
      const { evaluatePromotions } = await import('@/db/queries/memory-lifecycle');
      const id = await seed({ segment: 'identity', bucket: 'short', importance: '0.85', importanceStreak: 2 });
      const proposals = await evaluatePromotions();
      const p = proposals.find((x) => x.id === id);
      expect(p?.action).toBe('promote-to-permanent');
    });

    it('does NOT fast-track at streak=1 (newStreak=2 < FAST_TRACK_STREAK_DAYS)', async () => {
      const { evaluatePromotions } = await import('@/db/queries/memory-lifecycle');
      const id = await seed({ segment: 'identity', bucket: 'short', importance: '0.85', importanceStreak: 1 });
      const proposals = await evaluatePromotions();
      const p = proposals.find((x) => x.id === id);
      expect(p?.action).toBe('advance-streak');
      if (p?.action === 'advance-streak') expect(p.newStreak).toBe(2);
    });

    it('does NOT fast-track correction segment (fast_track_permanent=false)', async () => {
      const { evaluatePromotions } = await import('@/db/queries/memory-lifecycle');
      const id = await seed({ segment: 'correction', bucket: 'short', importance: '0.85', importanceStreak: 2 });
      const proposals = await evaluatePromotions();
      const p = proposals.find((x) => x.id === id);
      // correction advances the normal short→long streak, still below 7.
      expect(p?.action).toBe('advance-streak');
    });

    it('applyPromotions bulk-updates all four action types in one transaction', async () => {
      const { evaluatePromotions, applyPromotions } = await import('@/db/queries/memory-lifecycle');
      const advanceId = await seed({ segment: 'knowledge', bucket: 'short', importance: '0.60', importanceStreak: 2 });
      const resetId   = await seed({ segment: 'knowledge', bucket: 'short', importance: '0.40', importanceStreak: 3 });
      const longId    = await seed({ segment: 'knowledge', bucket: 'short', importance: '0.60', importanceStreak: 6 });
      const permId    = await seed({ segment: 'knowledge', bucket: 'long',  importance: '0.85', importanceStreak: 29 });

      const proposals = await evaluatePromotions();
      const result = await applyPromotions(proposals);
      expect(result.advanced).toBeGreaterThanOrEqual(1);
      expect(result.reset).toBeGreaterThanOrEqual(1);
      expect(result.promotedToLong).toBeGreaterThanOrEqual(1);
      expect(result.promotedToPermanent).toBeGreaterThanOrEqual(1);

      const [advRow] = await rawSql<Array<{ importance_streak: number }>>`SELECT importance_streak FROM memories WHERE id = ${advanceId}`;
      const [resetRow] = await rawSql<Array<{ importance_streak: number }>>`SELECT importance_streak FROM memories WHERE id = ${resetId}`;
      const [longRow] = await rawSql<Array<{ bucket: string; importance_streak: number }>>`SELECT bucket, importance_streak FROM memories WHERE id = ${longId}`;
      const [permRow] = await rawSql<Array<{ bucket: string; importance_streak: number }>>`SELECT bucket, importance_streak FROM memories WHERE id = ${permId}`;
      expect(advRow!.importance_streak).toBe(3);
      expect(resetRow!.importance_streak).toBe(0);
      expect(longRow!.bucket).toBe('long');
      expect(longRow!.importance_streak).toBe(0);
      expect(permRow!.bucket).toBe('permanent');
      expect(permRow!.importance_streak).toBe(0);
    });

    it('expireTombstones dryRun returns expired rows without deleting', async () => {
      const { expireTombstones } = await import('@/db/queries/memory-lifecycle');
      const expiredId = await seed({ segment: 'knowledge', bucket: 'short', importance: '0.50', importanceStreak: 0, tombstonedAt: 'expired' });
      const freshId   = await seed({ segment: 'knowledge', bucket: 'short', importance: '0.50', importanceStreak: 0, tombstonedAt: 'fresh' });
      const candidates = await expireTombstones({ dryRun: true });
      const ids = candidates.map((r) => r.id);
      expect(ids).toContain(expiredId);
      expect(ids).not.toContain(freshId);
      // Row still exists.
      const [row] = await rawSql<Array<{ id: string }>>`SELECT id FROM memories WHERE id = ${expiredId}`;
      expect(row).toBeDefined();
    });

    it('expireTombstones (not dryRun) hard-deletes rows older than 14 days', async () => {
      const { expireTombstones } = await import('@/db/queries/memory-lifecycle');
      const expiredId = await seed({ segment: 'knowledge', bucket: 'short', importance: '0.50', importanceStreak: 0, tombstonedAt: 'expired' });
      const deleted = await expireTombstones();
      expect(deleted.find((r) => r.id === expiredId)).toBeDefined();
      const rows = await rawSql`SELECT id FROM memories WHERE id = ${expiredId}`;
      expect(rows).toHaveLength(0);
    });

    it('14-day boundary: tombstoned ~13d23h is NOT expired; ~14d1s IS expired', async () => {
      const { expireTombstones } = await import('@/db/queries/memory-lifecycle');
      // Seed two rows with explicit tombstoned_at timestamps straddling the boundary.
      const asOf = new Date();
      const beforeBoundary = new Date(asOf.getTime() - (14 * 86400 - 60) * 1000); // ~13d23h59m ago
      const afterBoundary  = new Date(asOf.getTime() - (14 * 86400 + 1)  * 1000); // ~14d1s ago
      const [notExpired] = await rawSql<Array<{ id: string }>>`
        INSERT INTO memories (segment, bucket, content, importance, embedding, tombstoned_at, metadata)
        VALUES ('knowledge', 'short', 'boundary-near', '0.50', ${JSON.stringify(zeroEmbedding())}::vector,
          ${beforeBoundary}, ${rawSql.json({ test_id: TEST_ID })})
        RETURNING id
      `;
      const [expired] = await rawSql<Array<{ id: string }>>`
        INSERT INTO memories (segment, bucket, content, importance, embedding, tombstoned_at, metadata)
        VALUES ('knowledge', 'short', 'boundary-past', '0.50', ${JSON.stringify(zeroEmbedding())}::vector,
          ${afterBoundary}, ${rawSql.json({ test_id: TEST_ID })})
        RETURNING id
      `;
      const candidates = await expireTombstones({ asOf, dryRun: true });
      const ids = candidates.map((r) => r.id);
      expect(ids).toContain(expired!.id);
      expect(ids).not.toContain(notExpired!.id);
    });
  });
  ```

- [ ] **Step 2: Run tests — expect fail**

  ```bash
  pnpm test -- memory-lifecycle.test.ts
  ```
  Expected: all fail — `evaluatePromotions`, `applyPromotions`, `expireTombstones` not exported.

- [ ] **Step 3: Extend imports and append implementation in `db/queries/memory-lifecycle.ts`**

  First, **replace** the existing single-import line at the top of the file:

  ```ts
  // before:
  import { sql } from 'drizzle-orm';
  ```

  with the expanded import set (still one statement) plus the two new schema/helper imports:

  ```ts
  import {
    and,
    eq,
    inArray,
    isNotNull,
    isNull,
    lte,
    ne,
    sql,
  } from 'drizzle-orm';
  import { memories, memorySegmentConfig } from '@/db/schema/memories';
  import { effectiveImportanceSql } from '@/lib/memory/decay-sql';
  ```

  Then **append** the code below at the bottom of the file (after the existing `reinforceMemories` function):

  ```ts
  export const PROMOTE_LONG_STREAK_DAYS = 7;
  export const PROMOTE_PERMANENT_STREAK_DAYS = 30;
  export const FAST_TRACK_STREAK_DAYS = 3;
  export const TOMBSTONE_EXPIRY_DAYS = 14;

  export type Proposal =
    | { id: string; action: 'advance-streak'; newStreak: number }
    | { id: string; action: 'reset-streak' }
    | { id: string; action: 'promote-to-long' }
    | { id: string; action: 'promote-to-permanent' };

  export interface ApplyPromotionsResult {
    advanced: number;
    reset: number;
    promotedToLong: number;
    promotedToPermanent: number;
  }

  /**
   * Pure read: compute proposed lifecycle transitions for every
   * non-tombstoned, non-permanent memory at time `asOf` (default now()).
   * Does not mutate. Caller applies via applyPromotions().
   *
   * Idempotency note: calling twice in the same 24h would double-advance
   * streaks IF both proposals are applied. Phase 04's runner calls this
   * at most once; phase 09's cron enforces once-per-day.
   */
  export async function evaluatePromotions(args?: { asOf?: Date }): Promise<Proposal[]> {
    const asOfSql = args?.asOf
      ? sql`${args.asOf}::timestamptz`
      : sql`now()`;

    const rows = await db
      .select({
        id: memories.id,
        segment: memories.segment,
        bucket: memories.bucket,
        importanceStreak: memories.importanceStreak,
        promotionThresholdLong: memorySegmentConfig.promotionThresholdLong,
        promotionThresholdPermanent: memorySegmentConfig.promotionThresholdPermanent,
        fastTrackPermanent: memorySegmentConfig.fastTrackPermanent,
        effectiveImportance: effectiveImportanceSql({
          bucket: memories.bucket,
          importance: memories.importance,
          lastAccessed: memories.lastAccessedAt,
          decayLambdaShort: memorySegmentConfig.decayLambdaShort,
          decayLambdaLongFactor: memorySegmentConfig.decayLambdaLongFactor,
          asOf: asOfSql,
        }),
      })
      .from(memories)
      .innerJoin(memorySegmentConfig, eq(memorySegmentConfig.segment, memories.segment))
      .where(and(isNull(memories.tombstonedAt), ne(memories.bucket, 'permanent')));

    const proposals: Proposal[] = [];
    for (const row of rows) {
      const effective = Number(row.effectiveImportance);
      const thresholdLong = Number(row.promotionThresholdLong);
      const thresholdPerm = Number(row.promotionThresholdPermanent);
      const currentStreak = row.importanceStreak;

      let advanceThreshold: number;
      let streakMax: number;
      if (row.bucket === 'short') {
        advanceThreshold = thresholdLong;
        streakMax = PROMOTE_LONG_STREAK_DAYS;
      } else {
        // bucket = 'long'
        advanceThreshold = thresholdPerm;
        streakMax = PROMOTE_PERMANENT_STREAK_DAYS;
      }

      const meetsThreshold = effective >= advanceThreshold;
      const newStreak = meetsThreshold ? currentStreak + 1 : 0;

      // Fast-track takes precedence when eligible.
      const fastTrackEligible =
        row.fastTrackPermanent &&
        effective >= thresholdPerm &&
        newStreak >= FAST_TRACK_STREAK_DAYS;
      if (fastTrackEligible) {
        proposals.push({ id: row.id, action: 'promote-to-permanent' });
        continue;
      }

      if (!meetsThreshold) {
        if (currentStreak > 0) {
          proposals.push({ id: row.id, action: 'reset-streak' });
        }
        // else: no-op proposal; skip.
        continue;
      }

      if (newStreak >= streakMax) {
        proposals.push({
          id: row.id,
          action: row.bucket === 'short' ? 'promote-to-long' : 'promote-to-permanent',
        });
        continue;
      }

      proposals.push({ id: row.id, action: 'advance-streak', newStreak });
    }
    return proposals;
  }

  /**
   * Apply a list of proposals in a single transaction. Groups by action
   * so each group becomes one bulk UPDATE.
   */
  export async function applyPromotions(proposals: Proposal[]): Promise<ApplyPromotionsResult> {
    const advances = proposals.filter((p): p is Extract<Proposal, { action: 'advance-streak' }> => p.action === 'advance-streak');
    const resets = proposals.filter((p) => p.action === 'reset-streak').map((p) => p.id);
    const toLong = proposals.filter((p) => p.action === 'promote-to-long').map((p) => p.id);
    const toPerm = proposals.filter((p) => p.action === 'promote-to-permanent').map((p) => p.id);

    await db.transaction(async (tx) => {
      if (advances.length > 0) {
        const valuesClause = sql.join(
          advances.map((a) => sql`(${a.id}::uuid, ${a.newStreak}::int)`),
          sql`, `,
        );
        await tx.execute(sql`
          UPDATE memories AS m
          SET importance_streak = data.streak
          FROM (VALUES ${valuesClause}) AS data(id, streak)
          WHERE m.id = data.id
        `);
      }
      if (resets.length > 0) {
        await tx
          .update(memories)
          .set({ importanceStreak: 0 })
          .where(inArray(memories.id, resets));
      }
      if (toLong.length > 0) {
        await tx
          .update(memories)
          .set({ bucket: 'long', importanceStreak: 0 })
          .where(inArray(memories.id, toLong));
      }
      if (toPerm.length > 0) {
        await tx
          .update(memories)
          .set({ bucket: 'permanent', importanceStreak: 0 })
          .where(inArray(memories.id, toPerm));
      }
    });

    return {
      advanced: advances.length,
      reset: resets.length,
      promotedToLong: toLong.length,
      promotedToPermanent: toPerm.length,
    };
  }

  export interface ExpireTombstonesArgs {
    asOf?: Date;
    dryRun?: boolean;
  }

  export interface ExpireRow {
    id: string;
    tombstonedAt: Date;
  }

  /**
   * Find (dryRun) or hard-delete memories whose tombstoned_at is older
   * than TOMBSTONE_EXPIRY_DAYS (14) from asOf (default now()).
   */
  export async function expireTombstones(args?: ExpireTombstonesArgs): Promise<ExpireRow[]> {
    const asOf = args?.asOf ?? new Date();
    const cutoff = new Date(asOf.getTime() - TOMBSTONE_EXPIRY_DAYS * 86400 * 1000);

    if (args?.dryRun) {
      const rows = await db
        .select({ id: memories.id, tombstonedAt: memories.tombstonedAt })
        .from(memories)
        .where(and(isNotNull(memories.tombstonedAt), lte(memories.tombstonedAt, cutoff)));
      return rows.map((r) => ({
        id: r.id,
        tombstonedAt: r.tombstonedAt!, // isNotNull filter guarantees this is non-null
      }));
    }

    const deleted = await db
      .delete(memories)
      .where(and(isNotNull(memories.tombstonedAt), lte(memories.tombstonedAt, cutoff)))
      .returning({ id: memories.id, tombstonedAt: memories.tombstonedAt });

    return deleted.map((r) => ({
      id: r.id,
      tombstonedAt: r.tombstonedAt!,
    }));
  }
  ```

- [ ] **Step 4: Run the lifecycle tests**

  ```bash
  pnpm test -- memory-lifecycle.test.ts
  ```
  Expected: all 11 cases pass.

- [ ] **Step 5: Typecheck + full test run (no regressions in earlier suites)**

  ```bash
  pnpm typecheck && pnpm test
  ```

- [ ] **Commit:**

  ```bash
  git add db/queries/memory-lifecycle.ts tests/memory-lifecycle.test.ts
  git commit -m "feat(phase-04): evaluatePromotions + applyPromotions + expireTombstones"
  ```

---

## Task 8 — Wire three new MCP tools + mcp-memory test edits

**Files:**
- `lib/mcp/memory.ts` (edit — register `writeTool`, `reinforceTool`, `forgetTool`; export FQN constants)
- `tests/mcp-memory.test.ts` (edit — add smoke tests for the 3 new tools)

- [ ] **Step 1: Edit `lib/mcp/memory.ts` to add the three new tools**

  Open `lib/mcp/memory.ts`. At the top add imports:

  ```ts
  import { writeMemory } from '@/db/queries/memory-write';
  import { forgetMemory } from '@/db/queries/memory-forget';
  import { reinforceMemories } from '@/db/queries/memory-lifecycle';
  ```

  Below the existing `RECALL_TOOL_FQN` export, add three new FQN constants:

  ```ts
  export const WRITE_TOOL_FQN = 'mcp__memory__write' as const;
  export const REINFORCE_TOOL_FQN = 'mcp__memory__reinforce' as const;
  export const FORGET_TOOL_FQN = 'mcp__memory__forget' as const;
  ```

  Replace the `recallTool` handler body to pass `reinforceHits: true`:

  ```ts
  async (args) => {
    try {
      const queryVector = await embedForQuery(args.query);
      const rows = await recallMemories({
        queryVector,
        queryText: args.query,
        segment: args.segment,
        topK: args.top_k,
        reinforceHits: true,
      });
      return {
        content: [
          { type: 'text', text: JSON.stringify(rows, null, 2) },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: 'text', text: `recall failed: ${msg}` }],
      };
    }
  },
  ```

  Before the existing `memoryMcpServer` export, add the three new `tool(...)` declarations:

  ```ts
  export const writeTool = tool(
    'write',
    'Store a new memory. Supply content and a segment; importance and bucket are assigned from segment defaults. Returns the new memory id.',
    {
      content: z
        .string()
        .min(1)
        .describe('The memory content. Will be embedded via Gemini for retrieval.'),
      segment: segmentSchema.describe(
        'Which of the seven segments this memory belongs to.',
      ),
      metadata: z
        .record(z.unknown())
        .optional()
        .describe('Optional structured tags (e.g., vehicle_id, customer_id).'),
    },
    async (args) => {
      try {
        const result = await writeMemory({
          content: args.content,
          segment: args.segment,
          metadata: args.metadata,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: 'text', text: `write failed: ${msg}` }],
        };
      }
    },
    { annotations: { readOnlyHint: false } },
  );

  export const reinforceTool = tool(
    'reinforce',
    'Boost importance of a specific memory (diminishing-returns formula: I ← min(1, I + 0.05·(1 − I))). Use when the agent acts on a recalled memory and wants to mark it as useful without re-querying.',
    {
      memory_id: z.string().uuid().describe('UUID of the memory to reinforce.'),
    },
    async (args) => {
      try {
        const results = await reinforceMemories([args.memory_id]);
        if (results.length === 0) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `reinforce failed: memory ${args.memory_id} not found or already tombstoned`,
              },
            ],
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(results[0], null, 2) }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: 'text', text: `reinforce failed: ${msg}` }],
        };
      }
    },
    { annotations: { readOnlyHint: false, idempotentHint: false } },
  );

  export const forgetTool = tool(
    'forget',
    'Mark a memory as forgotten (soft-delete via tombstone). Tombstoned memories do not appear in recall and are hard-deleted after 14 days. Provide a reason for auditability.',
    {
      memory_id: z.string().uuid().describe('UUID of the memory to forget.'),
      reason: z
        .string()
        .min(1)
        .max(500)
        .optional()
        .describe(
          'Why this memory is being forgotten (stored in metadata.tombstone_reason).',
        ),
    },
    async (args) => {
      try {
        const result = await forgetMemory({
          id: args.memory_id,
          reason: args.reason,
        });
        if (!result) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `forget failed: memory ${args.memory_id} not found or already tombstoned`,
              },
            ],
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: 'text', text: `forget failed: ${msg}` }],
        };
      }
    },
    { annotations: { readOnlyHint: false, destructiveHint: true } },
  );
  ```

  Update `memoryMcpServer` to include all four tools:

  ```ts
  export const memoryMcpServer = createSdkMcpServer({
    name: MEMORY_SERVER_NAME,
    version: '1.0.0',
    tools: [recallTool, writeTool, reinforceTool, forgetTool],
  });
  ```

- [ ] **Step 2: Edit `tests/mcp-memory.test.ts` — add new-tool smoke tests**

  Open `tests/mcp-memory.test.ts`. Extend the mocks at the top of the file to include the new query layers:

  ```ts
  vi.mock('@/db/queries/memory-write', () => ({
    writeMemory: vi.fn(),
  }));

  vi.mock('@/db/queries/memory-forget', () => ({
    forgetMemory: vi.fn(),
  }));

  vi.mock('@/db/queries/memory-lifecycle', () => ({
    reinforceMemories: vi.fn(),
    evaluatePromotions: vi.fn(),
    applyPromotions: vi.fn(),
    expireTombstones: vi.fn(),
    PROMOTE_LONG_STREAK_DAYS: 7,
    PROMOTE_PERMANENT_STREAK_DAYS: 30,
    FAST_TRACK_STREAK_DAYS: 3,
    TOMBSTONE_EXPIRY_DAYS: 14,
  }));
  ```

  Update the imports:

  ```ts
  import { writeMemory } from '@/db/queries/memory-write';
  import { forgetMemory } from '@/db/queries/memory-forget';
  import { reinforceMemories } from '@/db/queries/memory-lifecycle';
  import {
    memoryMcpServer,
    recallTool,
    writeTool,
    reinforceTool,
    forgetTool,
    MEMORY_SERVER_NAME,
    RECALL_TOOL_FQN,
    WRITE_TOOL_FQN,
    REINFORCE_TOOL_FQN,
    FORGET_TOOL_FQN,
  } from '@/lib/mcp/memory';
  ```

  Extend the first `it(...)` to assert four tools and all FQN constants:

  ```ts
  it('exposes four tools under name "memory"', () => {
    expect(MEMORY_SERVER_NAME).toBe('memory');
    expect(RECALL_TOOL_FQN).toBe('mcp__memory__recall');
    expect(WRITE_TOOL_FQN).toBe('mcp__memory__write');
    expect(REINFORCE_TOOL_FQN).toBe('mcp__memory__reinforce');
    expect(FORGET_TOOL_FQN).toBe('mcp__memory__forget');
    expect(memoryMcpServer).toBeDefined();
  });
  ```

  Add these new cases immediately after the existing `recallTool` handler tests:

  ```ts
  describe('writeTool', () => {
    it('returns JSON body on success', async () => {
      (writeMemory as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'uuid-1',
        bucket: 'short',
        importance: 0.6,
      });
      const result = await (writeTool as unknown as {
        handler: (args: {
          content: string;
          segment: string;
          metadata?: Record<string, unknown>;
        }) => Promise<{
          isError?: boolean;
          content: Array<{ type: string; text: string }>;
        }>;
      }).handler({ content: 'c', segment: 'knowledge' });
      expect(result.isError).toBeFalsy();
      expect(JSON.parse(result.content[0]!.text)).toEqual({
        id: 'uuid-1',
        bucket: 'short',
        importance: 0.6,
      });
    });

    it('returns isError on embed/db failure (does not throw)', async () => {
      (writeMemory as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('embed failed'),
      );
      const result = await (writeTool as unknown as {
        handler: (args: { content: string; segment: string }) => Promise<{
          isError?: boolean;
          content: Array<{ type: string; text: string }>;
        }>;
      }).handler({ content: 'x', segment: 'knowledge' });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/write failed.*embed failed/i);
    });
  });

  describe('reinforceTool', () => {
    it('returns before/after importance as JSON', async () => {
      (reinforceMemories as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'uuid-1', importanceBefore: 0.5, importance: 0.525 },
      ]);
      const result = await (reinforceTool as unknown as {
        handler: (args: { memory_id: string }) => Promise<{
          isError?: boolean;
          content: Array<{ type: string; text: string }>;
        }>;
      }).handler({ memory_id: '00000000-0000-0000-0000-000000000001' });
      expect(result.isError).toBeFalsy();
      const body = JSON.parse(result.content[0]!.text);
      expect(body).toEqual({
        id: 'uuid-1',
        importanceBefore: 0.5,
        importance: 0.525,
      });
    });

    it('returns isError on missing / tombstoned id (empty results)', async () => {
      (reinforceMemories as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const result = await (reinforceTool as unknown as {
        handler: (args: { memory_id: string }) => Promise<{
          isError?: boolean;
          content: Array<{ type: string; text: string }>;
        }>;
      }).handler({ memory_id: '00000000-0000-0000-0000-000000000002' });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/not found or already tombstoned/);
    });
  });

  describe('forgetTool', () => {
    it('returns JSON on success', async () => {
      const now = new Date();
      (forgetMemory as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'uuid-1',
        tombstonedAt: now,
      });
      const result = await (forgetTool as unknown as {
        handler: (args: {
          memory_id: string;
          reason?: string;
        }) => Promise<{
          isError?: boolean;
          content: Array<{ type: string; text: string }>;
        }>;
      }).handler({
        memory_id: '00000000-0000-0000-0000-000000000001',
        reason: 'bye',
      });
      expect(result.isError).toBeFalsy();
      const body = JSON.parse(result.content[0]!.text);
      expect(body.id).toBe('uuid-1');
    });

    it('returns isError when row is missing or already tombstoned', async () => {
      (forgetMemory as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const result = await (forgetTool as unknown as {
        handler: (args: { memory_id: string }) => Promise<{
          isError?: boolean;
          content: Array<{ type: string; text: string }>;
        }>;
      }).handler({ memory_id: '00000000-0000-0000-0000-000000000002' });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/not found or already tombstoned/);
    });
  });

  describe('tool annotations', () => {
    function annotations(t: unknown): Record<string, unknown> {
      // The SDK stores annotations on an `annotations` or `_annotations` property.
      // Treat the tool as opaque and grab whichever is present.
      const maybe = t as { annotations?: Record<string, unknown>; _annotations?: Record<string, unknown> };
      return maybe.annotations ?? maybe._annotations ?? {};
    }

    it('recallTool is readOnlyHint:true', () => {
      expect(annotations(recallTool).readOnlyHint).toBe(true);
    });

    it('writeTool is readOnlyHint:false', () => {
      expect(annotations(writeTool).readOnlyHint).toBe(false);
    });

    it('reinforceTool is idempotentHint:false', () => {
      expect(annotations(reinforceTool).idempotentHint).toBe(false);
    });

    it('forgetTool is destructiveHint:true', () => {
      expect(annotations(forgetTool).destructiveHint).toBe(true);
    });
  });
  ```

  **Note on the annotations test.** The `@anthropic-ai/claude-agent-sdk` is alpha — the property name for stored annotations has drifted between versions. The helper above checks both `annotations` and `_annotations` so the test survives a minor-version shape change. If neither is present on a future pin, the test fails loudly rather than passing a false positive.

- [ ] **Step 3: Run the MCP test suite**

  ```bash
  pnpm test -- mcp-memory.test.ts
  ```
  Expected: all existing recall cases pass + the new write/reinforce/forget cases + annotation cases all pass.

- [ ] **Step 4: Full test run — no regressions**

  ```bash
  pnpm typecheck && pnpm lint && pnpm test
  ```

- [ ] **Commit:**

  ```bash
  git add lib/mcp/memory.ts tests/mcp-memory.test.ts
  git commit -m "feat(phase-04): register write/reinforce/forget MCP tools"
  ```

---

## Task 9 — Demo script (phase 04 "done" signal)

**Files:**
- `scripts/memory-demo.ts` (new)
- `package.json` (edit — add `memory:demo` script)

- [ ] **Step 1: Write the script**

  ```ts
  // scripts/memory-demo.ts
  import 'dotenv/config';
  import { db } from '@/db/client';
  import { memories } from '@/db/schema/memories';
  import { and, eq, sql } from 'drizzle-orm';
  import { writeMemory } from '@/db/queries/memory-write';
  import { recallMemories } from '@/db/queries/memory-recall';
  import { forgetMemory } from '@/db/queries/memory-forget';
  import {
    reinforceMemories,
    evaluatePromotions,
    expireTombstones,
  } from '@/db/queries/memory-lifecycle';
  import { embedForQuery } from '@/lib/embeddings';

  const TEST_ID = 'phase-04-demo';

  interface SeedResult {
    id: string;
    segment: string;
    importance: number;
    content: string;
  }

  async function stage1_write(): Promise<SeedResult[]> {
    console.log('\n=== stage 1: write six memories ===');
    const fixtures = [
      { segment: 'identity' as const,    content: 'user name is Alice; operates a fleet of lease sedans' },
      { segment: 'identity' as const,    content: 'dispatcher is based in Bremen, DE' },
      { segment: 'preference' as const,  content: 'dispatcher prefers morning service appointments' },
      { segment: 'preference' as const,  content: 'user prefers email notifications over SMS' },
      { segment: 'knowledge' as const,   content: 'oil change interval for lease sedan fleet: 5000 miles' },
      { segment: 'correction' as const,  content: 'the service interval was updated to 7500 miles in 2025' },
    ];
    const results: SeedResult[] = [];
    for (const f of fixtures) {
      const r = await writeMemory({
        content: f.content,
        segment: f.segment,
        metadata: { test_id: TEST_ID },
      });
      console.log(`  [${f.segment.padEnd(12)}] ${r.id} importance=${r.importance.toFixed(2)}  "${f.content.slice(0, 60)}"`);
      results.push({ id: r.id, segment: f.segment, importance: r.importance, content: f.content });
    }
    return results;
  }

  async function stage2_recall_with_reinforce(): Promise<void> {
    console.log('\n=== stage 2: recall with auto-reinforce ===');
    const q = 'when is the next oil change due for the lease fleet?';
    console.log(`  query: "${q}"`);
    const vec = await embedForQuery(q);
    const rows = await recallMemories({
      queryVector: vec,
      queryText: q,
      topK: 4,
      reinforceHits: true,
    });
    for (const r of rows) {
      console.log(
        `  [${r.segment.padEnd(12)}] imp=${r.importance}  sim=${r.cosineSim.toFixed(3)}  rank=${r.tsRank.toFixed(3)}  score=${r.score.toFixed(3)}  "${r.content.slice(0, 60)}"`,
      );
    }
  }

  async function stage3_explicit_reinforce(seeds: SeedResult[]): Promise<void> {
    console.log('\n=== stage 3: explicit reinforce (preference — lower starting importance shows a cleaner curve) ===');
    const target = seeds.find((s) => s.segment === 'preference');
    if (!target) throw new Error('no preference seed');
    console.log(`  target: ${target.id} (initial from stage 1=${target.importance.toFixed(2)}; current DB value may differ if stage 2 hit it)`);
    for (let i = 0; i < 3; i++) {
      const [r] = await reinforceMemories([target.id]);
      console.log(
        `  iter ${i + 1}: importance_before=${r?.importanceBefore.toFixed(4)}  importance_after=${r?.importance.toFixed(4)}`,
      );
    }
  }

  async function stage4_forget(seeds: SeedResult[]): Promise<void> {
    console.log('\n=== stage 4: forget ===');
    const target = seeds.find((s) => s.segment === 'correction');
    if (!target) throw new Error('no correction seed');
    const result = await forgetMemory({
      id: target.id,
      reason: 'phase-04 demo: superseded by a newer correction memory',
    });
    console.log(`  forgot ${target.id} at ${result?.tombstonedAt.toISOString()}`);

    const q = 'what is the service interval?';
    const vec = await embedForQuery(q);
    const rows = await recallMemories({ queryVector: vec, queryText: q, topK: 5 });
    const stillPresent = rows.find((r) => r.id === target.id);
    console.log(`  recall returned ${rows.length} rows; forgotten row present: ${stillPresent ? 'YES (BUG)' : 'no'}`);
  }

  async function stage5_promote_dryrun(seeds: SeedResult[]): Promise<void> {
    console.log('\n=== stage 5: evaluatePromotions (dry-run, promotes a high-importance short-term row) ===');
    const target = seeds.find((s) => s.segment === 'preference');
    if (!target) throw new Error('no preference seed');
    await db
      .update(memories)
      .set({ importance: '0.80', importanceStreak: 6 })
      .where(eq(memories.id, target.id));
    const proposals = await evaluatePromotions();
    const demoProposal = proposals.find((p) => p.id === target.id);
    console.log(`  proposal for ${target.id}: ${JSON.stringify(demoProposal)}`);
    console.log(`  (applyPromotions NOT called — this is a preview)`);
  }

  async function stage6_expire_dryrun(seeds: SeedResult[]): Promise<void> {
    console.log('\n=== stage 6: expireTombstones (dry-run) ===');
    const target = seeds.find((s) => s.segment === 'correction');
    if (!target) throw new Error('no correction seed');
    // Backdate the already-tombstoned row to 15 days ago.
    await db
      .update(memories)
      .set({ tombstonedAt: sql`now() - interval '15 days'` })
      .where(eq(memories.id, target.id));
    const candidates = await expireTombstones({ dryRun: true });
    const hit = candidates.find((c) => c.id === target.id);
    console.log(`  candidate for expiry: ${hit ? hit.id + ' (tombstoned ' + hit.tombstonedAt.toISOString() + ')' : 'none (BUG)'}`);
    console.log(`  (hard delete NOT performed — dry-run)`);
  }

  async function stage7_cleanup(): Promise<void> {
    console.log('\n=== stage 7: cleanup ===');
    const deleted = await db
      .delete(memories)
      .where(sql`metadata->>'test_id' = ${TEST_ID}`)
      .returning({ id: memories.id });
    console.log(`  deleted ${deleted.length} rows`);
    const countRows = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(memories)
      .where(sql`metadata->>'test_id' = ${TEST_ID}`);
    const remaining = countRows[0]?.count ?? 0;
    if (remaining !== 0) {
      throw new Error(`cleanup incomplete: ${remaining} rows remain`);
    }
    console.log(`  verified: 0 rows remain with test_id=${TEST_ID}`);
  }

  async function run(): Promise<void> {
    let seeds: SeedResult[] = [];
    try {
      seeds = await stage1_write();
      await stage2_recall_with_reinforce();
      await stage3_explicit_reinforce(seeds);
      await stage4_forget(seeds);
      await stage5_promote_dryrun(seeds);
      await stage6_expire_dryrun(seeds);
    } finally {
      await stage7_cleanup();
    }
  }

  run().then(
    () => {
      console.log('\n✓ memory-demo complete');
      process.exit(0);
    },
    (err) => {
      console.error('\n✗ memory-demo failed:', err);
      process.exit(1);
    },
  );
  ```

- [ ] **Step 2: Add the pnpm script**

  Edit `package.json`'s `scripts` object; keep existing keys, add:

  ```json
  "memory:demo": "tsx --env-file .env.local scripts/memory-demo.ts"
  ```

  (Use `--env-file` identically to phase 03's `recall:demo` entry.)

- [ ] **Step 3: Run the demo**

  ```bash
  pnpm memory:demo
  ```
  Expected: all 7 stages print their output; final line is `✓ memory-demo complete`. Verify cleanup on your own with a manual SQL query:

  ```bash
  pnpm exec tsx -e "import('./db/client').then(async ({ db }) => { const r = await db.execute(\"SELECT COUNT(*)::int AS n FROM memories WHERE metadata->>'test_id' = 'phase-04-demo'\"); console.log(r); process.exit(0); })"
  ```
  Expected: `[{ n: 0 }]`.

- [ ] **Commit:**

  ```bash
  git add scripts/memory-demo.ts package.json
  git commit -m "feat(phase-04): memory-demo tsx script (visible done signal)"
  ```

---

## Task 10 — Full CI loop + README update

- [ ] **Step 1: Run the gauntlet**

  ```bash
  pnpm typecheck && pnpm lint && pnpm test && pnpm build
  ```
  Expected: all four pass. Specifically, test run shows:
  - `embeddings` (4/4) — unchanged
  - `mcp-memory` (1 + 2 + 2 + 2 + 2 + 4 = 13, approximately) — existing + new tool handlers + annotations
  - `memory-recall` (6 + 2 = 8) — existing + new auto-reinforce cases
  - `memory-write` (5/5) — new
  - `memory-reinforce` (7/7) — new
  - `memory-forget` (5/5) — new
  - `memory-lifecycle` (11/11) — new
  - `schema` / `health` — unchanged from phase 02/03

- [ ] **Step 2: Update `README.md` Quickstart**

  Under the existing `## Scripts` section, add `memory:demo` below `recall:demo`:

  ```md
  - `pnpm memory:demo` — end-to-end memory lifecycle dry-run: write six memories, recall with auto-reinforce, explicit reinforce, forget, evaluate promotion proposal, evaluate tombstone-expiry candidate, clean up (phase 04 end-to-end sanity check)
  ```

  Under `## Env vars`, no change — `GEMINI_API_KEY` is already documented from phase 03.

- [ ] **Commit:**

  ```bash
  git add README.md
  git commit -m "docs(phase-04): note memory:demo in README scripts"
  ```

---

## Task 11 — Open the phase 04 PR

- [ ] **Step 1: Final push**

  ```bash
  git push origin phase/04-memory-mcp-write
  ```

- [ ] **Step 2: Open PR via `gh`**

  Title **must** start with `phase 04:`. Body links to spec + plan + plan §§.

  ```bash
  gh pr create --base main --head phase/04-memory-mcp-write \
    --title "phase 04: memory MCP (write / reinforce / forget)" \
    --body "$(cat <<'EOF'
  ## Summary

  - Adds three new MCP tools to `memoryMcpServer`: `write`, `reinforce`, `forget`. Agent-callable via `mcp__memory__write` / `mcp__memory__reinforce` / `mcp__memory__forget`.
  - Recall-time auto-reinforce: `recallMemories({ reinforceHits: true })` bulk-boosts hit rows (`I ← min(1.0, I + 0.05·(1 − I))`, `access_count += 1`, `last_accessed_at = now()`). The MCP `recall` handler opts in; the TS function defaults to `false` so demos / tests stay side-effect-free.
  - `forget` is a soft-delete via tombstone + `metadata.tombstone_reason` — reversible for 14 days. Hard delete happens in `expireTombstones`, not here.
  - Two pure lifecycle functions: `evaluatePromotions()` computes short→long (streak ≥ 7 at effective ≥ segment threshold), long→permanent (streak ≥ 30 at effective ≥ threshold), and identity fast-track (streak ≥ 3 at effective ≥ 0.80 via `memory_segment_config.fast_track_permanent`). `applyPromotions` bulk-updates in one transaction. Phase 09 will schedule these via Inngest cron.
  - Refactor: phase 03's inline decay SQL extracted into `lib/memory/decay-sql.ts` (`effectiveImportanceSql`) so recall + promotion evaluation share one source of truth. Phase 03 tests still pass unmodified.
  - Ships a `pnpm memory:demo` script as the visible done signal — walks through write → recall+reinforce → explicit reinforce → forget → promote-dryrun → expire-dryrun → cleanup, cleanly.
  - Zero new dependencies.

  ## Plan references

  - `auto-ride-initial-plan.md` §5 (three buckets, Ebbinghaus decay, reinforcement formula, promotion thresholds, tombstone-not-delete, 14-day window)
  - `docs/roadmap/ROADMAP.md` — phase 04 row
  - Design: `docs/superpowers/specs/2026-04-22-phase-04-memory-mcp-write-design.md`
  - Plan: `docs/superpowers/plans/2026-04-22-phase-04-memory-mcp-write-plan.md`

  ## Test plan

  - [ ] Worktree identity verified (`shahriarbijoy` / `shahriarbijoy@gmail.com`)
  - [ ] `pnpm typecheck` passes
  - [ ] `pnpm lint` passes
  - [ ] `pnpm test` passes — all phase-03 suites unchanged; new suites: memory-write (5/5), memory-reinforce (7/7), memory-forget (5/5), memory-lifecycle (11/11); memory-recall gains 2 auto-reinforce cases; mcp-memory gains smoke tests for the 3 new tools + annotations
  - [ ] `pnpm build` passes (`/health` route regression check)
  - [ ] `pnpm memory:demo` completes all 7 stages; final line is `✓ memory-demo complete`; zero rows remain with `test_id=phase-04-demo` after exit
  - [ ] `memoryMcpServer.tools` length is 4; all four FQN constants (`mcp__memory__{recall,write,reinforce,forget}`) exported
  - [ ] `package.json` gains no new dependencies
  EOF
  )"
  ```

- [ ] **Step 3: Link the PR URL here** (optional — overwrite after creation).

---

## Post-merge housekeeping

After the PR is squash-merged on GitHub:

- [ ] Fast-forward local main: `git switch main && git pull --ff-only origin main`.
- [ ] `git worktree remove .worktree/phase-04-memory-mcp-write` (only if nothing uncommitted — guardrail hook blocks `--force`).
- [ ] `git branch -d phase/04-memory-mcp-write` (safe delete — guardrail hook blocks `-D`).

Phase 05 (first `query()`) picks up from the same main HEAD and reuses:
- `memoryMcpServer` with all four tools — registered on the orchestrator's `mcpServers`.
- `WRITE_TOOL_FQN` / `RECALL_TOOL_FQN` / `REINFORCE_TOOL_FQN` / `FORGET_TOOL_FQN` — listed in `allowedTools`.
- The `isError`-return pattern (never throw) as the handler shape for phase 05's `db` MCP server.

Phase 09 (nightly cleanup) reuses `evaluatePromotions` as the candidate source for the 3-agent debate, wraps `applyPromotions` behind the judge verdict, and schedules `expireTombstones({ dryRun: false })` at the end of each nightly run.
