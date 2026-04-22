# Phase 04 — Memory MCP (write / reinforce / forget) (design)

**Date:** 2026-04-22
**Status:** approved (brainstorming)
**Plan references:** `auto-ride-initial-plan.md` §5
**Roadmap entry:** `docs/roadmap/ROADMAP.md` — phase 04

## Purpose

Extend the `memory` MCP server from phase 03 with the three remaining lifecycle tools (`write`, `reinforce`, `forget`), wire recall-time automatic reinforcement into `recallMemories`, and land the two pure promotion/expiry functions (`evaluatePromotions`, `expireTombstones`) that phase 09's nightly cron will later schedule. Decay math is extracted from the current recall query into a shared SQL fragment so recall, promotion evaluation, and the demo runner share one expression.

Phase 04 ships the *mechanical* half of memory lifecycle. Phase 09 adds the 3-agent Consolidator / Adversary / Judge debate, the Inngest cron, and the `memory_cleanup_runs` / `memory_cleanup_proposals` log writes on top of phase 04's pure functions.

## Non-goals

Explicitly out of scope — do not add them even if convenient:

- Inngest cron scheduler for promotion / tombstone expiry (phase 09).
- The 3-agent Consolidator / Adversary / Judge debate (phase 09).
- `memory_cleanup_runs` / `memory_cleanup_proposals` row writes (phase 09).
- Agent orchestrator + subagents + any `query()` call (phase 05).
- `canUseTool` gate / Inngest `waitForEvent` (phase 07).
- Langfuse / OTel instrumentation around the MCP tools (phase 12).
- SSE endpoint, task runner, task-event writes (phase 06).
- UI (phase 06 onwards).
- Better Auth / login gate (phase 11).
- Adding / altering database columns — phase 02 schema is sufficient.

## Cost check

Near-zero incremental cost.

- **Gemini embeddings:** `embedForDocument` is called once per `write` invocation. The demo script writes ~6 memories; the integration tests write ~20 seed rows (direct SQL, no Gemini — handcrafted vectors like phase 03). Demo budget impact: pennies, bounded by the free tier. Phase 03's live-only test already verifies the Gemini round-trip.
- **Neon:** no new tables, no new indexes, no migrations.
- **Anthropic API:** untouched this phase. No `query()` call is made, so no Claude tokens are spent — keeps phase 04 independent of the phase 05 auth-path decision.

## Dependencies

**No new packages.** Everything builds on phase 02 (`drizzle-orm`, `@neondatabase/serverless`) and phase 03 (`@anthropic-ai/claude-agent-sdk@0.2.117`, `@google/genai@1.50.1`).

**APIs reused from phase 03:**

| Need | API | Import |
|---|---|---|
| Embed a document | `embedForDocument(text)` | `@/lib/embeddings` |
| In-process MCP server | `createSdkMcpServer`, `tool(…)` | `@anthropic-ai/claude-agent-sdk` |
| Drizzle cosine distance | `cosineDistance(col, vector)` | `drizzle-orm` |
| Segment zod enum | `z.enum(segmentEnum.enumValues)` | phase 03's `lib/mcp/memory.ts` |

## Directory layout (delta from phase 03)

Phase 02/03 flat layout continues. Three new query files, one new SQL helper, four new test files, one new script, two edits.

```
Agent-swarm/
├── db/
│   └── queries/
│       ├── memory-recall.ts          # EDIT — add reinforceHits option
│       ├── memory-write.ts           # NEW — writeMemory()
│       ├── memory-forget.ts          # NEW — forgetMemory()
│       └── memory-lifecycle.ts       # NEW — reinforceMemories, evaluatePromotions, applyPromotions, expireTombstones
├── lib/
│   └── memory/
│       └── decay-sql.ts              # NEW — shared SQL fragment for effective_importance
├── lib/mcp/
│   └── memory.ts                     # EDIT — register writeTool, reinforceTool, forgetTool
├── scripts/
│   └── memory-demo.ts                # NEW — visible done signal
├── tests/
│   ├── memory-recall.test.ts         # EDIT — add reinforceHits assertions
│   ├── memory-write.test.ts          # NEW
│   ├── memory-reinforce.test.ts      # NEW
│   ├── memory-forget.test.ts         # NEW
│   ├── memory-lifecycle.test.ts      # NEW
│   └── mcp-memory.test.ts            # EDIT — smoke tests for 3 new tools
└── docs/superpowers/
    ├── specs/2026-04-22-phase-04-memory-mcp-write-design.md   # NEW — this file
    └── plans/2026-04-22-phase-04-memory-mcp-write-plan.md     # NEW
```

