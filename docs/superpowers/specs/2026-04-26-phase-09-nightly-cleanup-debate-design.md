# Phase 09 — Nightly cleanup debate (design)

**Date:** 2026-04-26
**Status:** approved (phase 08 merged)
**Plan references:** `auto-ride-initial-plan.md` §5 (memory: three buckets, Ebbinghaus decay, adversarial cleanup)
**Roadmap entry:** `docs/roadmap/ROADMAP.md` — phase 09

## Purpose

Phase 09 ships the **novel mechanic** of the whole project: a three-agent overnight debate (Consolidator → Adversary → Judge) that governs the memory store. This is what differentiates Auto-ride from Mem0 (flat LRU), Letta/MemGPT (tiered, no decay), Zep/Graphiti (temporal graph, no scheduled forgetting), and LangMem (`gradient` targets prompts, not rows). The Consolidator–Adversary–Judge pattern applied to memory *lifecycle* governance does not appear as a shipped system in any of those — it is the differentiator that makes this project defensible to an interviewer who asks "why didn't you just use Mem0".

Three concrete things ship together because they're tightly coupled and none is useful alone:

1. **A nightly Inngest function** (`memoryCleanupFn`) wired to two triggers: a 03:00 UTC cron schedule for production, and an `auto-ride/cleanup.requested` event for manual / CLI invocation. Both fan into the same handler body.
2. **The Consolidator → Adversary → Judge pipeline** as eight `step.run()` checkpoints inside that function, plus the SQL candidate selector that feeds it (≤100 prune + merge candidates per night).
3. **The apply step** that translates verdicts into `memories` mutations: tombstone for prune, survivor + tombstone + `memory_links` row for merge. Reuses the phase-04 tombstone pattern; calls phase-04's `expireTombstones` at the end of every run to hard-delete tombstones older than 14 days.

Phase 04 already shipped **deterministic streak-based promotions** (`evaluatePromotions` / `applyPromotions` in `db/queries/memory-lifecycle.ts`). Phase 09 does **not** re-route promotions through the debate — they remain mechanical. The debate decides only the high-judgment moves (prune, merge) where deterministic SQL cannot safely act alone. This is a deliberate scope choice that diverges from a literal reading of plan §5; see §11 (open questions / known divergences) below.

Phase 10 (org chart + dashboards) reads `memory_cleanup_runs` and `memory_cleanup_proposals` to render a "memory health" view. Phase 11 (auth) and phase 12 (sandbox + Langfuse) don't depend on this phase. The cron is also dormant until phase 12 deploys the function to a hosted Inngest broker — see §10 (kill switch + dormancy) below.

## Non-goals

Explicitly out of scope for phase 09 — resist adding them even when the diff feels short:

- **Promotion via debate.** Phase 04's deterministic streak path already handles short→long and long→permanent. Routing promotions through the debate would burn agent cost on calls that are already a clear "yes" by streak rule, and would require rewiring phase-04 code that is shipped and tested.
- **Synthesized merge content** (the "write a new merged row" pattern). Survivor + tombstone is simpler, cheaper, easier to audit, and the schema (`linkTypeEnum` already has both `merged` and `superseded`) supports the synthesis pattern as a future-phase addition without a migration.
- **Per-tool / per-agent approval policy for cleanup mutations.** The three roles run server-side under the cron; there is no `canUseTool` gate. The audit trail in `memory_cleanup_proposals` + the 14-day tombstone reversal window is the safety net.
- **Real-time admin UI.** A button-driven trigger and a "memory health" browser belong with the phase 10 dashboards. Phase 09 ships the CLI script (`scripts/cleanup-run-once.ts`) only; the UI is the phase 10 read.
- **Cross-family adversary model.** Haiku 4.5 is the v1 Adversary. Plan §8 explicitly accepts in-family models as a fallback, and a Gemini-based adversary adds vendor wiring without paying for itself until/unless we observe sycophantic correlation in the run logs (see §9 — observability metric for `adversary_confidence_distribution`).
- **Hard per-agent dollar cap inside the SDK.** The cost-cap mechanism is an in-process accumulator (`lib/cleanup/cost-tracker.ts`), not the SDK's `maxBudgetUsd` — the cleanup roles are called via the Anthropic SDK's `messages.create`, not via `query()`, because each role is a single-shot JSON-mode completion, not an agent loop.
- **Inngest function pause via dashboard.** Useful but only relevant once hosted (phase 12). Phase 09 ships the env-flag kill switch (`MEMORY_CLEANUP_CRON_ENABLED`) which works in both local and hosted environments.
- **Candidate-selection tuning surface.** The thresholds (`< 0.15` for prune, `< 0.15` cosine distance for merge, `≤ 100` total candidates) are constants in `db/queries/cleanup-candidates.ts`. A tunable per-run config is a phase 10/12 concern.

