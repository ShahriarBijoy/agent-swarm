# Phase 09 Implementation Plan — Nightly cleanup debate

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the nightly Consolidator → Adversary → Judge debate that governs prune + merge actions over the memory store, plus the Inngest cron + manual-event triggers and CLI demo path.

**Architecture:** Eight `step.run()` checkpoints inside one Inngest function (`memoryCleanupFn`), wired to both `cron: '0 3 * * *'` and `event: 'auto-ride/cleanup.requested'`. Each role is a single-shot `Anthropic.messages.create` call (not an SDK `query()` loop). Cost cap, candidate cap, and wall-clock cap defend against runaways. Promotions stay on phase 04's deterministic streak path — this phase only decides prune + merge.

**Tech Stack:** TypeScript / Drizzle ORM / Neon Postgres + pgvector / Inngest 3.x / `@anthropic-ai/sdk` 0.81 (transitive via `@anthropic-ai/claude-agent-sdk`) / Zod 4 / Vitest 4.

**Spec:** `docs/superpowers/specs/2026-04-26-phase-09-nightly-cleanup-debate-design.md`

---

## File structure

```
db/queries/
  cleanup-candidates.ts      [NEW]  selectCleanupCandidates() — §2 SQL
  cleanup-apply.ts           [NEW]  applyVerdicts() — §4 mutations + survivor logic

lib/cleanup/
  schemas.ts                 [NEW]  Zod schemas for role outputs (one source of truth)
  cost-tracker.ts            [NEW]  pure: tokens × per-model rates → USD
  prompts.ts                 [NEW]  pure: system + user prompt builders per role
  consolidator.ts            [NEW]  Anthropic call → Sonnet 4.6 → ConsolidatorProposal[]
  adversary.ts               [NEW]  Anthropic call → Haiku 4.5 → AdversaryResponse
  judge.ts                   [NEW]  Anthropic call → Opus 4.6 → JudgeVerdict
  debate.ts                  [NEW]  orchestrates C → A → J pipeline + cost-cap
  errors.ts                  [NEW]  CostCapExceededError + helpers

lib/inngest/
  events.ts                  [MOD]  add CLEANUP_REQUESTED event + Zod schema
  client.ts                  [MOD]  register CLEANUP_REQUESTED in AutoRideEvents
  functions.ts               [MOD]  add memoryCleanupFn (cron + event triggers)

app/api/inngest/
  route.ts                   [MOD]  add memoryCleanupFn to functions list

scripts/
  cleanup-run-once.ts        [NEW]  sends auto-ride/cleanup.requested event

tests/
  cleanup-candidates.test.ts [NEW]  Layer 1 (pure SQL against seeded DB)
  cleanup-apply.test.ts      [NEW]  Layer 3 (real DB writes)
  cleanup-cost-tracker.test.ts [NEW]  pure unit tests
  cleanup-schemas.test.ts    [NEW]  Zod parse / fallback tests
  cleanup-debate.test.ts     [NEW]  Layer 2 (mocked Anthropic SDK)

.env.example                 [MOD]  add MEMORY_CLEANUP_CRON_ENABLED=true
package.json                 [MOD]  add "cleanup:run-once" script
README.md                    [MOD]  phase 09 section + demo command
```

**Files NOT modified:** anything in `db/queries/memory-*.ts` or `db/schema/`. Phase 04's `expireTombstones` is imported and called but not changed.

---

### Task 1: Cost tracker (pure utility)

**Files:**
- Create: `lib/cleanup/cost-tracker.ts`
- Test: `tests/cleanup-cost-tracker.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/cleanup-cost-tracker.test.ts
import { describe, expect, it } from 'vitest';
import {
  computeCallCostUsd,
  ROLE_MODEL,
  PRICING,
} from '@/lib/cleanup/cost-tracker';

describe('cost-tracker', () => {
  it('computes Sonnet 4.6 cost from input + output tokens', () => {
    // Sonnet pricing: $3 / Mtok input, $15 / Mtok output
    const cost = computeCallCostUsd(ROLE_MODEL.consolidator, {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    });
    expect(cost).toBeCloseTo(3 + 15, 6);
  });

  it('computes Haiku 4.5 cost cheaper than Sonnet', () => {
    const sonnet = computeCallCostUsd(ROLE_MODEL.consolidator, {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    });
    const haiku = computeCallCostUsd(ROLE_MODEL.adversary, {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    });
    expect(haiku).toBeLessThan(sonnet);
  });

  it('applies cache-read discount (10% of input rate)', () => {
    const noCache = computeCallCostUsd(ROLE_MODEL.consolidator, {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    });
    const fullCache = computeCallCostUsd(ROLE_MODEL.consolidator, {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 1_000_000,
      cache_creation_input_tokens: 0,
    });
    expect(fullCache).toBeCloseTo(noCache * 0.1, 6);
  });

  it('zero-token call costs zero', () => {
    expect(
      computeCallCostUsd(ROLE_MODEL.judge, {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      }),
    ).toBe(0);
  });

  it('PRICING table has entries for all three role models', () => {
    expect(PRICING[ROLE_MODEL.consolidator]).toBeDefined();
    expect(PRICING[ROLE_MODEL.adversary]).toBeDefined();
    expect(PRICING[ROLE_MODEL.judge]).toBeDefined();
  });
});
```

- [ ] **Step 2: Verify it fails**

Run: `pnpm test cleanup-cost-tracker`
Expected: FAIL with "Cannot find module '@/lib/cleanup/cost-tracker'"

- [ ] **Step 3: Implement the cost tracker**

```ts
// lib/cleanup/cost-tracker.ts

/**
 * Per-million-token pricing in USD, from anthropic.com/pricing as of 2026-04-26.
 * `cacheRead` is the cache-hit input rate (10% of base input).
 * `cacheWrite` is the 5-min ephemeral cache write rate (125% of base input).
 *
 * NOTE: These are notional. Auto-ride runs on Max OAuth so no real $ is billed
 * per call; the cost figure is used by MAX_RUN_USD to abort runaway runs.
 */
export const PRICING = {
  'claude-sonnet-4-6': {
    input: 3.00,
    output: 15.00,
    cacheRead: 0.30,
    cacheWrite: 3.75,
  },
  'claude-haiku-4-5': {
    input: 0.80,
    output: 4.00,
    cacheRead: 0.08,
    cacheWrite: 1.00,
  },
  'claude-opus-4-6': {
    input: 15.00,
    output: 75.00,
    cacheRead: 1.50,
    cacheWrite: 18.75,
  },
} as const;

export type RoleModel = keyof typeof PRICING;

/** Single source of truth for which model plays which role. */
export const ROLE_MODEL = {
  consolidator: 'claude-sonnet-4-6',
  adversary: 'claude-haiku-4-5',
  judge: 'claude-opus-4-6',
} as const satisfies Record<'consolidator' | 'adversary' | 'judge', RoleModel>;

/** Hard cap on a single cleanup run. Abort and mark `failed` if exceeded. */
export const MAX_RUN_USD = 10.0;

/** Token usage shape returned by Anthropic.messages.create. */
export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

/**
 * Pure function — no I/O, no mutation. Multiplies usage counts by per-model
 * rates and returns USD. Safe to call inside step.run() because cached step
 * outputs replay deterministically.
 */
export function computeCallCostUsd(
  model: RoleModel,
  usage: AnthropicUsage,
): number {
  const rates = PRICING[model];
  const input = (usage.input_tokens / 1_000_000) * rates.input;
  const output = (usage.output_tokens / 1_000_000) * rates.output;
  const cacheR = (usage.cache_read_input_tokens / 1_000_000) * rates.cacheRead;
  const cacheW = (usage.cache_creation_input_tokens / 1_000_000) * rates.cacheWrite;
  return input + output + cacheR + cacheW;
}
```

- [ ] **Step 4: Verify tests pass**

Run: `pnpm test cleanup-cost-tracker`
Expected: PASS — 5 tests pass

- [ ] **Step 5: Commit**

```bash
git -C .worktree/phase-09-nightly-cleanup-debate add \
  lib/cleanup/cost-tracker.ts \
  tests/cleanup-cost-tracker.test.ts
git -C .worktree/phase-09-nightly-cleanup-debate commit -m "phase 09: cost tracker pure utility + per-model pricing constants"
```

---

### Task 2: Zod schemas for role outputs

**Files:**
- Create: `lib/cleanup/schemas.ts`
- Test: `tests/cleanup-schemas.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/cleanup-schemas.test.ts
import { describe, expect, it } from 'vitest';
import {
  ConsolidatorBatchSchema,
  AdversaryResponseSchema,
  JudgeVerdictSchema,
  parseAdversarySafe,
  parseJudgeSafe,
} from '@/lib/cleanup/schemas';

describe('cleanup schemas', () => {
  it('parses a valid Consolidator batch', () => {
    const batch = ConsolidatorBatchSchema.parse({
      proposals: [
        {
          memoryId: '11111111-1111-1111-1111-111111111111',
          action: 'prune',
          reasoning: 'low importance',
          confidence: 0.8,
        },
      ],
    });
    expect(batch.proposals[0]!.action).toBe('prune');
  });

  it('rejects Consolidator output with confidence > 1', () => {
    expect(() =>
      ConsolidatorBatchSchema.parse({
        proposals: [
          {
            memoryId: '11111111-1111-1111-1111-111111111111',
            action: 'merge',
            reasoning: 'x',
            confidence: 1.5,
          },
        ],
      }),
    ).toThrow();
  });

  it('parseAdversarySafe falls back to confidence 0.0 on garbage', () => {
    const result = parseAdversarySafe('not even json');
    expect(result.adversaryConfidence).toBe(0.0);
    expect(result.objection).toBe('');
  });

  it('parseAdversarySafe falls back when memoryId is missing', () => {
    const result = parseAdversarySafe(JSON.stringify({ adversaryConfidence: 0.5 }));
    expect(result.adversaryConfidence).toBe(0.0);
  });

  it('parseAdversarySafe accepts valid JSON', () => {
    const result = parseAdversarySafe(
      JSON.stringify({
        memoryId: '11111111-1111-1111-1111-111111111111',
        adversaryConfidence: 0.85,
        objection: 'might be needed',
      }),
    );
    expect(result.adversaryConfidence).toBe(0.85);
    expect(result.objection).toBe('might be needed');
  });

  it('parseJudgeSafe falls back to finalAction "keep" on garbage', () => {
    const result = parseJudgeSafe('garbage');
    expect(result.finalAction).toBe('keep');
  });

  it('parseJudgeSafe accepts valid JSON', () => {
    const result = parseJudgeSafe(
      JSON.stringify({
        memoryId: '11111111-1111-1111-1111-111111111111',
        finalAction: 'prune',
        reasoning: 'low value confirmed',
      }),
    );
    expect(result.finalAction).toBe('prune');
  });
});
```