`lib/memory/` is a new directory. It owns the pure math that both the query layer and the promotion evaluator consume. Phase 09 will add `lib/memory/consolidator-prompt.ts` / `adversary-prompt.ts` alongside it.

## Architecture

### 1. Shared decay SQL fragment — `lib/memory/decay-sql.ts`

Exports `effectiveImportanceSql(bucketCol, importanceCol, lastAccessedCol, configLambdaShort, configLambdaLongFactor)` — a `sql<number>` fragment that evaluates effective importance for a single row at `now()`. Also exports `effectiveImportanceAsOfSql(…, asOfParam)` which takes an `asOf` timestamp parameter (for `evaluatePromotions({ asOf })` tests that need deterministic time travel).

```
effective_importance(row, asOf) =
  CASE row.bucket
    WHEN 'permanent' THEN row.importance
    WHEN 'short'     THEN row.importance * exp(-config.decay_lambda_short * days_since(row.last_accessed_at, asOf))
    WHEN 'long'      THEN row.importance * exp(-config.decay_lambda_long_factor * (1 - 0.8*row.importance) * days_since(…))
  END
```

`days_since(a, b) = extract(epoch from (b - a)) / 86400.0`.

**Why extract this.** Phase 03's `memory-recall.ts` inlines the same expression. Phase 04 needs it in two new places (`evaluatePromotions`, demo runner). Keeping one source of truth prevents drift across the three call sites — plan §5's decay formula is explicit about the coefficients, and a silent divergence between recall ordering and promotion evaluation would be very hard to spot.

**Why no TS port.** `importance` is `numeric(3,2)` and comes back as `string` from drizzle; doing the math in JS invites coercion bugs. The shared fragment keeps math server-side.

Phase 03's `memory-recall.ts` is refactored to consume the shared fragment as part of phase 04 (the in-scope edit). Behavior is unchanged; the three phase-03 recall tests must still pass post-refactor.

### 2. Write query + tool — `db/queries/memory-write.ts` + `lib/mcp/memory.ts` edit

#### Query layer: `writeMemory({ content, segment, metadata })`

```ts
async function writeMemory(args: {
  content: string;
  segment: SegmentValue;
  metadata?: Record<string, unknown>;
}): Promise<{ id: string; bucket: 'short'; importance: number }>;
```

Flow:

1. `const embedding = await embedForDocument(args.content);` — reuses phase 03's helper. Returns unit-norm 1536-dim `number[]`.
2. Look up `memory_segment_config.default_importance` for `args.segment` — done in a single `INSERT … SELECT FROM memory_segment_config` so the default isn't read-then-written in two round-trips.
3. `INSERT INTO memories (segment, bucket, content, embedding, importance, metadata) SELECT $1, 'short', $2, $3, default_importance, $4 FROM memory_segment_config WHERE segment = $1 RETURNING id, bucket, importance`. `content_tsv` populates via the phase-02 generated column; `importance_streak` defaults to 0; `created_at` / `last_accessed_at` default to `now()`.
4. Return `{ id, bucket: 'short', importance: Number(row.importance) }` — convert numeric→number at the response boundary only.

**Server-owned invariants (enforced by the query, not the caller):**

- `bucket` is always `'short'` at write time. Promotions are the only way to leave short.
- `importance` always starts at `memory_segment_config.default_importance` for the segment. Reinforce-after-write is the only way to increase it from the initial value at write time.
- `tombstoned_at` is null.