## Cost check

This project runs on a **Claude Max subscription via OAuth** (per `auto-ride-initial-plan.md` §2 carve-out + `docs/roadmap/ROADMAP.md` §"Auth for the Agent SDK") — Anthropic doesn't bill per run, usage is metered against the Max plan's 5-hour token quota. The dollar figures the run records in `memory_cleanup_runs.cost_usd` are therefore **notional**: they're the what-it-would-have-cost-on-the-API number, useful as a relative yardstick (Sonnet vs Haiku vs Opus, Consolidator-batch vs Judge-call) and as the input to the in-process `MAX_RUN_USD` cap, which still aborts a runaway run because it consults that same notional figure. **No real $ is charged for this phase.**

- **Notional per-run cost** (what `memory_cleanup_runs.cost_usd` will show), per plan §5 estimate at 100 candidates / 20% contested:
  - Consolidator: 100 candidates ÷ 10 per batch = 10 calls × ~$0.05 = **~$0.50**
  - Adversary: ~100 calls × ~$0.005 (Haiku is cheap) = **~$0.50**
  - Judge: ~20 calls × ~$0.10 (Opus, only on contested > 0.7) = **~$2.00**
  - **Total ~$3/night**, well under the `MAX_RUN_USD = 10` cap.
- **Real cost on Max:** the run draws from the Max plan's rolling token quota. A pathological loop (Consolidator returning JSON that triggers infinite re-runs) is the only realistic way to hit the quota during phase-09 iteration; the cost cap, candidate cap, and wall-clock cap make that hard.
- **If Auto-ride ever turns commercial**, the user switches to an `ANTHROPIC_API_KEY` and the notional figures become real dollars. At 1,000 new memories per day with prompt caching on the three role prompts, plan §5 estimates ~$1.10/night ≈ **$33/month** real spend.
- **Gemini embeddings:** unchanged. The cleanup function does not embed anything new (merge candidates use the existing stored embeddings).
- **Neon:** zero new tables, zero new indexes. Both `memory_cleanup_runs` and `memory_cleanup_proposals` were provisioned in phase 02 (`db/schema/cleanup.ts`). Per-run row count: 1 in `memory_cleanup_runs`, ≤100 in `memory_cleanup_proposals`. Negligible storage growth.
- **Inngest:** one new function (`memoryCleanupFn`), one new event (`auto-ride/cleanup.requested`). The cron registers automatically when the function is served at `/api/inngest`.

## Dependencies

**Zero new runtime packages.** The Anthropic SDK (`@anthropic-ai/sdk`) is already in `node_modules` (transitive dependency of `@anthropic-ai/claude-agent-sdk`); the cleanup roles import `Anthropic` from there directly for single-shot JSON-mode completions. Inngest, Drizzle, Zod — all already pinned by earlier phases.

**One new env var:** `MEMORY_CLEANUP_CRON_ENABLED=true` (default `true`; set to `false` to disable the cron without redeploying). Added to `.env.example`.

**Versions** (pinned; phase 09 does not bump):

- `@anthropic-ai/claude-agent-sdk` — pinned at the phase-08 version. Cleanup roles use the bundled `@anthropic-ai/sdk` for messages, not the agent loop.
- `@anthropic-ai/sdk` — used directly for the three role calls. Already a transitive dep; phase 09 adds no new top-level dependency.
- `inngest` — pinned at the phase-07 version. Phase 09 adds a new function but doesn't bump the framework.

**Schema:** unchanged. Phase 02 already provisioned both cleanup tables.

```ts
// db/schema/cleanup.ts (already shipped)
memoryCleanupRuns   { id, startedAt, completedAt, status, candidatesConsidered,
                      proposalsGenerated, proposalsContested, proposalsJudged,
                      costUsd, error }
memoryCleanupProposals { id, runId, memoryId, targetMemoryId, action, finalAction,
                         consolidator, adversary, judge, appliedAt, createdAt }
```

`memory_links` (also from phase 02) is reused for merge audit rows — `linkTypeEnum` already includes `'merged'` and `'superseded'`.

## §1. Architecture (runtime shape)