- [ ] **Step 2: Verify it fails**

Run: `pnpm test cleanup-schemas`
Expected: FAIL with "Cannot find module '@/lib/cleanup/schemas'"

- [ ] **Step 3: Implement the schemas**

```ts
// lib/cleanup/schemas.ts
import { z } from 'zod';

/** Action verbs available across all three roles. */
export const ActionEnum = z.enum(['prune', 'merge', 'keep']);
export type Action = z.infer<typeof ActionEnum>;

export const ConsolidatorProposalSchema = z.object({
  memoryId: z.string().uuid(),
  action: ActionEnum,
  reasoning: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
export type ConsolidatorProposal = z.infer<typeof ConsolidatorProposalSchema>;

/** Consolidator returns up to 10 proposals per call (one batch). */
export const ConsolidatorBatchSchema = z.object({
  proposals: z.array(ConsolidatorProposalSchema),
});

export const AdversaryResponseSchema = z.object({
  memoryId: z.string().uuid(),
  adversaryConfidence: z.number().min(0).max(1),
  objection: z.string().default(''),
});
export type AdversaryResponse = z.infer<typeof AdversaryResponseSchema>;

export const JudgeVerdictSchema = z.object({
  memoryId: z.string().uuid(),
  finalAction: ActionEnum,
  reasoning: z.string().min(1),
});
export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>;

/**
 * Permissive parsers used in the runtime path. On any parse failure they
 * return the project's "safe default" (do nothing) rather than throw, so
 * one model misbehaving cannot abort an entire nightly run.
 *
 * The fallbacks honor the asymmetric loss rule from spec §3:
 *   - Adversary fallback ⇒ "no objection" ⇒ Consolidator wins
 *   - Judge fallback     ⇒ "keep"          ⇒ no-op apply
 */
export function parseAdversarySafe(raw: string): AdversaryResponse {
  try {
    const parsed = AdversaryResponseSchema.parse(JSON.parse(stripFences(raw)));
    return parsed;
  } catch {
    return {
      memoryId: '00000000-0000-0000-0000-000000000000',
      adversaryConfidence: 0.0,
      objection: '',
    };
  }
}

export function parseJudgeSafe(raw: string): JudgeVerdict {
  try {
    const parsed = JudgeVerdictSchema.parse(JSON.parse(stripFences(raw)));
    return parsed;
  } catch {
    return {
      memoryId: '00000000-0000-0000-0000-000000000000',
      finalAction: 'keep',
      reasoning: 'parse-failure-fallback',
    };
  }
}

/** Models sometimes wrap JSON in ```json fences. Strip them defensively. */
function stripFences(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    const inner = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    return inner.trim();
  }
  return trimmed;
}
```

- [ ] **Step 4: Verify tests pass**

Run: `pnpm test cleanup-schemas`
Expected: PASS — 7 tests pass

- [ ] **Step 5: Commit**

```bash
git -C .worktree/phase-09-nightly-cleanup-debate add \
  lib/cleanup/schemas.ts \
  tests/cleanup-schemas.test.ts
git -C .worktree/phase-09-nightly-cleanup-debate commit -m "phase 09: Zod schemas + safe parsers for role outputs"
```

---

### Task 3: Errors

**Files:**
- Create: `lib/cleanup/errors.ts`

- [ ] **Step 1: Write the file**

```ts
// lib/cleanup/errors.ts

/**
 * Thrown by lib/cleanup/debate.ts when accumulated USD across roles
 * crosses MAX_RUN_USD. The Inngest function catches this, marks the run
 * row failed, and skips the apply step.
 */
export class CostCapExceededError extends Error {
  readonly accumulatedUsd: number;
  readonly capUsd: number;
  constructor(accumulatedUsd: number, capUsd: number) {
    super(
      `cleanup cost cap exceeded: $${accumulatedUsd.toFixed(4)} >= $${capUsd.toFixed(2)}`,
    );
    this.name = 'CostCapExceededError';
    this.accumulatedUsd = accumulatedUsd;
    this.capUsd = capUsd;
  }
}
```

- [ ] **Step 2: Commit**

No test needed — the error has zero behavior beyond constructing a message; it'll be exercised by Task 11's debate tests.

```bash
git -C .worktree/phase-09-nightly-cleanup-debate add lib/cleanup/errors.ts
git -C .worktree/phase-09-nightly-cleanup-debate commit -m "phase 09: CostCapExceededError"
```

---

### Task 4: Prompt templates

**Files:**
- Create: `lib/cleanup/prompts.ts`

The prompts are pure builders — no I/O. We don't TDD them (snapshot-style tests would just lock the wording in stone). Task 8/9/10 will exercise them via the role functions.

- [ ] **Step 1: Write the file**

```ts
// lib/cleanup/prompts.ts
import type { ConsolidatorProposal } from './schemas';

/** Candidate row as fed to the Consolidator (matches §2 SELECT shape). */
export interface CandidateRow {
  candidateKind: 'prune' | 'merge';
  memoryId: string;
  /** Set on merge candidates only; null for prune. */
  targetMemoryId: string | null;
  segment: string;
  bucket: string;
  content: string;
  importance: string;
  /** Effective importance — set on prune candidates only. */
  effImp: number | null;
  /** Cosine distance — set on merge candidates only (computed in JS for the prompt). */
  cosineDistance: number | null;
  /** Target row's content — set on merge candidates only, fetched server-side for the prompt. */
  targetContent: string | null;
}

const CONSOLIDATOR_SYSTEM = `You are the Consolidator agent in a memory-governance
system. You review batches of memory candidates and propose actions: prune (delete
the memory), merge (mark a near-duplicate pair as redundant), or keep (no change).

You output ONLY valid JSON conforming to this shape:
{
  "proposals": [
    { "memoryId": "<uuid>", "action": "prune"|"merge"|"keep", "reasoning": "<one short sentence>", "confidence": 0.0-1.0 }
  ]
}

You MUST emit one proposal per candidate. Confidence is your own certainty in the action.
For merge candidates, the proposal is for the candidate's memoryId (the older row);
the target row will be tombstoned by the apply step if a merge action is approved.

Be biased toward "keep" when uncertain — errors of omission are cheaper than errors of commission.`;

const ADVERSARY_SYSTEM = `You are the Adversary agent in a memory-governance system.
You receive a single proposal from the Consolidator and your job is to challenge it.
Score how confident you are that the Consolidator is WRONG (0.0 = clearly right,
1.0 = clearly wrong).

Check these five failure modes:
  1. Premature pruning of latent value (might this memory come back useful?)
  2. Merging different-but-similar facts (are these really the same?)
  3. Promoting recency artifacts (recent ≠ important)
  4. Violating segment invariants (does the action contradict the segment's purpose?)
  5. Silent contradiction with existing memories (does another memory rely on this?)

You output ONLY valid JSON conforming to this shape:
{
  "memoryId": "<uuid matching the proposal>",
  "adversaryConfidence": 0.0-1.0,
  "objection": "<one short sentence; empty string if no objection>"
}`;

const JUDGE_SYSTEM = `You are the Judge agent in a memory-governance system. The
Consolidator proposed an action; the Adversary objected with confidence > 0.7.
You must decide the final action.

Apply this asymmetric loss: errors of omission are cheaper than errors of commission.
When in doubt, choose "keep". Override the Consolidator only if you can articulate
a concrete reason to act.

You output ONLY valid JSON conforming to this shape:
{
  "memoryId": "<uuid matching the proposal>",
  "finalAction": "prune"|"merge"|"keep",
  "reasoning": "<one short sentence>"
}`;

export function consolidatorSystemPrompt(): string {
  return CONSOLIDATOR_SYSTEM;
}

export function consolidatorUserPrompt(batch: CandidateRow[]): string {
  const lines = batch.map((c, i) => formatCandidate(i + 1, c));
  return [
    `Review the following ${batch.length} memory candidate(s) and emit a JSON proposals array.`,
    '',
    ...lines,
  ].join('\n');
}

function formatCandidate(idx: number, c: CandidateRow): string {
  const lines = [
    `--- Candidate ${idx} ---`,
    `memoryId: ${c.memoryId}`,
    `kind: ${c.candidateKind}`,
    `segment: ${c.segment}, bucket: ${c.bucket}, importance: ${c.importance}`,
    `content: ${JSON.stringify(c.content)}`,
  ];
  if (c.candidateKind === 'prune' && c.effImp !== null) {
    lines.push(`effectiveImportance: ${c.effImp.toFixed(3)} (below 0.15 threshold)`);
  }
  if (c.candidateKind === 'merge' && c.targetMemoryId !== null) {
    lines.push(
      `targetMemoryId: ${c.targetMemoryId}`,
      `targetContent: ${JSON.stringify(c.targetContent ?? '')}`,
      c.cosineDistance !== null
        ? `cosineDistance: ${c.cosineDistance.toFixed(3)} (below 0.15 threshold)`
        : '',
    );
  }
  return lines.filter(Boolean).join('\n');
}

export function adversarySystemPrompt(): string {
  return ADVERSARY_SYSTEM;
}

export function adversaryUserPrompt(
  proposal: ConsolidatorProposal,
  candidate: CandidateRow,
): string {
  return [
    `Review this Consolidator proposal:`,
    JSON.stringify(proposal, null, 2),
    '',
    `Candidate context:`,
    formatCandidate(1, candidate),
    '',
    `Score your confidence that the proposal is WRONG.`,
  ].join('\n');
}