**Error behavior.** Gemini or DB errors throw from `writeMemory`. The MCP tool handler wraps them in `{ isError: true, content: [...] }`.

#### Tool layer: `writeTool` in `lib/mcp/memory.ts`

```ts
tool(
  'write',
  'Store a new memory. The agent supplies content and a segment; importance and bucket are assigned from segment defaults. Returns the new memory id.',
  {
    content: z.string().min(1).describe('The memory content. Will be embedded for retrieval.'),
    segment: segmentSchema.describe('Which of the seven segments this memory belongs to.'),
    metadata: z.record(z.unknown()).optional().describe('Optional structured tags (e.g., vehicle_id, customer_id).'),
  },
  async (args) => { /* writeMemory + stringify */ },
  { annotations: { readOnlyHint: false } },
)
```

Fully-qualified name: `mcp__memory__write`. Exported as `WRITE_TOOL_FQN` constant for phase 05's `allowedTools` reference.

### 3. Reinforce query + tool — `db/queries/memory-lifecycle.ts` (reinforce half) + MCP tool

#### Query layer: `reinforceMemories(ids)`

```ts
async function reinforceMemories(
  ids: string[],
): Promise<{ id: string; importance: number; importanceBefore: number }[]>;
```

Flow: single bulk UPDATE — `importance = LEAST(1.0, importance + 0.05*(1-importance))::numeric(3,2)`, `access_count = access_count + 1`, `last_accessed_at = now()` WHERE `id = ANY($1)` AND `tombstoned_at IS NULL` RETURNING old + new importance via a CTE (`WITH before AS (SELECT id, importance FROM memories WHERE id = ANY($1)), updated AS (UPDATE … RETURNING *) SELECT before.importance as importance_before, updated.importance FROM updated JOIN before USING (id)`).

The `LEAST(1.0, …)` gives the saturation behavior from plan §5. Writing `importance + 0.05*(1-importance)` directly in SQL keeps numeric→string→numeric round-trips out.

If any id is not found or is tombstoned, it's silently skipped (the CTE join filter handles this). The caller gets back only the rows that were actually updated.

#### Recall-time integration: `recallMemories({ ..., reinforceHits })`

`RecallArgs` gains `reinforceHits?: boolean` with default `false`. When `true` and the final rerank returns ≥ 1 row, `reinforceMemories(rows.map(r => r.id))` is called once, and the returned `importance` values are merged into the recall result (so the agent sees post-boost values).

**Why opt-in on the TS function.** Integration tests and the demo script must be able to call `recallMemories` without mutating state. Making it opt-in means the default is side-effect-free; only the MCP tool handler passes `true`.

**Tool-handler change:** `recallTool.handler` passes `reinforceHits: true`. The only touch to phase-03 MCP code is this single-argument addition.

#### Tool layer: `reinforceTool` in `lib/mcp/memory.ts`

```ts
tool(
  'reinforce',
  'Boost importance of a specific memory (diminishing-returns formula). Use when the agent acts on a recalled memory and wants to mark it as useful without re-querying.',
  {
    memory_id: z.string().uuid().describe('UUID of the memory to reinforce.'),
  },
  async (args) => { /* reinforceMemories([id]), return before/after */ },
  { annotations: { readOnlyHint: false, idempotentHint: false } },
)
```

Fully-qualified name: `mcp__memory__reinforce`. Exported as `REINFORCE_TOOL_FQN`.

**`idempotentHint: false`** — calling reinforce twice gives two boosts. The SDK's annotation matches the actual behavior.

### 4. Forget query + tool — `db/queries/memory-forget.ts` + MCP tool

#### Query layer: `forgetMemory({ id, reason? })`

```ts
async function forgetMemory(args: {
  id: string;
  reason?: string;
}): Promise<{ id: string; tombstonedAt: Date } | null>;
```