```
┌─────────────────────────────────────────────────────────────────┐
│ Trigger layer                                                   │
│   - Cron:  0 3 * * * UTC      (production path)                 │
│   - Event: auto-ride/cleanup.requested  (manual / CLI script)   │
│   Both fan into the SAME Inngest function body.                 │
└────────────────────────┬────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│ memoryCleanupFn (Inngest function, concurrency: { limit: 1 })   │
│                                                                  │
│  step 0: env-flag guard   → return early if MEMORY_CLEANUP_     │
│                              CRON_ENABLED === 'false'           │
│  step 0.5: stale-finalizer → flip any 'running' row > 1h old to │
│                              'failed' (recovery from prior crash)│
│  step 1: openRun()        → INSERT memory_cleanup_runs (running)│
│  step 2: selectCandidates → SQL: ≤100 prune+merge candidates    │
│  step 3: consolidate      → Sonnet 4.6, batches of 10, JSON     │
│  step 4: adversarial      → Haiku 4.5, per-proposal, JSON       │
│  step 5: judge            → Opus 4.6, only when adv.conf > 0.7  │
│  step 6: applyVerdicts    → tombstone / merge-link writes       │
│  step 7: expireTombstones → reuse phase-04 helper (>14d)        │
│  step 8: closeRun()       → UPDATE status, cost, counts         │
└──────────────────────────────────────────────────────────────────┘
```

Each `step.run()` boundary is a checkpoint — Inngest replays a crashed step from cached output, so a partial run resumes cleanly without re-billing model calls.

**Cost tracking across replays:** the cost cap is enforced by having each step that calls a model **return its cost as part of its step output** (e.g. `{ proposals: [...], stepCostUsd: 0.42 }`). The orchestrator sums these returned values into a running total *after each step.run*. On Inngest replay, cached step outputs are replayed verbatim, so the cost total reconstructs deterministically without depending on in-process state. If running total ≥ `MAX_RUN_USD` the orchestrator throws `CostCapExceededError`, the run is marked `failed` in step 8, and step 6 (apply) is never reached. This is why `cost-tracker.ts` is a **pure-function utility** (token-counts → dollars), not a singleton with mutable state.

Steps 0 and 0.5 (env flag, stale-finalizer) run **outside** any `step.run()` — they're at the top of the function body. They're idempotent (env-flag returns the same value across replays; stale-finalizer is a `WHERE status='running' AND started_at < now() - interval '1 hour'` UPDATE that is a no-op the second time). Wrapping them in `step.run()` would be harmless but wastes a checkpoint slot.

**Concurrency `{ limit: 1 }`** (no key) — the cleanup is a global sweep, so two parallel runs would race on the same candidate rows. Manual trigger while cron is running queues automatically.

**Wall-clock cap:** 10 minutes via Inngest's per-function timeout. A stuck SDK call doesn't block forever.

**Same-day idempotency** (Story 1 in §5):
- **Cron** trigger checks for an existing `status='completed'` row with `started_at >= date_trunc('day', now())` and skips silently if found.
- **Manual** trigger always proceeds. (Useful for debugging; the user explicitly asked for it.)

## §2. Candidate selection (deterministic SQL, ≤100 rows)

Two queries `UNION ALL` together, each capped at 50:

```sql
-- prune candidates: low effective importance, not tombstoned, not permanent
-- <eff_imp_expr> = the SQL fragment produced by effectiveImportanceSql({...})
-- from lib/memory/decay-sql.ts (the same expression phase 03/04 use at recall time)
WITH effective AS (
  SELECT m.id, m.segment, m.bucket, m.content, m.importance,
         m.last_accessed_at,
         <eff_imp_expr> AS eff_imp
  FROM memories m
  JOIN memory_segment_config c ON c.segment = m.segment
  WHERE m.tombstoned_at IS NULL AND m.bucket <> 'permanent'
)
SELECT 'prune'::text AS candidate_kind, id AS memory_id,
       NULL::uuid AS target_memory_id,
       segment, bucket, content, importance, eff_imp
FROM effective
WHERE eff_imp < 0.15
ORDER BY eff_imp ASC
LIMIT 50

UNION ALL

-- merge candidates: same-segment near-duplicates (cosine distance < 0.15)
SELECT 'merge'::text, a.id, b.id, a.segment, a.bucket, a.content,
       a.importance, NULL::float8
FROM memories a
JOIN memories b ON b.segment = a.segment
              AND b.id > a.id           -- avoid (a,b) and (b,a) and self
              AND b.tombstoned_at IS NULL
              AND b.embedding IS NOT NULL
WHERE a.tombstoned_at IS NULL
  AND a.embedding IS NOT NULL
  AND (a.embedding <=> b.embedding) < 0.15
ORDER BY (a.embedding <=> b.embedding) ASC
LIMIT 50
```