export function judgeSystemPrompt(): string {
  return JUDGE_SYSTEM;
}

export function judgeUserPrompt(
  proposal: ConsolidatorProposal,
  adversaryObjection: string,
  candidate: CandidateRow,
): string {
  return [
    `Consolidator proposal:`,
    JSON.stringify(proposal, null, 2),
    '',
    `Adversary objection (confidence > 0.7):`,
    adversaryObjection,
    '',
    `Candidate context:`,
    formatCandidate(1, candidate),
    '',
    `Decide the final action. Bias toward "keep".`,
  ].join('\n');
}
```

- [ ] **Step 2: Commit**

```bash
git -C .worktree/phase-09-nightly-cleanup-debate add lib/cleanup/prompts.ts
git -C .worktree/phase-09-nightly-cleanup-debate commit -m "phase 09: prompt templates for Consolidator/Adversary/Judge"
```

---

### Task 5: Candidate selection SQL

**Files:**
- Create: `db/queries/cleanup-candidates.ts`
- Test: `tests/cleanup-candidates.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/cleanup-candidates.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { selectCleanupCandidates } from '@/db/queries/cleanup-candidates';

const url = process.env.DATABASE_URL_UNPOOLED;
const skipSuite = url ? describe : describe.skip;

function basisVec(primary: number, secondary = primary, eps = 0.001): number[] {
  const v = new Array<number>(1536).fill(0);
  v[primary] = 1;
  if (secondary !== primary) v[secondary] = eps;
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / norm);
}