Flow: `UPDATE memories SET tombstoned_at = now(), metadata = metadata || jsonb_build_object('tombstone_reason', $2) WHERE id = $1 AND tombstoned_at IS NULL RETURNING id, tombstoned_at`. If the row is already tombstoned or missing, returns `null` and the MCP tool surfaces that as an `isError: true` with a clean message — the agent gets a loud "that memory is already forgotten" signal instead of a silent no-op.

**Hard delete is out of scope.** Plan §5 is explicit: tombstone for fourteen days so verdicts are reversible. `expireTombstones()` is the only code path that hard-deletes, and only after the 14-day window.

#### Tool layer: `forgetTool` in `lib/mcp/memory.ts`

```ts
tool(
  'forget',
  'Mark a memory as forgotten (soft-delete via tombstone). Tombstoned memories do not appear in recall and are hard-deleted after 14 days. Provide a reason for auditability.',
  {
    memory_id: z.string().uuid().describe('UUID of the memory to forget.'),
    reason: z.string().min(1).max(500).optional().describe('Why this memory is being forgotten (stored in metadata.tombstone_reason).'),
  },
  async (args) => { /* forgetMemory(…), return result or isError */ },
  { annotations: { readOnlyHint: false, destructiveHint: true } },
)
```

Fully-qualified name: `mcp__memory__forget`. Exported as `FORGET_TOOL_FQN`.

**`destructiveHint: true`** — plan §8 predicts agents will over-call destructive tools; the SDK annotation gives phase 07's `canUseTool` gate a clean signal to require approval for every `forget` call.

### 5. Pure promotion + expiry functions — `db/queries/memory-lifecycle.ts` (second half)

Hardcoded streak-day constants (not in config — not per-segment tunable):

```ts
const PROMOTE_LONG_STREAK_DAYS = 7;
const PROMOTE_PERMANENT_STREAK_DAYS = 30;
const FAST_TRACK_STREAK_DAYS = 3;
const TOMBSTONE_EXPIRY_DAYS = 14;
```

#### `evaluatePromotions({ asOf? })` — pure read

```ts
type Proposal =
  | { id: string; action: 'advance-streak'; newStreak: number }
  | { id: string; action: 'reset-streak' }
  | { id: string; action: 'promote-to-long'; newStreak: 0 }
  | { id: string; action: 'promote-to-permanent'; newStreak: 0 };

async function evaluatePromotions(args?: { asOf?: Date }): Promise<Proposal[]>;
```

Reads every non-tombstoned, non-permanent memory. For each, computes `effective_importance(asOf)` using the shared SQL fragment, then decides:

1. **If `bucket='short'`**: check against `config.promotion_threshold_long` (typically 0.50). If effective ≥ threshold, emit `advance-streak` or `promote-to-long` depending on whether the new streak hits `PROMOTE_LONG_STREAK_DAYS`. Else emit `reset-streak`.
2. **If `bucket='long'`**: check against `config.promotion_threshold_permanent` (typically 0.80). Same advance / promote / reset logic, but with `PROMOTE_PERMANENT_STREAK_DAYS = 30`.
3. **Fast-track, applied in addition to (1)/(2):** if `config.fast_track_permanent = true` for the row's segment AND effective ≥ `config.promotion_threshold_permanent` AND the (newly advanced) streak ≥ `FAST_TRACK_STREAK_DAYS`, emit `promote-to-permanent` instead of whatever rule 1/2 would have produced. Identity is the only segment seeded with this flag (`0002_seed_segment_config.sql`).

**Precedence:** fast-track wins over the normal long→permanent rule, because a row in `bucket='long'` with segment=`identity` shouldn't have to wait the full 30 days if its config says fast-track.

The function issues **one SQL query** that returns a table of `(id, current_bucket, segment, current_streak, effective_importance, long_threshold, permanent_threshold, fast_track_permanent)` — the TS side iterates once over the result and emits proposals. No N+1.

**No writes.** Callers apply proposals through `applyPromotions`; keeping evaluate pure means phase 09's debate code can receive a proposal list and ask the 3-agent debate "should we do these?" before anything mutates.