**Key choices:**

| Choice | Why |
|---|---|
| Reuse `effectiveImportanceSql` from `lib/memory/decay-sql.ts` | Phase 03/04 already built and tested it. Same expression that powers retrieval-time importance. |
| `b.id > a.id` instead of `<>` | Eliminates duplicate `(a,b)/(b,a)` pairs without `DISTINCT`. Older row is always `a` (UUID v4 is not strictly time-ordered, but the asymmetry is what we need, not chronology). |
| Cap each kind at 50 | Plan default. Bounds Consolidator cost mechanically. |
| Order by severity (`eff_imp ASC`, distance `ASC`) | Always work on the most-likely-to-be-real-issues first. |
| HNSW index already exists with `vector_cosine_ops` (phase 02/03) | Plan §6's "don't reverse the index" rule already honored — the merge query is `<=>` ASC. |
| Explicit `embedding IS NOT NULL` on merge query | Defensive — pre-phase-03 memories without embeddings would otherwise produce NULL distances. |

**Edge cases handled by design:**
- A row that's both a prune candidate AND part of a merge pair will appear in both batches; the Apply step (§4) processes prune verdicts before merge verdicts within the same run, so prune wins.
- Empty result set (e.g., a fresh DB) returns an empty `candidates` array; the function exits cleanly through step 7 (expireTombstones) and step 8 (closeRun).

## §3. The three-role debate

Plain-English summary: the Consolidator says "I think we should do X to memory M because Y". The Adversary plays devil's advocate — "are you sure? what if Z?". If the Adversary sounds confident it's right (`adversaryConfidence > 0.7`), the Judge weighs in. Otherwise the Consolidator wins by default.

### Consolidator (Sonnet 4.6)

- Model: `claude-sonnet-4-6`
- Batch size: 10 candidates per call
- Output: `{ memoryId, action, reasoning, confidence }` per candidate, where `action ∈ {'prune', 'merge', 'keep'}` (yes, `keep` — the Consolidator can self-veto)
- JSON mode via system prompt + `response_format` enforcement; Zod-parsed via `lib/cleanup/schemas.ts`

### Adversary (Haiku 4.5)