skipSuite('phase-09 cleanup candidate selection', () => {
  const rawSql = postgres(url!, { max: 1, idle_timeout: 2 });
  const TEST_ID = 'phase-09-candidates';

  beforeAll(async () => {
    await rawSql`DELETE FROM memories WHERE metadata->>'test_id' = ${TEST_ID}`;
    // Stale low-importance preference (eff_imp < 0.15 after decay)
    await rawSql`INSERT INTO memories (segment, bucket, content, importance, embedding, last_accessed_at, metadata)
                 VALUES ('preference', 'short', 'stale prune candidate', 0.10,
                         ${JSON.stringify(basisVec(0))}::vector,
                         now() - interval '60 days',
                         ${rawSql.json({ test_id: TEST_ID, role: 'prune-cand' })})`;
    // Permanent row (must NOT be a prune candidate even with low importance)
    await rawSql`INSERT INTO memories (segment, bucket, content, importance, embedding, last_accessed_at, metadata)
                 VALUES ('preference', 'permanent', 'permanent low-imp', 0.10,
                         ${JSON.stringify(basisVec(1))}::vector,
                         now() - interval '60 days',
                         ${rawSql.json({ test_id: TEST_ID, role: 'permanent' })})`;
    // Tombstoned row (must NOT appear in either query)
    await rawSql`INSERT INTO memories (segment, bucket, content, importance, embedding, last_accessed_at, tombstoned_at, metadata)
                 VALUES ('preference', 'short', 'tombstoned', 0.10,
                         ${JSON.stringify(basisVec(2))}::vector,
                         now() - interval '60 days',
                         now(),
                         ${rawSql.json({ test_id: TEST_ID, role: 'tombstoned' })})`;
    // Near-duplicate merge pair (cosine distance ~0)
    await rawSql`INSERT INTO memories (segment, bucket, content, importance, embedding, last_accessed_at, metadata)
                 VALUES ('knowledge', 'short', 'merge pair A', 0.60,
                         ${JSON.stringify(basisVec(3))}::vector,
                         now(),
                         ${rawSql.json({ test_id: TEST_ID, role: 'merge-a' })})`;
    await rawSql`INSERT INTO memories (segment, bucket, content, importance, embedding, last_accessed_at, metadata)
                 VALUES ('knowledge', 'short', 'merge pair B', 0.45,
                         ${JSON.stringify(basisVec(3, 4, 0.001))}::vector,
                         now(),
                         ${rawSql.json({ test_id: TEST_ID, role: 'merge-b' })})`;
  });

  afterAll(async () => {
    await rawSql`DELETE FROM memories WHERE metadata->>'test_id' = ${TEST_ID}`;
    await rawSql.end();
  });

  it('returns the stale low-importance row as a prune candidate', async () => {
    const candidates = await selectCleanupCandidates({ pruneLimit: 50, mergeLimit: 50 });
    const prunes = candidates.filter((c) => c.candidateKind === 'prune');
    expect(prunes.some((c) => c.content === 'stale prune candidate')).toBe(true);
  });

  it('excludes permanent bucket from prune candidates', async () => {
    const candidates = await selectCleanupCandidates({ pruneLimit: 50, mergeLimit: 50 });
    const prunes = candidates.filter((c) => c.candidateKind === 'prune');
    expect(prunes.some((c) => c.content === 'permanent low-imp')).toBe(false);
  });

  it('excludes tombstoned rows from both queries', async () => {
    const candidates = await selectCleanupCandidates({ pruneLimit: 50, mergeLimit: 50 });
    expect(candidates.some((c) => c.content === 'tombstoned')).toBe(false);
  });

  it('returns the near-duplicate pair as exactly one merge candidate (a < b)', async () => {
    const candidates = await selectCleanupCandidates({ pruneLimit: 50, mergeLimit: 50 });
    const merges = candidates.filter(
      (c) =>
        c.candidateKind === 'merge' &&
        (c.content === 'merge pair A' || c.content === 'merge pair B'),
    );
    expect(merges).toHaveLength(1);
    // The asymmetric `b.id > a.id` ordering means content of memoryId is older row.
    // We can't predict UUID order, but we can assert the pair is collapsed:
    expect(merges[0]!.targetMemoryId).not.toBeNull();
  });

  it('honors pruneLimit and mergeLimit caps', async () => {
    const candidates = await selectCleanupCandidates({ pruneLimit: 0, mergeLimit: 0 });
    expect(candidates).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Verify it fails**

Run: `pnpm test cleanup-candidates`
Expected: FAIL with "Cannot find module '@/db/queries/cleanup-candidates'" (or skip if `DATABASE_URL_UNPOOLED` not set — that is acceptable for local CI; the test runs against the real Neon DB).

- [ ] **Step 3: Implement the candidate selector**

```ts
// db/queries/cleanup-candidates.ts
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

export interface CleanupCandidate {
  candidateKind: 'prune' | 'merge';
  memoryId: string;
  targetMemoryId: string | null;
  segment: string;
  bucket: string;
  content: string;
  importance: string;
  /** Set on prune candidates only. */
  effImp: number | null;
  /** Set on merge candidates only. */
  cosineDistance: number | null;
  /** Set on merge candidates only — the target row's content for prompt context. */
  targetContent: string | null;
}

export interface SelectCandidatesArgs {
  pruneLimit: number; // default 50
  mergeLimit: number; // default 50
}

/**
 * Deterministic SQL — no LLMs, no agent. Returns up to (pruneLimit +
 * mergeLimit) candidates ordered by severity within each kind.
 *
 * Pruning rule:    eff_imp < 0.15, bucket != 'permanent', not tombstoned.
 * Merging rule:    same segment, b.id > a.id (no dupes), embedding present
 *                  on both, cosine distance < 0.15.
 *
 * The effective-importance expression matches lib/memory/decay-sql.ts.
 * We re-implement it inline (rather than calling effectiveImportanceSql)
 * because the SELECT alias machinery is awkward across the UNION here;
 * if you change the formula, change both places. Phase 04's
 * `tests/memory-lifecycle.test.ts` exercises the canonical shape.
 */
export async function selectCleanupCandidates(
  args: SelectCandidatesArgs,
): Promise<CleanupCandidate[]> {
  const { pruneLimit, mergeLimit } = args;

  const result = (await db.execute(sql`
    WITH prune_cands AS (
      SELECT
        'prune'::text AS candidate_kind,
        m.id AS memory_id,
        NULL::uuid AS target_memory_id,
        m.segment::text AS segment,
        m.bucket::text  AS bucket,
        m.content,
        m.importance::text AS importance,
        (m.importance::float8 * exp(
          -(CASE m.bucket
              WHEN 'permanent' THEN 0
              WHEN 'short'     THEN c.decay_lambda_short
              WHEN 'long'      THEN c.decay_lambda_long_factor * (1 - 0.8 * m.importance::float8)
            END)
          * (extract(epoch from (now() - m.last_accessed_at)) / 86400.0)
        )) AS eff_imp,
        NULL::float8 AS cosine_distance,
        NULL::text   AS target_content
      FROM memories m
      JOIN memory_segment_config c ON c.segment = m.segment
      WHERE m.tombstoned_at IS NULL AND m.bucket <> 'permanent'
    ),
    prune_picks AS (
      SELECT * FROM prune_cands
      WHERE eff_imp < 0.15
      ORDER BY eff_imp ASC
      LIMIT ${pruneLimit}
    ),
    merge_picks AS (
      SELECT
        'merge'::text AS candidate_kind,
        a.id AS memory_id,
        b.id AS target_memory_id,
        a.segment::text AS segment,
        a.bucket::text  AS bucket,
        a.content,
        a.importance::text AS importance,
        NULL::float8 AS eff_imp,
        (a.embedding <=> b.embedding) AS cosine_distance,
        b.content    AS target_content
      FROM memories a
      JOIN memories b
        ON b.segment = a.segment
       AND b.id > a.id
       AND b.tombstoned_at IS NULL
       AND b.embedding IS NOT NULL
      WHERE a.tombstoned_at IS NULL
        AND a.embedding IS NOT NULL
        AND (a.embedding <=> b.embedding) < 0.15
      ORDER BY (a.embedding <=> b.embedding) ASC
      LIMIT ${mergeLimit}
    )
    SELECT * FROM prune_picks
    UNION ALL
    SELECT * FROM merge_picks
  `)) as unknown as {
    rows: Array<{
      candidate_kind: 'prune' | 'merge';
      memory_id: string;
      target_memory_id: string | null;
      segment: string;
      bucket: string;
      content: string;
      importance: string;
      eff_imp: number | null;
      cosine_distance: number | null;
      target_content: string | null;
    }>;
  };

  return result.rows.map((r) => ({
    candidateKind: r.candidate_kind,
    memoryId: r.memory_id,
    targetMemoryId: r.target_memory_id,
    segment: r.segment,
    bucket: r.bucket,
    content: r.content,
    importance: r.importance,
    effImp: r.eff_imp === null ? null : Number(r.eff_imp),
    cosineDistance:
      r.cosine_distance === null ? null : Number(r.cosine_distance),
    targetContent: r.target_content,
  }));
}
```

- [ ] **Step 4: Verify tests pass**

Run: `pnpm test cleanup-candidates`
Expected: PASS — 5 tests pass (or `skip` if `DATABASE_URL_UNPOOLED` is unset).

- [ ] **Step 5: Commit**

```bash
git -C .worktree/phase-09-nightly-cleanup-debate add \
  db/queries/cleanup-candidates.ts \
  tests/cleanup-candidates.test.ts
git -C .worktree/phase-09-nightly-cleanup-debate commit -m "phase 09: candidate selection SQL (prune + merge with caps)"
```

---

### Task 6: Apply step — prune + merge mutations

**Files:**
- Create: `db/queries/cleanup-apply.ts`
- Test: `tests/cleanup-apply.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/cleanup-apply.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { applyVerdicts, type Verdict } from '@/db/queries/cleanup-apply';

const url = process.env.DATABASE_URL_UNPOOLED;
const skipSuite = url ? describe : describe.skip;

function basisVec(primary: number): number[] {
  const v = new Array<number>(1536).fill(0);
  v[primary] = 1;
  return v;
}

skipSuite('phase-09 cleanup apply', () => {
  const rawSql = postgres(url!, { max: 1, idle_timeout: 2 });
  const TEST_ID = 'phase-09-apply';

  // Re-seeded fresh for each test
  let pruneId = '';
  let mergeAId = ''; // higher importance, expected survivor
  let mergeBId = ''; // lower importance, expected loser
  let runId = '';
  let proposalPruneId = '';
  let proposalMergeId = '';

  beforeAll(async () => {
    await rawSql`DELETE FROM memory_links WHERE proposal_id IN (
                   SELECT id FROM memory_cleanup_proposals WHERE memory_id IN (
                     SELECT id FROM memories WHERE metadata->>'test_id' = ${TEST_ID}))`;
    await rawSql`DELETE FROM memory_cleanup_proposals WHERE memory_id IN (
                   SELECT id FROM memories WHERE metadata->>'test_id' = ${TEST_ID})`;
    await rawSql`DELETE FROM memory_cleanup_runs WHERE id IN (
                   SELECT run_id FROM memory_cleanup_proposals WHERE memory_id IN (
                     SELECT id FROM memories WHERE metadata->>'test_id' = ${TEST_ID}))`;
    await rawSql`DELETE FROM memories WHERE metadata->>'test_id' = ${TEST_ID}`;

    const [p] = await rawSql<{ id: string }[]>`
      INSERT INTO memories (segment, bucket, content, importance, embedding, metadata)
      VALUES ('preference', 'short', 'apply prune target', 0.10,
              ${JSON.stringify(basisVec(0))}::vector,
              ${rawSql.json({ test_id: TEST_ID })})
      RETURNING id`;
    pruneId = p!.id;

    const [a] = await rawSql<{ id: string }[]>`
      INSERT INTO memories (segment, bucket, content, importance, embedding, metadata)
      VALUES ('knowledge', 'short', 'merge survivor (higher imp)', 0.80,
              ${JSON.stringify(basisVec(1))}::vector,
              ${rawSql.json({ test_id: TEST_ID })})
      RETURNING id`;
    mergeAId = a!.id;
    const [b] = await rawSql<{ id: string }[]>`
      INSERT INTO memories (segment, bucket, content, importance, embedding, metadata)
      VALUES ('knowledge', 'short', 'merge loser (lower imp)', 0.40,
              ${JSON.stringify(basisVec(1))}::vector,
              ${rawSql.json({ test_id: TEST_ID })})
      RETURNING id`;
    mergeBId = b!.id;

    const [r] = await rawSql<{ id: string }[]>`
      INSERT INTO memory_cleanup_runs (status) VALUES ('running') RETURNING id`;
    runId = r!.id;
    const [pp] = await rawSql<{ id: string }[]>`
      INSERT INTO memory_cleanup_proposals
        (run_id, memory_id, action, final_action, consolidator)
      VALUES (${runId}::uuid, ${pruneId}::uuid, 'prune', 'prune',
              ${rawSql.json({ reasoning: 'test', confidence: 0.9 })})
      RETURNING id`;
    proposalPruneId = pp!.id;
    const [pm] = await rawSql<{ id: string }[]>`
      INSERT INTO memory_cleanup_proposals
        (run_id, memory_id, target_memory_id, action, final_action, consolidator)
      VALUES (${runId}::uuid, ${mergeAId}::uuid, ${mergeBId}::uuid,
              'merge', 'merge', ${rawSql.json({ reasoning: 'test', confidence: 0.9 })})
      RETURNING id`;
    proposalMergeId = pm!.id;
  });

  afterAll(async () => {
    await rawSql`DELETE FROM memory_links WHERE proposal_id IN (${proposalPruneId}, ${proposalMergeId})`;
    await rawSql`DELETE FROM memory_cleanup_proposals WHERE id IN (${proposalPruneId}, ${proposalMergeId})`;
    await rawSql`DELETE FROM memory_cleanup_runs WHERE id = ${runId}`;
    await rawSql`DELETE FROM memories WHERE metadata->>'test_id' = ${TEST_ID}`;
    await rawSql.end();
  });

  it('prune verdict tombstones the memory and tags metadata', async () => {
    const verdicts: Verdict[] = [
      {
        proposalId: proposalPruneId,
        memoryId: pruneId,
        targetMemoryId: null,
        finalAction: 'prune',
      },
    ];
    const result = await applyVerdicts(verdicts);
    expect(result.applied).toBe(1);

    const [row] = await rawSql<
      { tombstoned_at: Date | null; metadata: Record<string, unknown> }[]
    >`SELECT tombstoned_at, metadata FROM memories WHERE id = ${pruneId}`;
    expect(row!.tombstoned_at).not.toBeNull();
    expect(row!.metadata.tombstone_reason).toBe('cleanup-proposal');
    expect(row!.metadata.proposal_id).toBe(proposalPruneId);
  });

  it('merge verdict tombstones loser, leaves survivor live, writes link', async () => {
    const verdicts: Verdict[] = [
      {
        proposalId: proposalMergeId,
        memoryId: mergeAId,
        targetMemoryId: mergeBId,
        finalAction: 'merge',
      },
    ];
    const result = await applyVerdicts(verdicts);
    expect(result.applied).toBe(1);

    const [survivor] = await rawSql<
      { tombstoned_at: Date | null }[]
    >`SELECT tombstoned_at FROM memories WHERE id = ${mergeAId}`;
    expect(survivor!.tombstoned_at).toBeNull();

    const [loser] = await rawSql<
      { tombstoned_at: Date | null; metadata: Record<string, unknown> }[]
    >`SELECT tombstoned_at, metadata FROM memories WHERE id = ${mergeBId}`;
    expect(loser!.tombstoned_at).not.toBeNull();
    expect(loser!.metadata.merged_into).toBe(mergeAId);

    const [link] = await rawSql<
      { parent_id: string; child_id: string; link_type: string }[]
    >`SELECT parent_id, child_id, link_type FROM memory_links
        WHERE proposal_id = ${proposalMergeId}`;
    expect(link!.parent_id).toBe(mergeAId);
    expect(link!.child_id).toBe(mergeBId);
    expect(link!.link_type).toBe('merged');
  });

  it('keep verdict is a no-op (no tombstone, applied count 0)', async () => {
    const verdicts: Verdict[] = [
      {
        proposalId: '00000000-0000-0000-0000-000000000099',
        memoryId: mergeAId,
        targetMemoryId: null,
        finalAction: 'keep',
      },
    ];
    const result = await applyVerdicts(verdicts);
    expect(result.applied).toBe(0);
    const [row] = await rawSql<
      { tombstoned_at: Date | null }[]
    >`SELECT tombstoned_at FROM memories WHERE id = ${mergeAId}`;
    expect(row!.tombstoned_at).toBeNull();
  });
});
```

- [ ] **Step 2: Verify it fails**

Run: `pnpm test cleanup-apply`
Expected: FAIL with "Cannot find module '@/db/queries/cleanup-apply'"

- [ ] **Step 3: Implement applyVerdicts**

```ts
// db/queries/cleanup-apply.ts
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { memories, memoryLinks } from '@/db/schema/memories';
import { memoryCleanupProposals } from '@/db/schema/cleanup';
import type { Action } from '@/lib/cleanup/schemas';

export interface Verdict {
  proposalId: string;
  memoryId: string;
  targetMemoryId: string | null; // set for merge verdicts only
  finalAction: Action;
}

export interface ApplyResult {
  applied: number;
  tombstones: number;
  merges: number;
  skipped: number;
}

/**
 * Translate Judge/Consolidator verdicts into memory mutations. Prune verdicts
 * are applied first (tombstone), then merge verdicts (survivor + tombstone +
 * link). `keep` verdicts are no-op but still bump the proposals' applied_at
 * column so the audit row records "reviewed".
 *
 * Survivor heuristic for merge: higher importance wins; tie → memoryId
 * (which is the older `a` from the merge candidate query's `b.id > a.id`).
 */
export async function applyVerdicts(verdicts: Verdict[]): Promise<ApplyResult> {
  const result: ApplyResult = { applied: 0, tombstones: 0, merges: 0, skipped: 0 };

  // §4 ordering: prune before merge.
  const prunes = verdicts.filter((v) => v.finalAction === 'prune');
  const merges = verdicts.filter((v) => v.finalAction === 'merge');
  const keeps = verdicts.filter((v) => v.finalAction === 'keep');

  for (const v of prunes) {
    const updated = await db
      .update(memories)
      .set({
        tombstonedAt: new Date(),
        metadata: sql`${memories.metadata} || jsonb_build_object(
          'tombstone_reason', 'cleanup-proposal',
          'proposal_id', ${v.proposalId}::text
        )`,
      })
      .where(and(eq(memories.id, v.memoryId), isNull(memories.tombstonedAt)))
      .returning({ id: memories.id });

    if (updated.length > 0) {
      result.applied += 1;
      result.tombstones += 1;
      await db
        .update(memoryCleanupProposals)
        .set({ appliedAt: new Date() })
        .where(eq(memoryCleanupProposals.id, v.proposalId));
    } else {
      result.skipped += 1;
    }
  }

  for (const v of merges) {
    if (v.targetMemoryId === null) {
      result.skipped += 1;
      continue;
    }
    // Re-fetch live state — survivor may have shifted since selection
    const rows = await db
      .select({
        id: memories.id,
        importance: memories.importance,
        tombstonedAt: memories.tombstonedAt,
      })
      .from(memories)
      .where(inArray(memories.id, [v.memoryId, v.targetMemoryId]));

    if (rows.length !== 2 || rows.some((r) => r.tombstonedAt !== null)) {
      result.skipped += 1;
      continue;
    }

    const a = rows.find((r) => r.id === v.memoryId)!;
    const b = rows.find((r) => r.id === v.targetMemoryId)!;
    const aImp = Number(a.importance);
    const bImp = Number(b.importance);
    const survivor = aImp >= bImp ? a : b; // tie → a (memoryId)
    const loser = survivor === a ? b : a;

    await db.insert(memoryLinks).values({
      parentId: survivor.id,
      childId: loser.id,
      linkType: 'merged',
      proposalId: v.proposalId,
    });

    await db
      .update(memories)
      .set({
        tombstonedAt: new Date(),
        metadata: sql`${memories.metadata} || jsonb_build_object(
          'tombstone_reason', 'merged-into',
          'merged_into', ${survivor.id}::text,
          'proposal_id', ${v.proposalId}::text
        )`,
      })
      .where(and(eq(memories.id, loser.id), isNull(memories.tombstonedAt)));

    result.applied += 1;
    result.merges += 1;
    await db
      .update(memoryCleanupProposals)
      .set({ appliedAt: new Date() })
      .where(eq(memoryCleanupProposals.id, v.proposalId));
  }

  for (const v of keeps) {
    // No mutation; record review timestamp on the proposal row.
    await db
      .update(memoryCleanupProposals)
      .set({ appliedAt: new Date() })
      .where(eq(memoryCleanupProposals.id, v.proposalId));
  }

  return result;
}
```

- [ ] **Step 4: Verify tests pass**

Run: `pnpm test cleanup-apply`
Expected: PASS — 3 tests pass (or skip if no DB).

- [ ] **Step 5: Commit**

```bash
git -C .worktree/phase-09-nightly-cleanup-debate add \
  db/queries/cleanup-apply.ts \
  tests/cleanup-apply.test.ts
git -C .worktree/phase-09-nightly-cleanup-debate commit -m "phase 09: apply step (prune tombstone, merge survivor + link, keep no-op)"
```

---

### Task 7: Consolidator role function

**Files:**
- Create: `lib/cleanup/consolidator.ts`

This task does NOT have its own dedicated test file — Task 11 (debate orchestration) exercises Consolidator/Adversary/Judge end-to-end against a mocked SDK. Single-shot wrappers like this are a thin enough adapter that direct unit tests would test the SDK, not us.

- [ ] **Step 1: Write the file**

```ts
// lib/cleanup/consolidator.ts
import Anthropic from '@anthropic-ai/sdk';
import {
  ConsolidatorBatchSchema,
  type ConsolidatorProposal,
} from './schemas';
import {
  consolidatorSystemPrompt,
  consolidatorUserPrompt,
  type CandidateRow,
} from './prompts';
import {
  computeCallCostUsd,
  ROLE_MODEL,
  type AnthropicUsage,
} from './cost-tracker';

export interface ConsolidatorRunResult {
  proposals: ConsolidatorProposal[];
  costUsd: number;
  parseFailed: boolean;
}

/**
 * Single Consolidator call over a batch of candidates (≤10).
 * On parse failure: returns { proposals: [], parseFailed: true } — the
 * batch is dropped from the run. The cost is still recorded since the
 * tokens were consumed.
 */
export async function runConsolidator(
  batch: CandidateRow[],
  client: Anthropic,
): Promise<ConsolidatorRunResult> {
  const response = await client.messages.create({
    model: ROLE_MODEL.consolidator,
    max_tokens: 2048,
    system: consolidatorSystemPrompt(),
    messages: [{ role: 'user', content: consolidatorUserPrompt(batch) }],
  });

  const usage = response.usage as AnthropicUsage;
  const costUsd = computeCallCostUsd(ROLE_MODEL.consolidator, usage);
  const text = extractText(response);

  try {
    const parsed = ConsolidatorBatchSchema.parse(JSON.parse(stripFences(text)));
    return { proposals: parsed.proposals, costUsd, parseFailed: false };
  } catch {
    return { proposals: [], costUsd, parseFailed: true };
  }
}

function extractText(response: Anthropic.Message): string {
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

function stripFences(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }
  return trimmed;
}
```

- [ ] **Step 2: Commit**

```bash
git -C .worktree/phase-09-nightly-cleanup-debate add lib/cleanup/consolidator.ts
git -C .worktree/phase-09-nightly-cleanup-debate commit -m "phase 09: Consolidator role (Sonnet 4.6, batched proposals, fence-tolerant parser)"
```

---

### Task 8: Adversary role function

**Files:**
- Create: `lib/cleanup/adversary.ts`

- [ ] **Step 1: Write the file**

```ts
// lib/cleanup/adversary.ts
import Anthropic from '@anthropic-ai/sdk';
import { parseAdversarySafe, type AdversaryResponse, type ConsolidatorProposal } from './schemas';
import { adversarySystemPrompt, adversaryUserPrompt, type CandidateRow } from './prompts';
import { computeCallCostUsd, ROLE_MODEL, type AnthropicUsage } from './cost-tracker';

export interface AdversaryRunResult {
  response: AdversaryResponse;
  costUsd: number;
}

/**
 * Single Adversary call over one Consolidator proposal. parseAdversarySafe
 * defaults to confidence 0.0 on bad JSON ⇒ Consolidator wins ⇒ Judge skipped.
 */
export async function runAdversary(
  proposal: ConsolidatorProposal,
  candidate: CandidateRow,
  client: Anthropic,
): Promise<AdversaryRunResult> {
  const response = await client.messages.create({
    model: ROLE_MODEL.adversary,
    max_tokens: 512,
    system: adversarySystemPrompt(),
    messages: [{ role: 'user', content: adversaryUserPrompt(proposal, candidate) }],
  });

  const usage = response.usage as AnthropicUsage;
  const costUsd = computeCallCostUsd(ROLE_MODEL.adversary, usage);
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const parsed = parseAdversarySafe(text);
  // Override the fallback memoryId with the proposal's so downstream code
  // can correlate. Confidence stays whatever parseAdversarySafe returned.
  return {
    response: { ...parsed, memoryId: proposal.memoryId },
    costUsd,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git -C .worktree/phase-09-nightly-cleanup-debate add lib/cleanup/adversary.ts
git -C .worktree/phase-09-nightly-cleanup-debate commit -m "phase 09: Adversary role (Haiku 4.5, safe-parse fallback to no-objection)"
```

---

### Task 9: Judge role function

**Files:**
- Create: `lib/cleanup/judge.ts`

- [ ] **Step 1: Write the file**

```ts
// lib/cleanup/judge.ts
import Anthropic from '@anthropic-ai/sdk';
import { parseJudgeSafe, type JudgeVerdict, type ConsolidatorProposal } from './schemas';
import { judgeSystemPrompt, judgeUserPrompt, type CandidateRow } from './prompts';
import { computeCallCostUsd, ROLE_MODEL, type AnthropicUsage } from './cost-tracker';

export interface JudgeRunResult {
  verdict: JudgeVerdict;
  costUsd: number;
}

/**
 * Single Judge call over a contested proposal. parseJudgeSafe defaults to
 * finalAction='keep' on bad JSON ⇒ no-op apply (asymmetric loss safe bet).
 */
export async function runJudge(
  proposal: ConsolidatorProposal,
  adversaryObjection: string,
  candidate: CandidateRow,
  client: Anthropic,
): Promise<JudgeRunResult> {
  const response = await client.messages.create({
    model: ROLE_MODEL.judge,
    max_tokens: 512,
    system: judgeSystemPrompt(),
    messages: [
      { role: 'user', content: judgeUserPrompt(proposal, adversaryObjection, candidate) },
    ],
  });

  const usage = response.usage as AnthropicUsage;
  const costUsd = computeCallCostUsd(ROLE_MODEL.judge, usage);
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const parsed = parseJudgeSafe(text);
  return {
    verdict: { ...parsed, memoryId: proposal.memoryId },
    costUsd,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git -C .worktree/phase-09-nightly-cleanup-debate add lib/cleanup/judge.ts
git -C .worktree/phase-09-nightly-cleanup-debate commit -m "phase 09: Judge role (Opus 4.6, safe-parse fallback to keep)"
```

---

### Task 10: Debate orchestration + cost cap

**Files:**
- Create: `lib/cleanup/debate.ts`
- Test: `tests/cleanup-debate.test.ts`

This is the heart of the phase — the C → A → J pipeline with a cost-cap guard between every model call. We TDD against a mocked Anthropic client to verify the dispatch logic.

- [ ] **Step 1: Write failing tests**

```ts
// tests/cleanup-debate.test.ts
import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { runDebate, JUDGE_THRESHOLD } from '@/lib/cleanup/debate';
import { CostCapExceededError } from '@/lib/cleanup/errors';
import type { CandidateRow } from '@/lib/cleanup/prompts';

function mkCandidate(overrides: Partial<CandidateRow> = {}): CandidateRow {
  return {
    candidateKind: 'prune',
    memoryId: '11111111-1111-1111-1111-111111111111',
    targetMemoryId: null,
    segment: 'preference',
    bucket: 'short',
    content: 'test',
    importance: '0.10',
    effImp: 0.05,
    cosineDistance: null,
    targetContent: null,
    ...overrides,
  };
}

function mkClient(textsByModel: Record<string, string[]>): Anthropic {
  const queues: Record<string, string[]> = { ...textsByModel };
  const messages = {
    create: vi.fn(async (args: { model: string }) => {
      const next = (queues[args.model] ?? []).shift() ?? '{}';
      return {
        content: [{ type: 'text', text: next }],
        usage: {
          input_tokens: 100,
          output_tokens: 100,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      };
    }),
  };
  return { messages } as unknown as Anthropic;
}

describe('cleanup debate orchestration', () => {
  it('Adversary confidence ≤ threshold ⇒ Judge skipped, consolidator wins', async () => {
    const candidates = [mkCandidate()];
    const client = mkClient({
      'claude-sonnet-4-6': [
        JSON.stringify({
          proposals: [
            {
              memoryId: candidates[0]!.memoryId,
              action: 'prune',
              reasoning: 'low',
              confidence: 0.9,
            },
          ],
        }),
      ],
      'claude-haiku-4-5': [
        JSON.stringify({
          memoryId: candidates[0]!.memoryId,
          adversaryConfidence: JUDGE_THRESHOLD - 0.1,
          objection: 'maybe',
        }),
      ],
      'claude-opus-4-6': [], // never called
    });
    const result = await runDebate({ candidates, client, maxRunUsd: 100 });

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]!.finalAction).toBe('prune');
    expect(result.proposals[0]!.judge).toBeNull();
    expect(result.proposalsContested).toBe(0);
    expect(result.proposalsJudged).toBe(0);
  });

  it('Adversary confidence > threshold ⇒ Judge fires, verdict overrides', async () => {
    const candidates = [mkCandidate()];
    const client = mkClient({
      'claude-sonnet-4-6': [
        JSON.stringify({
          proposals: [
            {
              memoryId: candidates[0]!.memoryId,
              action: 'prune',
              reasoning: 'low',
              confidence: 0.9,
            },
          ],
        }),
      ],
      'claude-haiku-4-5': [
        JSON.stringify({
          memoryId: candidates[0]!.memoryId,
          adversaryConfidence: JUDGE_THRESHOLD + 0.1,
          objection: 'might be needed',
        }),
      ],
      'claude-opus-4-6': [
        JSON.stringify({
          memoryId: candidates[0]!.memoryId,
          finalAction: 'keep',
          reasoning: 'asymmetric loss',
        }),
      ],
    });
    const result = await runDebate({ candidates, client, maxRunUsd: 100 });

    expect(result.proposals[0]!.finalAction).toBe('keep');
    expect(result.proposals[0]!.judge).not.toBeNull();
    expect(result.proposalsContested).toBe(1);
    expect(result.proposalsJudged).toBe(1);
  });

  it('Malformed Consolidator JSON ⇒ batch dropped, run continues', async () => {
    const candidates = [mkCandidate()];
    const client = mkClient({
      'claude-sonnet-4-6': ['not json at all'],
      'claude-haiku-4-5': [],
      'claude-opus-4-6': [],
    });
    const result = await runDebate({ candidates, client, maxRunUsd: 100 });
    expect(result.proposals).toHaveLength(0);
    expect(result.proposalsGenerated).toBe(0);
    expect(result.parseFailures).toBe(1);
  });

  it('Cost cap exceeded ⇒ throws CostCapExceededError', async () => {
    const candidates = [mkCandidate()];
    const client = mkClient({
      'claude-sonnet-4-6': [
        JSON.stringify({
          proposals: [
            {
              memoryId: candidates[0]!.memoryId,
              action: 'prune',
              reasoning: 'low',
              confidence: 0.9,
            },
          ],
        }),
      ],
      'claude-haiku-4-5': [],
      'claude-opus-4-6': [],
    });
    await expect(
      runDebate({ candidates, client, maxRunUsd: 0.0000001 }),
    ).rejects.toBeInstanceOf(CostCapExceededError);
  });

  it('Batches Consolidator calls in groups of 10', async () => {
    const candidates = Array.from({ length: 25 }, (_, i) =>
      mkCandidate({
        memoryId: `1111${String(i).padStart(4, '0')}-1111-1111-1111-111111111111`,
      }),
    );
    const client = mkClient({
      'claude-sonnet-4-6': [
        JSON.stringify({ proposals: [] }),
        JSON.stringify({ proposals: [] }),
        JSON.stringify({ proposals: [] }),
      ],
      'claude-haiku-4-5': [],
      'claude-opus-4-6': [],
    });
    await runDebate({ candidates, client, maxRunUsd: 100 });
    expect(
      (client as unknown as { messages: { create: ReturnType<typeof vi.fn> } }).messages.create,
    ).toHaveBeenCalledTimes(3); // 25 / 10 = 3 batches (10, 10, 5)
  });
});
```

- [ ] **Step 2: Verify it fails**

Run: `pnpm test cleanup-debate`
Expected: FAIL with "Cannot find module '@/lib/cleanup/debate'"

- [ ] **Step 3: Implement runDebate**

```ts
// lib/cleanup/debate.ts
import type Anthropic from '@anthropic-ai/sdk';
import type { CandidateRow } from './prompts';
import type { ConsolidatorProposal, AdversaryResponse, JudgeVerdict } from './schemas';
import { runConsolidator } from './consolidator';
import { runAdversary } from './adversary';
import { runJudge } from './judge';
import { CostCapExceededError } from './errors';

export const JUDGE_THRESHOLD = 0.7;
export const CONSOLIDATOR_BATCH_SIZE = 10;

export interface DebateProposalRecord {
  memoryId: string;
  targetMemoryId: string | null;
  consolidator: ConsolidatorProposal;
  adversary: AdversaryResponse | null;
  judge: JudgeVerdict | null;
  finalAction: 'prune' | 'merge' | 'keep';
}

export interface DebateRunArgs {
  candidates: CandidateRow[];
  client: Anthropic;
  maxRunUsd: number;
}

export interface DebateRunResult {
  proposals: DebateProposalRecord[];
  costUsd: number;
  proposalsGenerated: number;
  proposalsContested: number;
  proposalsJudged: number;
  parseFailures: number;
}

/**
 * The C → A → J pipeline. Cost is tracked across every model call; if the
 * running total crosses maxRunUsd before a step starts, throws
 * CostCapExceededError. Caller (the Inngest function) catches and marks
 * the run row failed.
 */
export async function runDebate(args: DebateRunArgs): Promise<DebateRunResult> {
  const { candidates, client, maxRunUsd } = args;
  let costUsd = 0;
  let parseFailures = 0;
  const allProposals: DebateProposalRecord[] = [];
  const candidateById = new Map(candidates.map((c) => [c.memoryId, c]));

  // Step 1: Consolidator over batches of 10
  for (let i = 0; i < candidates.length; i += CONSOLIDATOR_BATCH_SIZE) {
    if (costUsd >= maxRunUsd) throw new CostCapExceededError(costUsd, maxRunUsd);
    const batch = candidates.slice(i, i + CONSOLIDATOR_BATCH_SIZE);
    const r = await runConsolidator(batch, client);
    costUsd += r.costUsd;
    if (r.parseFailed) {
      parseFailures += 1;
      continue;
    }
    for (const p of r.proposals) {
      const cand = candidateById.get(p.memoryId);
      if (!cand) continue; // model hallucinated a memoryId; drop
      allProposals.push({
        memoryId: p.memoryId,
        targetMemoryId: cand.targetMemoryId,
        consolidator: p,
        adversary: null,
        judge: null,
        finalAction: p.action,
      });
    }
  }

  // Step 2: Adversary over each proposal
  for (const record of allProposals) {
    if (costUsd >= maxRunUsd) throw new CostCapExceededError(costUsd, maxRunUsd);
    const cand = candidateById.get(record.memoryId)!;
    const r = await runAdversary(record.consolidator, cand, client);
    costUsd += r.costUsd;
    record.adversary = r.response;
  }

  // Step 3: Judge on contested only
  let contested = 0;
  let judged = 0;
  for (const record of allProposals) {
    if (record.adversary === null) continue;
    if (record.adversary.adversaryConfidence <= JUDGE_THRESHOLD) continue;
    contested += 1;
    if (costUsd >= maxRunUsd) throw new CostCapExceededError(costUsd, maxRunUsd);
    const cand = candidateById.get(record.memoryId)!;
    const r = await runJudge(record.consolidator, record.adversary.objection, cand, client);
    costUsd += r.costUsd;
    record.judge = r.verdict;
    record.finalAction = r.verdict.finalAction;
    judged += 1;
  }

  return {
    proposals: allProposals,
    costUsd,
    proposalsGenerated: allProposals.length,
    proposalsContested: contested,
    proposalsJudged: judged,
    parseFailures,
  };
}
```

- [ ] **Step 4: Verify tests pass**

Run: `pnpm test cleanup-debate`
Expected: PASS — 5 tests pass

- [ ] **Step 5: Commit**

```bash
git -C .worktree/phase-09-nightly-cleanup-debate add \
  lib/cleanup/debate.ts \
  tests/cleanup-debate.test.ts
git -C .worktree/phase-09-nightly-cleanup-debate commit -m "phase 09: debate orchestration (C→A→J + cost-cap + dispatch logic)"
```

---

### Task 11: Inngest event + client wiring

**Files:**
- Modify: `lib/inngest/events.ts`
- Modify: `lib/inngest/client.ts`

- [ ] **Step 1: Add CLEANUP_REQUESTED event to events.ts**

Append to `lib/inngest/events.ts` (add the import line if `z` isn't already imported — it is):

```ts
// at the top of the existing events.ts, leave existing exports in place,
// then ADD:
export const CLEANUP_REQUESTED = 'auto-ride/cleanup.requested' as const;

export const cleanupRequestedSchema = z.object({
  /** Optional human-readable reason for audit; default "manual". */
  reason: z.string().default('manual'),
});

export type CleanupRequestedData = z.infer<typeof cleanupRequestedSchema>;
```

- [ ] **Step 2: Register the event in client.ts**

Edit `lib/inngest/client.ts`. Replace the `AutoRideEvents` type and the import line:

```ts
import { EventSchemas, Inngest } from 'inngest';
import type {
  ApprovalDecidedData,
  CleanupRequestedData,
  TaskStartedData,
} from './events';
import { APPROVAL_DECIDED, CLEANUP_REQUESTED, TASK_STARTED } from './events';

type AutoRideEvents = {
  [TASK_STARTED]: { data: TaskStartedData };
  [APPROVAL_DECIDED]: { data: ApprovalDecidedData };
  [CLEANUP_REQUESTED]: { data: CleanupRequestedData };
};

// rest of the file is unchanged
```

- [ ] **Step 3: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: PASS — no new errors.

- [ ] **Step 4: Commit**

```bash
git -C .worktree/phase-09-nightly-cleanup-debate add \
  lib/inngest/events.ts \
  lib/inngest/client.ts
git -C .worktree/phase-09-nightly-cleanup-debate commit -m "phase 09: Inngest event auto-ride/cleanup.requested + client registration"
```

---

### Task 12: memoryCleanupFn — the Inngest function

**Files:**
- Modify: `lib/inngest/functions.ts`
- Modify: `app/api/inngest/route.ts`

This is the assembly task that wires steps 0–8 from spec §1. We bundle multiple commits inside a single TDD-style task because most of the function body is integration code over already-tested pieces (Tasks 5, 6, 10) — there is little useful unit logic to TDD here. We rely on the smoke run in Task 15 for integration verification.

- [ ] **Step 1: Append memoryCleanupFn to lib/inngest/functions.ts**

**Merge** the following imports into the existing import block at the top of the file (the existing line `import { inngest } from './client';` and `import { TASK_STARTED } from './events';` stay; **add** `CLEANUP_REQUESTED` to the existing `from './events'` import). Then **append** the new `memoryCleanupFn` export at the bottom of the file. **Do NOT remove** `taskStartedFn`.

Imports to merge:

```ts
import Anthropic from '@anthropic-ai/sdk';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { memoryCleanupRuns, memoryCleanupProposals } from '@/db/schema/cleanup';
import { selectCleanupCandidates } from '@/db/queries/cleanup-candidates';
import { applyVerdicts, type Verdict } from '@/db/queries/cleanup-apply';
import { expireTombstones } from '@/db/queries/memory-lifecycle';
import { runDebate } from '@/lib/cleanup/debate';
import { CostCapExceededError } from '@/lib/cleanup/errors';
import { MAX_RUN_USD } from '@/lib/cleanup/cost-tracker';
// CLEANUP_REQUESTED is added to the existing './events' import line, not a new import.

const STALE_RUN_HOURS = 1;

/**
 * Phase-09 nightly cleanup. Two triggers fan into one body:
 *   - cron `0 3 * * *` (UTC) — production schedule (dormant pre-phase-12)
 *   - event auto-ride/cleanup.requested — manual / CLI trigger
 *
 * 8 step.run boundaries; each model call's cost is returned in the step
 * output so Inngest replay reconstructs the running total deterministically.
 *
 * Cron trigger skips silently if a successful run already exists today.
 * Manual trigger always proceeds.
 */
export const memoryCleanupFn = inngest.createFunction(
  {
    id: 'memory-cleanup',
    name: 'Memory cleanup — nightly debate',
    concurrency: { limit: 1 },
  },
  [
    { cron: '0 3 * * *' },
    { event: CLEANUP_REQUESTED },
  ],
  async ({ event, step, logger }) => {
    // Step 0: env-flag kill switch (outside step.run — pure check, idempotent)
    if (process.env.MEMORY_CLEANUP_CRON_ENABLED === 'false') {
      logger.info('[cleanup] disabled by MEMORY_CLEANUP_CRON_ENABLED=false');
      return { skipped: true, reason: 'env-flag' as const };
    }

    // Same-day idempotency: cron skips on duplicate; manual proceeds.
    const triggeredByCron = event === undefined || event.name !== CLEANUP_REQUESTED;
    if (triggeredByCron) {
      const dupe = await step.run('check-same-day-completed', async () => {
        const result = (await db.execute(sql`
          SELECT 1 AS hit FROM memory_cleanup_runs
          WHERE started_at >= date_trunc('day', now())
            AND status = 'completed'
          LIMIT 1
        `)) as unknown as { rows: Array<{ hit: number }> };
        return result.rows.length > 0;
      });
      if (dupe) {
        logger.info('[cleanup] cron skipped — already completed today');
        return { skipped: true, reason: 'already-ran-today' as const };
      }
    }

    // Stale-run finalizer: flip stuck rows so dashboards stay sane.
    await step.run('stale-finalizer', async () => {
      await db.execute(sql`
        UPDATE memory_cleanup_runs
        SET status = 'failed',
            completed_at = now(),
            error = 'stale (no closeRun within ' || ${STALE_RUN_HOURS} || 'h)'
        WHERE status = 'running'
          AND started_at < now() - (${STALE_RUN_HOURS} * interval '1 hour')
      `);
    });

    // Step 1: open run row
    const runId = await step.run('open-run', async () => {
      const [row] = await db
        .insert(memoryCleanupRuns)
        .values({ status: 'running' })
        .returning({ id: memoryCleanupRuns.id });
      return row!.id;
    });

    // Step 2: candidate selection
    const candidates = await step.run('select-candidates', async () => {
      return selectCleanupCandidates({ pruneLimit: 50, mergeLimit: 50 });
    });

    if (candidates.length === 0) {
      await step.run('close-run-empty', async () => {
        await db
          .update(memoryCleanupRuns)
          .set({
            status: 'completed',
            completedAt: new Date(),
            candidatesConsidered: 0,
          })
          .where(eqCleanupRunId(runId));
      });
      await step.run('expire-tombstones', async () => expireTombstones());
      return { runId, candidates: 0, applied: 0 };
    }

    // Steps 3–5: debate (Consolidator → Adversary → Judge)
    let debateResult;
    try {
      debateResult = await step.run('debate', async () => {
        const client = new Anthropic();
        return runDebate({ candidates, client, maxRunUsd: MAX_RUN_USD });
      });
    } catch (err) {
      const message = err instanceof CostCapExceededError ? err.message : String(err);
      await step.run('close-run-failed', async () => {
        await db
          .update(memoryCleanupRuns)
          .set({
            status: 'failed',
            completedAt: new Date(),
            error: message,
            candidatesConsidered: candidates.length,
          })
          .where(eqCleanupRunId(runId));
      });
      throw err;
    }

    // Persist proposals before apply (so audit trail exists even if apply crashes)
    await step.run('persist-proposals', async () => {
      if (debateResult.proposals.length === 0) return;
      await db.insert(memoryCleanupProposals).values(
        debateResult.proposals.map((p) => ({
          runId,
          memoryId: p.memoryId,
          targetMemoryId: p.targetMemoryId,
          action: p.consolidator.action,
          finalAction: p.finalAction,
          consolidator: p.consolidator,
          adversary: p.adversary,
          judge: p.judge,
        })),
      );
    });

    // Step 6: apply verdicts (re-fetch proposalIds from DB so we have the row UUIDs)
    const applyResult = await step.run('apply-verdicts', async () => {
      const inserted = await db
        .select({
          id: memoryCleanupProposals.id,
          memoryId: memoryCleanupProposals.memoryId,
          targetMemoryId: memoryCleanupProposals.targetMemoryId,
          finalAction: memoryCleanupProposals.finalAction,
        })
        .from(memoryCleanupProposals)
        .where(sql`${memoryCleanupProposals.runId} = ${runId}::uuid`);

      const verdicts: Verdict[] = inserted
        .filter((r) => r.finalAction !== null)
        .map((r) => ({
          proposalId: r.id,
          memoryId: r.memoryId,
          targetMemoryId: r.targetMemoryId,
          finalAction: r.finalAction!,
        }));
      return applyVerdicts(verdicts);
    });

    // Step 7: expire tombstones older than 14 days (reuse phase 04 helper)
    await step.run('expire-tombstones', async () => expireTombstones());

    // Step 8: close run
    await step.run('close-run', async () => {
      await db
        .update(memoryCleanupRuns)
        .set({
          status: 'completed',
          completedAt: new Date(),
          candidatesConsidered: candidates.length,
          proposalsGenerated: debateResult.proposalsGenerated,
          proposalsContested: debateResult.proposalsContested,
          proposalsJudged: debateResult.proposalsJudged,
          costUsd: String(debateResult.costUsd.toFixed(4)),
        })
        .where(eqCleanupRunId(runId));
    });

    return {
      runId,
      candidates: candidates.length,
      proposalsGenerated: debateResult.proposalsGenerated,
      applied: applyResult.applied,
      costUsd: debateResult.costUsd,
    };
  },
);

function eqCleanupRunId(id: string) {
  return sql`${memoryCleanupRuns.id} = ${id}::uuid`;
}
```

- [ ] **Step 2: Register memoryCleanupFn at the Inngest serve route**

Edit `app/api/inngest/route.ts`:

```ts
import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { memoryCleanupFn, taskStartedFn } from '@/lib/inngest/functions';

export const dynamic = 'force-dynamic';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [taskStartedFn, memoryCleanupFn],
});
```

- [ ] **Step 3: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: PASS — no new errors.

- [ ] **Step 4: Commit**

```bash
git -C .worktree/phase-09-nightly-cleanup-debate add \
  lib/inngest/functions.ts \
  app/api/inngest/route.ts
git -C .worktree/phase-09-nightly-cleanup-debate commit -m "phase 09: memoryCleanupFn (cron + event triggers, 8-step pipeline, env-flag guard)"
```

---

### Task 13: CLI script for manual trigger

**Files:**
- Create: `scripts/cleanup-run-once.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the CLI script**

```ts
// scripts/cleanup-run-once.ts
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
```

- [ ] **Step 2: Add script entry to package.json**

Find the `"scripts"` block in `package.json` and add (preserve all existing entries):

```json
"cleanup:run-once": "tsx --env-file=.env.local scripts/cleanup-run-once.ts",
```

- [ ] **Step 3: Verify the script can be invoked (dry — without Inngest running, it'll error on send, but the file should compile)**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git -C .worktree/phase-09-nightly-cleanup-debate add \
  scripts/cleanup-run-once.ts \
  package.json
git -C .worktree/phase-09-nightly-cleanup-debate commit -m "phase 09: pnpm cleanup:run-once CLI for manual cleanup trigger"
```

---

### Task 14: Env example + README

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Add the env var to .env.example**

Append to `.env.example`:

```bash

# --- Phase 09: nightly cleanup ---
# Set to 'false' to disable the cleanup cron without redeploying.
# Manual trigger via `pnpm cleanup:run-once` always works regardless.
MEMORY_CLEANUP_CRON_ENABLED=true
```

- [ ] **Step 2: Add a phase 09 section to README.md**

Append to `README.md` (place it under existing phase sections, after phase 08):

```markdown
## Phase 09 — Nightly cleanup debate

Adds a three-agent debate (Consolidator Sonnet 4.6 → Adversary Haiku 4.5 →
Judge Opus 4.6 only on contested confidence > 0.7) that governs **prune** and
**merge** actions over the memory store. Promotions remain on phase 04's
deterministic streak path.

### Demo (local)

In three terminals:

```bash
# 1. Next.js (port 3100 — never use 3000)
pnpm dev -p 3100

# 2. Inngest dev broker
pnpm inngest:dev

# 3. Trigger one cleanup run
pnpm cleanup:run-once
```

Watch the Inngest dev UI at <http://localhost:8288> for the live function
trace. Inspect results in Postgres:

```sql
SELECT * FROM memory_cleanup_runs ORDER BY started_at DESC LIMIT 5;
SELECT memory_id, action, final_action, applied_at
FROM memory_cleanup_proposals ORDER BY created_at DESC LIMIT 20;
```

### Kill switch

`MEMORY_CLEANUP_CRON_ENABLED=false` in `.env.local` → restart Next.js → the
cron handler returns `{ skipped: true, reason: 'env-flag' }` immediately.
```

- [ ] **Step 3: Commit**

```bash
git -C .worktree/phase-09-nightly-cleanup-debate add .env.example README.md
git -C .worktree/phase-09-nightly-cleanup-debate commit -m "phase 09: env var + README demo section"
```

---

### Task 15: Smoke run + final verification

**Files:** none modified — this is a verification task.

- [ ] **Step 1: Confirm test suite green**

Run: `pnpm test`
Expected: PASS — all phase 09 tests + no regressions in phases 01–08.

- [ ] **Step 2: Confirm typecheck**

Run: `pnpm typecheck`
Expected: PASS — no errors.

- [ ] **Step 3: Confirm build**

Run: `pnpm build`
Expected: PASS — Next.js production build succeeds.

- [ ] **Step 4: Confirm `.env.local` has `MEMORY_CLEANUP_CRON_ENABLED=true`**

If the env var isn't set in `.env.local`, ask the user to add it (per the project's "ask when env is missing" rule). The handler reads `process.env.MEMORY_CLEANUP_CRON_ENABLED` so anything other than the literal string `"false"` lets the cleanup proceed.

- [ ] **Step 5: Manual smoke run**

Open three terminals (the user runs these — Claude doesn't need to start the dev servers itself):

Terminal 1:
```bash
pnpm dev -p 3100
```

Terminal 2:
```bash
pnpm inngest:dev
```

Terminal 3 — first seed at least one prune candidate and one merge pair:
```bash
pnpm memory:demo                    # creates the standard phase-04 fixture set
pnpm cleanup:run-once
```

Verify in the Inngest dev UI at <http://localhost:8288>:
- The `memory-cleanup` function appears in the run list.
- All 8 steps complete (env-check skipped, stale-finalizer, open-run, select-candidates, debate, persist-proposals, apply-verdicts, expire-tombstones, close-run).
- The function returns a JSON result with `runId`, `candidates`, `proposalsGenerated`, `applied`, `costUsd`.

Then verify in Postgres (e.g. via `pnpm db:studio` or psql):
```sql
SELECT id, status, candidates_considered, proposals_generated,
       proposals_contested, proposals_judged, cost_usd, error
FROM memory_cleanup_runs
ORDER BY started_at DESC LIMIT 1;

SELECT memory_id, action, final_action, applied_at,
       consolidator->>'reasoning' AS consolidator_reason,
       adversary->>'adversaryConfidence' AS adv_conf,
       judge IS NOT NULL AS judge_fired
FROM memory_cleanup_proposals
WHERE run_id = (SELECT id FROM memory_cleanup_runs ORDER BY started_at DESC LIMIT 1);
```

- [ ] **Step 6: Verify env-flag kill switch**

Set `MEMORY_CLEANUP_CRON_ENABLED=false` in `.env.local`, restart Next.js (terminal 1), run `pnpm cleanup:run-once` again, and confirm the function returns `{ skipped: true, reason: 'env-flag' }` with no new `memory_cleanup_runs` row.

Restore to `true` after the verification.

- [ ] **Step 7: Open the PR**

Use `/finish-phase 09` if available, or manually:
```bash
gh pr create \
  --base main \
  --head phase/09-nightly-cleanup-debate \
  --title "phase 09: nightly cleanup debate" \
  --body "$(cat <<'EOF'
## Summary

Ships the three-agent overnight debate (Consolidator Sonnet 4.6 → Adversary
Haiku 4.5 → Judge Opus 4.6 only on contested > 0.7) over prune + merge
candidates. Promotions remain on phase 04's deterministic streak path.

Wired to two Inngest triggers — a daily 03:00 UTC cron (dormant until phase
12 deploys) and `auto-ride/cleanup.requested` for manual / CLI demos via
`pnpm cleanup:run-once`. Env-flag kill switch via
`MEMORY_CLEANUP_CRON_ENABLED=false` works without redeploy.

Plan reference: `auto-ride-initial-plan.md` §5.
Design spec: `docs/superpowers/specs/2026-04-26-phase-09-nightly-cleanup-debate-design.md`.
Implementation plan: `docs/superpowers/plans/2026-04-26-phase-09-nightly-cleanup-debate-plan.md`.

## Test plan

- [ ] `pnpm test` green (incl. all phase 09 layers)
- [ ] `pnpm typecheck` green
- [ ] `pnpm build` green
- [ ] Manual smoke run produces a `memory_cleanup_runs` row with `status='completed'` and ≥1 prune verdict applied
- [ ] Env flag set to `false` skips the run as `{ skipped: true, reason: 'env-flag' }`
EOF
)"
```

---

## Self-review

### Spec coverage

| Spec section | Implementing task |
|---|---|
| §1 Architecture | Tasks 11, 12 |
| §2 Candidate selection SQL | Task 5 |
| §3 Debate (Consolidator/Adversary/Judge) | Tasks 7, 8, 9, 10 |
| §4 Apply step (prune, merge, keep, ordering) | Task 6 |
| §5 Failure modes (idempotency, replay, JSON fallbacks) | Tasks 2 (fallbacks), 12 (idempotency + stale finalizer + replay safety) |
| §6 Kill switch + dormancy | Task 12 (env flag), Task 14 (README documentation) |
| §7 Observability | Task 12 (run/proposal columns populated) — anti-sycophancy SQL is doc-only per spec |
| §8 Testing — Layer 1 (SQL) | Task 5 |
| §8 Testing — Layer 2 (mocked LLM) | Tasks 1, 2, 10 |
| §8 Testing — Layer 3 (real DB writes) | Task 6 |
| §9 File layout | All tasks (file paths match) |
| §10 Risks (sycophancy, dormancy, cost-cap precision, vestigial check) | Spec-only — no code changes; surfaced for reviewer |
| §11 Acceptance criteria (10 items) | Task 15 (smoke run + PR opening) |

### Placeholder scan

No "TBD", "TODO", "implement later". All code blocks are complete and self-contained. Every test asserts a specific behavior.

### Type consistency

- `Verdict` (Task 6) ↔ `DebateProposalRecord` (Task 10) — both use `'prune' | 'merge' | 'keep'` for the action via the shared `Action` type from `lib/cleanup/schemas.ts`.
- `CandidateRow` (Task 4 prompts.ts) ↔ `CleanupCandidate` (Task 5 candidates.ts) — these are intentionally separate types with the same shape; the candidates module returns `CleanupCandidate`, the prompts module accepts `CandidateRow` (structurally identical at runtime, kept separate so the prompt module doesn't depend on `db/`). Task 12's debate-step closure passes the `CleanupCandidate[]` directly into `runDebate({ candidates, ... })` — this works because TypeScript structural typing accepts the wider type.
- `ROLE_MODEL` constants (Task 1) → used by Tasks 7, 8, 9, 10 — single source of truth.
- `MAX_RUN_USD` constant (Task 1) → used by Task 12 only.
- `JUDGE_THRESHOLD` constant (Task 10) → used by Task 10's tests only; the threshold lives next to the dispatch logic.

### Notes on test infra

The Layer 1 + Layer 3 tests use the same `DATABASE_URL_UNPOOLED ? describe : describe.skip` pattern phase 03 established. They run against the real Neon DB; if the env var is unset (e.g. CI without DB credentials), they skip cleanly without failing. The Layer 2 debate tests have no DB dependency and always run.

---

## Execution Handoff

Plan complete and saved to `.worktree/phase-09-nightly-cleanup-debate/docs/superpowers/plans/2026-04-26-phase-09-nightly-cleanup-debate-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best when you want me to keep moving without batching context.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints. Best when you want to watch each task land in real time and intervene mid-step.

Which approach?