#### `applyPromotions(proposals)` — single bulk UPDATE

Groups proposals by action, issues up to four UPDATE statements in a single transaction:

- `advance-streak`: `UPDATE memories SET importance_streak = $new WHERE id = ANY($ids)` — new streak is proposal-specific, so this becomes `UPDATE … SET importance_streak = data.streak FROM (VALUES …) AS data(id, streak) WHERE memories.id = data.id`.
- `reset-streak`: `UPDATE memories SET importance_streak = 0 WHERE id = ANY($ids)`.
- `promote-to-long`: `UPDATE memories SET bucket = 'long', importance_streak = 0 WHERE id = ANY($ids)`.
- `promote-to-permanent`: `UPDATE memories SET bucket = 'permanent', importance_streak = 0 WHERE id = ANY($ids)`.

Returns `{ advanced: number; reset: number; promotedToLong: number; promotedToPermanent: number }`.

#### `expireTombstones({ asOf?, dryRun? })` — conditional hard delete

```ts
async function expireTombstones(args?: {
  asOf?: Date;
  dryRun?: boolean;
}): Promise<{ id: string; tombstonedAt: Date }[]>;
```

Finds rows where `tombstoned_at <= (asOf ?? now()) - interval '14 days'`. If `dryRun: true`, returns the matching rows without deleting. If `dryRun: false` (default), `DELETE FROM memories WHERE tombstoned_at <= … RETURNING id, tombstoned_at`.

### 6. Demo script — `scripts/memory-demo.ts`

**This is the phase's visible done signal.** A `tsx` script that exercises every new code path end-to-end, prints each stage, and cleans up on exit. All rows tagged `metadata.test_id = 'phase-04-demo'` for failure-mode cleanup.

Stages (all sequential, numbered in stdout):

1. **Write.** Call `writeMemory` six times across four segments — e.g., two `identity` ("user's name is …", "user drives a … lease"), two `preference` ("prefers email notifications", "favors morning service appointments"), one `knowledge` ("oil change interval = 5000 mi for sedan"), one `correction` ("actually, the service interval was updated to 7500 mi in 2025"). Print each new `id` and its `importance`. Verify importance matches the seeded segment defaults (0.90 / 0.70 / 0.60 / 0.80).
2. **Recall with auto-reinforce.** Call `recallMemories({ reinforceHits: true, queryText: 'when is the next oil change due?', … })`. Print top-K rows as a table (content, segment, importance_before → importance_after, cosineSim, tsRank, effectiveImportance, score). One row should be the oil-change memory; its importance bump matches `0.05*(1 - 0.60) = 0.02`.
3. **Explicit reinforce.** Call `reinforceMemories([identity_id])` twice. Print the importance curve: `0.90 → 0.905 → 0.9098` (the saturation behavior). Asserts `importance ≤ 1.0`.
4. **Forget.** Call `forgetMemory({ id: correction_id, reason: 'phase-04 demo: superseded memory' })`. Re-run recall and show the forgotten row is absent.
5. **Promote dry-run.** Directly SQL-update one short-term memory to `importance_streak = 6, importance = 0.80`. Call `evaluatePromotions({ asOf: now() })` and print the proposals — one should be `promote-to-long` for that row. `applyPromotions(…)` is NOT called — dry-run only.
6. **Expire dry-run.** Directly SQL-update one tombstoned row to `tombstoned_at = now() - interval '15 days'`. Call `expireTombstones({ asOf: now(), dryRun: true })` and print the row that would be hard-deleted. Actual delete skipped.
7. **Cleanup.** `DELETE FROM memories WHERE metadata->>'test_id' = 'phase-04-demo'`. Verify `SELECT COUNT(*) = 0`.

Runs against the real Neon dev DB and real Gemini (free tier). Not part of `pnpm test`. Invoked manually as `pnpm memory:demo`. Exits non-zero on any stage failure (so `pnpm memory:demo` is a portfolio-worthy "smoke the whole lifecycle" command).