- Model: `claude-haiku-4-5`
- Batch size: 1 proposal per call
- Prompt includes the proposal **and** an explicit five-failure-mode checklist:
  1. Premature pruning of latent value
  2. Merging different-but-similar facts
  3. Promoting recency artifacts (vestigial — included for prompt consistency though we don't promote here)
  4. Violating segment invariants
  5. Silent contradiction with existing memories
- Output: `{ memoryId, adversaryConfidence, objection }` where `adversaryConfidence ∈ [0, 1]` is "how confident I am the Consolidator is wrong"

### Decision gate

- `adversaryConfidence ≤ 0.7` → Judge skipped, `final_action = consolidator.action`
- `adversaryConfidence > 0.7` → Judge fires

### Judge (Opus 4.6)

- Model: `claude-opus-4-6`
- Batch size: 1 contested proposal per call
- Prompt includes both the Consolidator proposal and the Adversary objection, plus the **asymmetric loss rule**: *"errors of omission are cheaper than errors of commission — when in doubt, keep the memory."*
- Output: `{ memoryId, finalAction, reasoning }` where `finalAction ∈ {'prune', 'merge', 'keep'}`. Judge can override Consolidator's verdict in either direction.

### Worked example #1 — Adversary doesn't push back

```
candidate row → memory_id=M-42, kind=prune,
                content="user prefers dark mode at night",
                eff_imp=0.08, segment=preference, bucket=short

Consolidator: { action: "prune", confidence: 0.85,
                reasoning: "Stale low-importance preference; not accessed in 30 days." }
Adversary:    { adversaryConfidence: 0.45,
                objection: "Latent value low — preference this stale unlikely to revive." }
Decision:     0.45 ≤ 0.7 → Judge SKIPPED.
final_action: "prune"

Apply: UPDATE memories SET tombstoned_at = now() WHERE id = 'M-42';
```

### Worked example #2 — Adversary pushes back, Judge overrides

```
Same candidate.
Consolidator: { action: "prune", confidence: 0.85, reasoning: "..." }
Adversary:    { adversaryConfidence: 0.82,
                objection: "User mentioned this preference in a recent identity-segment
                            memory that depends on it." }
Decision:     0.82 > 0.7 → Judge FIRES.
Judge:        { finalAction: "keep",
                reasoning: "Adversary's contradiction concern is plausible.
                            Asymmetric loss favors keeping." }
final_action: "keep"

Apply: nothing (no-op). Proposal row records the verdict for audit.
```

### What gets stored per candidate

One row in `memory_cleanup_proposals`:

| Column | Example #1 | Example #2 |
|---|---|---|
| `memory_id` | M-42 | M-42 |
| `action` | `prune` | `prune` |
| `consolidator` (jsonb) | `{reasoning, confidence: 0.85}` | same |
| `adversary` (jsonb) | `{adversaryConfidence: 0.45, objection}` | `{adversaryConfidence: 0.82, objection}` |
| `judge` (jsonb) | `null` (skipped) | `{reasoning, finalAction: "keep"}` |
| `final_action` | `prune` | `keep` |
| `applied_at` | timestamp of UPDATE | `null` (no-op) |

## §4. Apply step

Two verbs: `prune` and `merge`. Each writes via Drizzle and leaves an audit trail.

### Prune

Reuses the same tombstone pattern as `forgetMemory` (phase 04). The 14-day expiry sweeper (`expireTombstones`, step 7) hard-deletes it later.

```ts
await db.update(memories)
  .set({
    tombstonedAt: new Date(),
    metadata: sql`${memories.metadata} || jsonb_build_object(
      'tombstone_reason', 'cleanup-proposal',
      'proposal_id', ${proposalId}::text
    )`
  })
  .where(and(eq(memories.id, memoryId), isNull(memories.tombstonedAt)));
```

### Merge — survivor + tombstone

Each merge candidate row carries `memory_id` (= the older `a` from §2's `b.id > a.id` join) and `target_memory_id` (= the newer `b`). The Apply step re-fetches both rows by id (their importance may have shifted between selection and apply if a parallel reinforce hit them) and picks the survivor.

Survivor heuristic: **higher importance wins; ties go to `memory_id`** (i.e. the older `a`, providing a deterministic tiebreaker since the merge candidate query already enforces `b.id > a.id`).

```ts
const a = await fetchMemory(proposal.memoryId);       // older
const b = await fetchMemory(proposal.targetMemoryId); // newer
const survivor = a.importance >= b.importance ? a : b;
const loser    = survivor === a ? b : a;

await db.insert(memoryLinks).values({
  parentId: survivor.id,
  childId:  loser.id,
  linkType: 'merged',
  proposalId,
});

await db.update(memories)
  .set({
    tombstonedAt: new Date(),
    metadata: sql`${memories.metadata} || jsonb_build_object(
      'tombstone_reason', 'merged-into',
      'merged_into', ${survivor.id}::text,
      'proposal_id', ${proposalId}::text
    )`
  })
  .where(and(eq(memories.id, loser.id), isNull(memories.tombstonedAt)));
```

### `keep` verdicts

The Consolidator can self-veto with `action: 'keep'`, and the Judge can return `finalAction: 'keep'`. Keep verdicts are no-op in the apply step — the proposal row is written (so the audit trail records that the candidate was reviewed), but `applied_at` stays `NULL` and no `memories` row is mutated. This is the same outcome as a Judge override (Worked example #2).

### Apply ordering

Within a single run: **prune verdicts apply before merge verdicts**. If a memory is both a prune candidate AND a merge loser, pruning wins (the row is tombstoned; the merge link is still recorded but applies to a tombstoned row, which is fine for audit and a no-op for retrieval). The Apply step also short-circuits on the merge path if either survivor or loser is already tombstoned (concurrent reinforce / forget between selection and apply) — the proposal row records `applied_at: NULL` with metadata `{ skipped: 'already-tombstoned' }`.

## §5. Failure modes

Three stories, each with the in-process defense.

### Story 1: Cron and manual script both fire today

| Today's history | Cron does | Manual does |
|---|---|---|
| No row yet | Runs normally | Runs normally |
| One successful row already | **Skips silently** (no run row, no cost) | **Runs anyway** (you asked for it) |

The cron's idempotency check is a single `SELECT 1 FROM memory_cleanup_runs WHERE started_at >= date_trunc('day', now()) AND status = 'completed' LIMIT 1`; on hit, the function returns `{ skipped: true, reason: 'already-ran-today' }`.

### Story 2: Function crashes mid-debate

Inngest replays the function from the last successful `step.run()` boundary. Because each of steps 1–8 is wrapped in `step.run('name', ...)`, the cached output of completed steps is reused — Sonnet/Haiku/Opus calls in steps 3, 4, 5 are **not re-billed** on retry.

If the function dies before step 8 (closeRun), the run row stays in `status='running'` indefinitely. **Defense:** step 0.5 (`stale-finalizer`) at the start of every new run flips any `running` row older than 1 hour to `failed`. 5-line SQL, runs in < 10 ms.

### Story 3: LLM returns malformed JSON

| Role | Fallback on Zod parse failure |
|---|---|
| Consolidator | Skip this batch of 10 candidates. Log to `memory_cleanup_runs.error`. Continue with next batch. |
| Adversary | Default to `adversaryConfidence: 0.0` → no objection → consolidator wins. |
| Judge | Default to `finalAction: 'keep'` → asymmetric-loss safe bet → no-op apply. |

Every fallback biases toward **doing nothing**, matching the project's "tombstone, don't delete; keep, don't prune; in doubt, leave it alone" philosophy.

## §6. Kill switch + dormancy

The cron schedule is registered with the Inngest broker (cloud or local dev) — not run by the Next.js process directly. Two consequences:

- **Pre-phase-12 (not hosted):** the cron literally cannot fire from anywhere except local dev. In local dev, it only fires while `pnpm inngest:dev` is running. The phase 09 PR demo flow is entirely manual-trigger:
  1. `pnpm dev` (Next.js)
  2. `pnpm inngest:dev` (Inngest dev broker)
  3. `pnpm cleanup:run-once` → fires `auto-ride/cleanup.requested` event → handler runs → DB rows appear → Inngest dev UI shows the live trace.
- **Post-phase-12 (hosted):** the cron lives on Inngest cloud's broker, fires daily at 03:00 UTC, calls the deployed `/api/inngest` route.

**Kill switches**, softest to hardest:

| # | Mechanism | Time to flip |
|---|---|---|
| 1 | **Env var** `MEMORY_CLEANUP_CRON_ENABLED=false` checked in step 0 of the function. Returns `{ skipped: true, reason: 'env-flag' }` immediately. | Seconds (toggle env, restart) |
| 2 | **Inngest dashboard pause** (function-level, no code change) | One click — only available once hosted (phase 12) |
| 3 | **Remove the `{ cron: ... }` trigger** from `memoryCleanupFn` definition; keep the manual event. Manual trigger still works via `pnpm cleanup:run-once`. | Code change + deploy |

Phase 09 ships #1 as the primary control and documents #2/#3 as escape hatches. The env flag is checked **inside** the function (not at registration time) so that toggling it doesn't require a redeploy.

## §7. Observability

### Per-run row in `memory_cleanup_runs`

| Column | What it records |
|---|---|
| `id` | UUID |
| `started_at`, `completed_at` | Wall-clock window |
| `status` | `running` → `completed` \| `failed` |
| `candidates_considered` | Count from step 2 |
| `proposals_generated` | Count from step 3 |
| `proposals_contested` | Count where `adversaryConfidence > 0.7` |
| `proposals_judged` | Count of Judge calls (= `proposals_contested` minus parse-failure fallbacks) |
| `cost_usd` | Notional sum across all three roles, accumulated by `cost-tracker.ts` |
| `error` | First fatal error message, if any |

### Per-candidate row in `memory_cleanup_proposals`

Already detailed in §3 — full audit trail of consolidator / adversary / judge JSON blobs.

### Console logs (captured by Inngest)

`console.log('[cleanup] step N: <message>', { metrics })` at each step boundary. Visible in the Inngest dev UI's function trace and in the deployed Inngest dashboard.

### Anti-sycophancy metric

A simple aggregate to watch over time:

```sql
SELECT
  AVG((adversary->>'adversaryConfidence')::float8) AS mean_adv_confidence,
  COUNT(*) FILTER (WHERE (adversary->>'adversaryConfidence')::float8 < 0.2)::float8
    / NULLIF(COUNT(*), 0) AS pct_low_confidence
FROM memory_cleanup_proposals
WHERE created_at >= now() - interval '7 days';
```

If `pct_low_confidence > 0.9` over a sustained window, the Adversary has collapsed into "yes-man" mode and we should swap to a cross-family model (Gemini Flash). Phase 09 surfaces this as a SQL query in the design doc; phase 10 dashboards graph it.

## §8. Testing strategy

Three layers — fastest first so most failures get caught before any model calls.

### Layer 1: Pure-SQL tests (no LLM, no mocks)

`tests/cleanup-candidates.test.ts` — exercises `selectCleanupCandidates()` against a seeded DB. Fully deterministic.

- prune candidate: low-importance + stale memory shows up
- merge candidate: two near-duplicate embeddings (manually-set vector values) show up as a pair
- permanent bucket excluded from prune candidates
- tombstoned rows excluded from both queries
- candidate cap (50 + 50) enforced
- merge query returns exactly one ordered pair per duplicate set (verifies `b.id > a.id` trick)

### Layer 2: Debate-pipeline tests (mocked Anthropic SDK)

`tests/cleanup-debate.test.ts` — mocks `Anthropic.messages.create` per role. Verifies dispatch logic without spending money.

- Adversary confidence ≤ 0.7 → Judge function never called, `final_action = consolidator.action`
- Adversary confidence > 0.7 → Judge fires, `final_action = judge.finalAction`
- Malformed Consolidator JSON → batch skipped, run continues, error logged
- Malformed Adversary JSON → defaults to `0.0`, proposal goes through with consolidator verdict
- Malformed Judge JSON → defaults to `keep`, no-op apply
- Cost cap exceeded mid-run → `CostCapExceededError` thrown, run row marked `failed`, no apply
- Env flag `false` → function returns `{ skipped: true, reason: 'env-flag' }` immediately, no run row

### Layer 3: Apply-step tests (real DB writes)

`tests/cleanup-apply.test.ts` — verifies the actual mutations.

- prune verdict tombstones the memory and merges metadata
- merge verdict tombstones loser, leaves survivor live, writes `memory_links` row of type `merged`
- survivor heuristic: higher importance wins; ties go to older `created_at`
- apply ordering: prune verdict for memory M wins over merge verdict where M is loser, in same run
- expireTombstones is called at the end of every run (verified via spy)
- stale-finalizer flips `running` rows > 1h old to `failed` before opening a new run

### Not covered in CI

- **Real LLM calls.** Too slow, too flaky, and the dispatch logic above is fully covered. One **manual smoke run** (live demo of `pnpm cleanup:run-once` against a seeded DB) gates the PR.
- **Cron actually firing on schedule.** Inngest's cron-trigger code is not ours to test.

## §9. File layout

```
db/queries/
  cleanup-candidates.ts     ← NEW: selectCleanupCandidates() (the §2 SQL)
  cleanup-apply.ts          ← NEW: applyVerdicts() (the §4 mutations)

lib/cleanup/
  consolidator.ts           ← NEW: prompt + Sonnet call + Zod parse
  adversary.ts              ← NEW: prompt + Haiku call + Zod parse
  judge.ts                  ← NEW: prompt + Opus call + Zod parse
  debate.ts                 ← NEW: orchestrates §3 (the C→A→J loop per candidate)
  cost-tracker.ts           ← NEW: per-run cost accumulator + cap enforcement
  schemas.ts                ← NEW: Zod schemas for each role's JSON output
  prompts.ts                ← NEW: prompt templates (extracted for testability)

lib/inngest/
  events.ts                 ← MODIFY: add CLEANUP_REQUESTED event + schema
  client.ts                 ← MODIFY: register CLEANUP_REQUESTED in AutoRideEvents
  functions.ts              ← MODIFY: add memoryCleanupFn (cron + event triggers)

scripts/
  cleanup-run-once.ts       ← NEW: sends auto-ride/cleanup.requested event

tests/
  cleanup-candidates.test.ts  ← NEW: Layer 1
  cleanup-debate.test.ts      ← NEW: Layer 2
  cleanup-apply.test.ts       ← NEW: Layer 3

.env.example                ← MODIFY: add MEMORY_CLEANUP_CRON_ENABLED=true
README.md                   ← MODIFY: phase 09 section + demo command
```

**Files NOT touched:** anything from phase 04 (`memory-lifecycle.ts`, `memory-forget.ts`, etc.). The cleanup function imports `expireTombstones` from there but doesn't modify it — keeping phase 04 tests stable.

**Why this layout:** mirrors the phase 04 split (`db/queries/` for SQL helpers, `lib/<feature>/` for business logic, `tests/<feature>-*.test.ts` for tests). One new directory (`lib/cleanup/`) so the debate code has a dedicated home and isn't sprinkled across `lib/agent/` or `lib/memory/`.

## §10. Risks / open questions / known divergences

### Known divergence from plan §5

**Plan literally says** the Consolidator handles "promotion candidates from short-term, prune candidates below 0.15 effective importance, merge candidates within 0.15 cosine distance in the same segment, promotion-to-permanent candidates with thirty-day streaks". **Phase 09 ships only prune + merge.** Promotions remain on the deterministic streak path shipped in phase 04 (`evaluatePromotions` / `applyPromotions`). The reasons:

1. Phase 04's streak path is shipped, tested, and cheap — re-routing through the debate adds agent cost on calls that are already a clear "yes" by streak rule.
2. The debate's value-add is on judgment calls (is this dupe really a dupe? is this safe to forget?), not on rule-driven promotions.
3. The spec is explicit so the divergence is reviewable.

If interview feedback or future learning suggests the debate should govern promotions too, the change is additive: add `promote` to the candidate selector's `UNION ALL`, extend the Consolidator prompt with a fourth action verb. No schema migration required (`cleanupActionEnum` already includes `'promote'`).

### Sycophantic collapse

The Adversary is in-family with the Consolidator (both Anthropic, different size). Plan §8 names this risk explicitly. Defense: the anti-sycophancy metric in §7 surfaces it; if it triggers, swap to Gemini 2.5 Flash via the same `lib/cleanup/adversary.ts` interface (the prompt + Zod schema stay; only the SDK client changes).

### Cron dormancy until phase 12

The cron schedule does not actually fire in production until phase 12 deploys to a hosted Inngest broker. The phase 09 PR demos via the manual trigger only. This is not a defect — it matches the rest of the project's "build locally, deploy in phase 12" rhythm — but worth flagging so the PR review doesn't expect a hosted-cron screenshot.

### Cost-cap precision

`MAX_RUN_USD = 10` is a notional cap (Max OAuth, no real billing) but real for the API-key path. The accumulator in `cost-tracker.ts` reads `usage.input_tokens` + `usage.output_tokens` + `usage.cache_read_input_tokens` from each Anthropic response and multiplies by the per-model rate constants (`COST_PER_MTOK_INPUT`, `COST_PER_MTOK_OUTPUT`, `COST_PER_MTOK_CACHE_READ`). Rate constants are pulled from the Anthropic public pricing page as of 2026-04-26 and stored as TypeScript constants — they may drift; phase 12 will read them from a config table.

### Adversary failure-mode prompt includes a vestigial "promoting recency artifacts" check

The five-failure-mode checklist (§3) includes a check for promotion-related risks even though phase 09 doesn't promote. Reason: keeping the checklist exactly as plan §5 wrote it preserves the prompt's coherence and gives the Adversary practice with the full failure space. The vestigial check is a few extra tokens per call, well under the cost cap. If profiling shows it materially wastes Adversary attention on prune/merge proposals, trim in a follow-up.

## §11. Acceptance criteria

A green checkbox per item gates the phase 09 PR.

- [ ] `pnpm cleanup:run-once` against a seeded DB produces a `memory_cleanup_runs` row with `status='completed'` and `proposals_generated > 0`.
- [ ] At least one prune candidate from the seed produces a `memory_cleanup_proposals` row with `final_action='prune'` and `applied_at IS NOT NULL`, AND the corresponding `memories` row has `tombstoned_at IS NOT NULL`.
- [ ] At least one merge candidate from the seed produces a `memory_cleanup_proposals` row with `final_action='merge'`, a `memory_links` row of `link_type='merged'` linking loser → survivor, and the loser's `tombstoned_at IS NOT NULL`.
- [ ] Layer 2 test verifies the Judge dispatch path end-to-end with mocked Adversary confidence > 0.7; the corresponding `memory_cleanup_proposals.judge` is non-null and `final_action` reflects the Judge verdict. (Smoke run with real LLMs may or may not produce a contested case in any single invocation — that path is covered by the Layer 2 mock, not the manual demo.)
- [ ] Setting `MEMORY_CLEANUP_CRON_ENABLED=false` and re-firing the event results in `{ skipped: true, reason: 'env-flag' }` and no new `memory_cleanup_runs` row.
- [ ] All Layer 1 + Layer 2 + Layer 3 tests pass via `pnpm test`.
- [ ] `pnpm typecheck` and `pnpm build` pass.
- [ ] PR title is `phase 09: nightly cleanup debate`; PR body links plan §5 and this design doc.
- [ ] README updated with the demo command and a one-paragraph "what phase 09 does".
- [ ] No regressions in the phase 04 promotion path — `tests/memory-lifecycle.test.ts` still passes unchanged.