**Why manual, not an integration test.** The stage output is the point — an interviewer or future-me wants to see the importance curve, the proposals list, the cleanup narration. Embedding this in vitest would bury the narrative.

## Testing

Six vitest files — one edit, four new, one edit. All run under `pnpm test`. Integration tests skip automatically if `DATABASE_URL_UNPOOLED` is unset (phase 02 pattern).

### `tests/memory-recall.test.ts` (EDIT — phase 03 suite)

Add three new cases to the existing suite:

1. `recallMemories({ reinforceHits: false, … })` leaves `importance` unchanged across two consecutive calls.
2. `recallMemories({ reinforceHits: true, … })` boosts `importance` on returned rows by exactly `0.05*(1 - importance_before)`, and `access_count` increments by 1.
3. Re-run the EXPLAIN HNSW regression test after refactoring to use the shared `effectiveImportanceSql` fragment — confirms the refactor doesn't break HNSW index selection.

### `tests/memory-write.test.ts` (NEW — integration)

Uses a stubbed `embedForDocument` (deterministic handcrafted vector) to avoid Gemini hits in CI.

1. `writeMemory({ content, segment: 'knowledge', … })` creates a row with `bucket='short'`, `importance = 0.60` (knowledge default), `embedding.length = 1536`, `importance_streak = 0`, `tombstoned_at = null`.
2. `writeMemory({ …, segment: 'identity' })` produces a row with `importance = 0.90` (identity default).
3. `metadata` round-trips: `{foo: 'bar', vehicle_id: 'v1'}` written and read back unchanged.
4. `content_tsv` is populated (non-null) via the generated column — verifies phase 02's generator still fires on writes done through phase 04's query.
5. Callers cannot force `bucket='long'` or override `importance` — the query schema doesn't accept those fields. Typecheck-level assertion (`@ts-expect-error`).

### `tests/memory-reinforce.test.ts` (NEW — integration)

1. Seed a row with `importance = 0.5`. `reinforceMemories([id])` → importance = `0.5 + 0.05 * 0.5 = 0.525`.
2. Seed at `0.99`. `reinforceMemories([id])` → `0.99 + 0.05 * 0.01 = 0.9905` → stored as `numeric(3,2)` = `0.99` (rounds down — **verify** this is the saturation-plus-numeric-precision interaction).
3. Seed at `1.00`. `reinforceMemories([id])` → stays at `1.00` (LEAST guard).
4. `access_count` increments by exactly 1 per reinforce.
5. `last_accessed_at` bumps to now() ± 2s.
6. Reinforcing a tombstoned row is a no-op (returned array length is 0).
7. Reinforcing a bulk of 5 ids issues one UPDATE, not five.

### `tests/memory-forget.test.ts` (NEW — integration)

1. `forgetMemory({ id, reason: 'obsolete' })` sets `tombstoned_at` within ± 2s of now() and stores `metadata.tombstone_reason = 'obsolete'`. Preserves other metadata keys (jsonb `||` merge).
2. Subsequent `recallMemories` never returns the forgotten row, even when its embedding is a near-perfect cosine match.
3. Forgetting an already-tombstoned row returns `null`.
4. Forgetting a missing id returns `null`.
5. `reason` is optional — omitting it produces `metadata` without a `tombstone_reason` key.

### `tests/memory-lifecycle.test.ts` (NEW — integration)

Promotion and expiry logic.

1. Seed a `short` memory with `importance = 0.6, importance_streak = 6, last_accessed_at = now()`. `evaluatePromotions({ asOf: now() })` proposes `promote-to-long` (7-day threshold crossed).
2. Seed a `short` memory with `importance = 0.4` (below threshold). `evaluatePromotions()` proposes `reset-streak` (effective < 0.5).
3. Seed a `long` memory with `importance = 0.85, importance_streak = 29`. `evaluatePromotions()` proposes `promote-to-permanent`.
4. Seed an `identity` short memory with `importance = 0.85, importance_streak = 2`. `evaluatePromotions()` proposes `promote-to-permanent` on the same call (fast-track path — `newStreak = 3` meets `FAST_TRACK_STREAK_DAYS`, skipping `long` entirely). `applyPromotions` flips bucket to `permanent`, resets streak to 0.
   - Boundary case: same row with `importance_streak = 1` instead → `evaluatePromotions()` proposes `advance-streak` to 2 (not yet at fast-track threshold).
5. Seed a `correction` short memory with `importance = 0.85, importance_streak = 2`. Fast-track does NOT fire (`fast_track_permanent = false` for correction). Rule (1) still applies: advance streak.
6. `applyPromotions` with a mix of proposals produces the right counts: `{ advanced, reset, promotedToLong, promotedToPermanent }` matches input distribution; exactly 1 SQL round-trip per action group; final DB state matches intent.
7. `expireTombstones({ asOf, dryRun: true })` returns rows with `tombstoned_at <= asOf - 14d` without deleting.
8. `expireTombstones({ asOf, dryRun: false })` hard-deletes; the row is gone (`SELECT COUNT(*) = 0`).
9. Boundary: a row tombstoned `asOf - 13d23h59m` is NOT expired. A row tombstoned `asOf - 14d1s` IS expired.

### `tests/mcp-memory.test.ts` (EDIT — phase 03 suite)

Add smoke tests for the three new tools.

1. `memoryMcpServer.tools` has length 4: `recall`, `write`, `reinforce`, `forget`.
2. Each new tool's fully-qualified name is exported as a string constant: `WRITE_TOOL_FQN`, `REINFORCE_TOOL_FQN`, `FORGET_TOOL_FQN`.
3. Write handler with stubbed `embedForDocument` + stubbed DB returns `{ content: [{ type: 'text', text: … }] }` where text is valid JSON with `id`, `bucket`, `importance` keys.
4. Reinforce handler with stubbed DB returns the before/after importance as JSON.
5. Forget handler on a missing id returns `isError: true` (not a throw).
6. Write handler on `embedForDocument` throw returns `isError: true` (the agent loop continues).
7. Annotation assertions: `write` has `readOnlyHint: false`; `reinforce` has `idempotentHint: false`; `forget` has `destructiveHint: true`.

### Live-Gemini e2e (skipped by default)

One new `describe.skip('[live] Gemini write round-trip', …)` block in `tests/memory-write.test.ts` that calls the real `writeMemory` once with a short string, verifies the stored embedding length is 1536, and cleans up. Not part of CI — un-skip manually before merging the phase 04 PR.

## Acceptance criteria

All must pass before the phase 04 PR merges:

1. `pnpm typecheck` passes with `noUncheckedIndexedAccess`.
2. `pnpm lint` passes.
3. `pnpm test` passes: all phase 03 suites still green, new suites (`memory-write` 5/5, `memory-reinforce` 7/7, `memory-forget` 5/5, `memory-lifecycle` 9/9) + new cases in `memory-recall` (3 new) and `mcp-memory` (7 new). Skipped live-Gemini blocks remain skipped.
4. `pnpm build` passes — phase 01 `/health` route still renders. (Phase 04 adds no routes; this is a regression check.)
5. `pnpm memory:demo` prints all 7 stages successfully, each stage shows the expected values (segment-default importances, reinforcement curve, forget exclusion, promotion proposal, expire proposal), and seeds are deleted at exit (`SELECT COUNT(*) FROM memories WHERE metadata->>'test_id' = 'phase-04-demo'` returns 0).
6. `memoryMcpServer.tools.length === 4`; the four fully-qualified names (`mcp__memory__recall`, `mcp__memory__write`, `mcp__memory__reinforce`, `mcp__memory__forget`) are exported as constants from `lib/mcp/memory.ts`.
7. Reinforcement math matches plan §5 exactly (test case 1 at I=0.5 returns 0.525 ± numeric rounding).
8. 14-day tombstone expiry enforced by `expireTombstones` (boundary tests 9 in `memory-lifecycle.test.ts`).
9. Fast-track promotion only fires for segments with `memory_segment_config.fast_track_permanent = true` (currently `identity`).
10. Phase 03's `memory-recall.ts` refactored to consume `effectiveImportanceSql` from `lib/memory/decay-sql.ts`; phase 03 recall tests still pass.
11. Worktree git identity verified: `git config user.name` → `shahriarbijoy`, `git config user.email` → `shahriarbijoy@gmail.com`.
12. `README.md` Quickstart mentions `pnpm memory:demo` alongside `pnpm recall:demo`.
13. No new dependencies in `package.json` — phase 04 adds zero packages.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Refactoring phase 03's inline decay SQL into `decay-sql.ts` accidentally changes the hybrid recall ranking | Medium | Phase 03's recall integration tests (ranking / decay-age / importance ordering) must pass **before** the refactor ships. If any test's expected ordering shifts, the refactor introduced math drift, not an improvement. |
| Recall-time auto-reinforce silently mutates rows in integration tests that seed and expect stable state | Medium | `recallMemories()` default is `reinforceHits: false`; only the MCP handler opts in. Tests that verify the boost pass `true` explicitly. The phase 03 integration-test suite continues using the default. |
| `LEAST(1.0, importance + 0.05*(1-importance))::numeric(3,2)` rounds `0.9905` to `0.99`, creating a visible regression in a "should have increased" assertion | Medium | Test case 2 in `memory-reinforce.test.ts` documents this as expected behavior (not a bug — it's the `numeric(3,2)` precision limit). Plan §5's saturation is still satisfied: I→1.0 monotonically at smaller steps. |
| `evaluatePromotions` called twice within a single day would double-advance streaks if the caller applied both proposals | Low | Phase 04 notes this explicitly as a caller-side discipline. Phase 09's cron enforces once-per-24h scheduling. Tests drive streaks with direct seed values, never via repeated calls. |
| Fast-track rule misfires on a `long` identity memory that's already past the 30-day mark (rule 2 AND fast-track both fire) | Low | Precedence spelled out: fast-track wins, `promote-to-permanent` emitted once. Test case 4 confirms. |
| `jsonb_build_object('tombstone_reason', $reason)` + `metadata || …` overwrites an existing `tombstone_reason` key if the row is re-tombstoned (shouldn't happen — `forgetMemory` filters `tombstoned_at IS NULL`, but a DB admin bypass could) | Low | Not a phase-04 code path. Flagged for phase 09's cleanup documentation. |
| `numeric(3,2)` importance truncation on reinforce undershoots the saturation curve | Low | The 0.05 step size keeps every boost above the `numeric(3,2)` quantum of 0.01 for any `importance ≤ 0.98`. Beyond 0.98, saturation is effectively already achieved. |
| `reinforceMemories` bulk UPDATE against 100+ ids exceeds Postgres parameter limit | Very low | Single `ANY($1)` binding; one parameter. No per-id parameter binding. |
| Demo script leaves rows if it crashes mid-stage | Low | Every stage uses `metadata.test_id = 'phase-04-demo'`; a `finally` block deletes by that tag. Stage 7 asserts count=0 before exit. |

## What unlocks next

Phase 04 passing unlocks **phase 05 (first `query()`)**, which:

1. Registers the full four-tool `memoryMcpServer` with the orchestrator's `mcpServers: { memory: memoryMcpServer }`.
2. Uses the four `*_TOOL_FQN` constants in `allowedTools` on the orchestrator's `query()` call.
3. Relies on recall-time auto-reinforce working correctly so agents don't need to manually call `reinforce` after every recall.

Phase 09 (nightly cleanup) uses:

1. `evaluatePromotions` — the 3-agent debate reads this as its candidate list, rather than re-implementing the streak math.
2. `applyPromotions` — invoked after the Judge's verdict, only on approved proposals.
3. `expireTombstones({ dryRun: false })` — run at the end of each nightly job after any reversal window has passed.

Phase 07 (HITL) uses the `destructiveHint: true` annotation on `forget` to require approval for every agent-initiated forget.
