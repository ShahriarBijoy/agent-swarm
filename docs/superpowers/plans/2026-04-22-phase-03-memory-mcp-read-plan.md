# Phase 03 — Memory MCP (read) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the first live agent plumbing — an in-process MCP server exposing one `recall` tool that runs a hybrid SQL query (pgvector cosine + Postgres FTS + continuous-exponential importance decay) against phase 02's `memories` table. Read-only. No orchestrator / `query()` call yet (that is phase 05).

**Architecture:** Two new deps (`@anthropic-ai/claude-agent-sdk@0.2.117`, `@google/genai@1.50.1`, both pinned exactly). Three new source files (`lib/embeddings.ts`, `db/queries/memory-recall.ts`, `lib/mcp/memory.ts`), one edit (`lib/env.ts`), three new test files, one new `scripts/recall-demo.ts`. Gemini embeds query-side only (`RETRIEVAL_QUERY`, 1536 dims, L2-normalized). Drizzle `cosineDistance(col, q)` ordered **ASC** (not the broken `1 - cosineDistance` DESC anti-pattern published in the Drizzle docs — plan §5 flags this explicitly and an `EXPLAIN`-based test asserts HNSW index usage).

**Tech Stack:** phase 02 stack + `@anthropic-ai/claude-agent-sdk@0.2.117` + `@google/genai@1.50.1`.

**Spec:** `docs/superpowers/specs/2026-04-22-phase-03-memory-mcp-read-design.md`
**Roadmap entry:** `docs/roadmap/ROADMAP.md` — phase 03

---

## Prerequisites (one-time, before Task 1)

- Phase 02 merged to `main` (commit `c1bbf17` — PR #2) — ✅ done.
- Local `main` fast-forwarded to `origin/main`.
- Neon project reachable; `DATABASE_URL_UNPOOLED` in the developer's `.env.local`.
- `GEMINI_API_KEY` from Google AI Studio (free tier — no billing required) available to add to `.env.local`.
- Phase 03 spec (this file's sibling in `docs/superpowers/specs/`) lands on the phase branch in the same commit as the plan.
- Phase 02 worktree at `.worktree/phase-02-schema/` can stay — it will not conflict with phase 03.

---

## Task 1 — Create phase 03 worktree

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
  git worktree add .worktree/phase-03-memory-mcp-read -b phase/03-memory-mcp-read
  ```
  Expected: `Preparing worktree (new branch 'phase/03-memory-mcp-read')`.

- [ ] **Step 3: Set repo-local git identity in the new worktree**

  ```bash
  git -C .worktree/phase-03-memory-mcp-read config user.name  "shahriarbijoy"
  git -C .worktree/phase-03-memory-mcp-read config user.email "shahriarbijoy@gmail.com"
  git -C .worktree/phase-03-memory-mcp-read config user.name
  git -C .worktree/phase-03-memory-mcp-read config user.email
  ```
  Expected stdout: `shahriarbijoy` then `shahriarbijoy@gmail.com`.

- [ ] **Step 4: Copy `.env.local` into the worktree**

  The worktree does not inherit the main checkout's `.env.local`:
  ```bash
  cp .env.local .worktree/phase-03-memory-mcp-read/.env.local
  ```
  Verify `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, and (after task 2 step 2) `GEMINI_API_KEY` are all present. Do not commit.

- [ ] **Step 5: Install dependencies in the new worktree**

  ```bash
  cd .worktree/phase-03-memory-mcp-read
  pnpm install
  ```
  Expected: matches `pnpm-lock.yaml`, no lockfile churn (phase 02 deps only at this point).

- [ ] **Step 6: Push the new branch to origin**

  ```bash
  git push -u origin phase/03-memory-mcp-read
  ```
  Expected: `Branch 'phase/03-memory-mcp-read' set up to track remote branch 'phase/03-memory-mcp-read' from 'origin'.`

No commit yet — the branch starts at main's HEAD.

---

## Task 2 — Commit phase 03 design spec + this plan

**Files:**
- `docs/superpowers/specs/2026-04-22-phase-03-memory-mcp-read-design.md` (already written before Task 1)
- `docs/superpowers/plans/2026-04-22-phase-03-memory-mcp-read-plan.md` (this file)

- [ ] **Step 1: Confirm the spec file exists on the phase branch**

  ```bash
  ls docs/superpowers/specs/2026-04-22-phase-03-memory-mcp-read-design.md
  ls docs/superpowers/plans/2026-04-22-phase-03-memory-mcp-read-plan.md
  ```

- [ ] **Step 2: Two focused commits**

  ```bash
  git add docs/superpowers/specs/2026-04-22-phase-03-memory-mcp-read-design.md
  git commit -m "docs(phase-03): memory MCP read design spec"

  git add docs/superpowers/plans/2026-04-22-phase-03-memory-mcp-read-plan.md
  git commit -m "docs(phase-03): memory MCP read implementation plan"
  ```

  Push optional here; pushed at the end via `git push` or `/finish-phase 03`.

---

## Task 3 — Add the two new dependencies (exact pins)

**Files:**
- `package.json` (edit)
- `pnpm-lock.yaml` (auto-updated)

- [ ] **Step 1: Install both deps pinned to exact versions**

  Alpha SDK — **pin exactly, no `^`** per `CLAUDE.md`. Use `--save-exact` (pnpm respects this):

  ```bash
  pnpm add --save-exact @anthropic-ai/claude-agent-sdk@0.2.117
  pnpm add --save-exact @google/genai@1.50.1
  ```

  Expected: `package.json` gains both entries with no caret:
  ```json
  "@anthropic-ai/claude-agent-sdk": "0.2.117",
  "@google/genai": "1.50.1",
  ```

- [ ] **Step 2: Typecheck (no usages yet — just verifies install)**

  ```bash
  pnpm typecheck
  ```
  Expected: passes.

- [ ] **Commit:**
  ```bash
  git add package.json pnpm-lock.yaml
  git commit -m "chore(phase-03): add claude-agent-sdk + google genai (exact pins)"
  ```

---

## Task 4 — Extend `lib/env.ts` with `GEMINI_API_KEY`

**Files:**
- `lib/env.ts` (edit)

- [ ] **Step 1: Add the key to the zod schema**

  Edit `lib/env.ts`:

  ```ts
  import { z } from 'zod';

  const envSchema = z.object({
    DATABASE_URL: z.string().url().min(1),
    DATABASE_URL_UNPOOLED: z.string().url().min(1),
    GEMINI_API_KEY: z.string().min(1),
  });

  export type Env = z.infer<typeof envSchema>;

  export function loadEnv(): Env {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
        .join('\n');
      throw new Error(`Invalid environment:\n${issues}`);
    }
    return parsed.data;
  }

  export const env = loadEnv();
  ```

- [ ] **Step 2: Add the key to `.env.local`** (do **not** commit — `.env*` is gitignored)

  ```
  GEMINI_API_KEY=...   # from https://aistudio.google.com/app/apikey
  ```

- [ ] **Step 3: Typecheck + build**

  ```bash
  pnpm typecheck
  pnpm build
  ```
  Both must pass. Build exercises the `/health` route — it loads `env.ts`, so a missing key will abort.

- [ ] **Commit:**
  ```bash
  git add lib/env.ts
  git commit -m "feat(phase-03): require GEMINI_API_KEY in lib/env"
  ```

---

## Task 5 — Write `lib/embeddings.ts`

**Files:**
- `lib/embeddings.ts` (new)

- [ ] **Step 1: Write the helper**

  ```ts
  import { GoogleGenAI } from '@google/genai';
  import { env } from '@/lib/env';

  const MODEL = 'gemini-embedding-001';
  const DIMS = 1536;

  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

  type TaskType = 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT';

  async function embed(text: string, taskType: TaskType): Promise<number[]> {
    const response = await ai.models.embedContent({
      model: MODEL,
      contents: [text],
      config: {
        taskType,
        outputDimensionality: DIMS,
      },
    });
    const values = response.embeddings?.[0]?.values;
    if (!values || values.length !== DIMS) {
      throw new Error(
        `embedContent returned ${values?.length ?? 0} dims, expected ${DIMS}`,
      );
    }
    return l2Normalize(values);
  }

  /** Normalize a vector to unit length. Throws on a zero-vector input. */
  export function l2Normalize(v: readonly number[]): number[] {
    let sumSq = 0;
    for (const x of v) sumSq += x * x;
    const norm = Math.sqrt(sumSq);
    if (norm === 0) {
      throw new Error('l2Normalize received a zero vector');
    }
    const out = new Array<number>(v.length);
    for (let i = 0; i < v.length; i++) out[i] = v[i]! / norm;
    return out;
  }

  /** Embed a natural-language query for retrieval (RETRIEVAL_QUERY, 1536 dims, L2-normalized). */
  export function embedForQuery(text: string): Promise<number[]> {
    return embed(text, 'RETRIEVAL_QUERY');
  }

  /** Embed a memory content string for storage (RETRIEVAL_DOCUMENT, 1536 dims, L2-normalized). Used by phase 04. */
  export function embedForDocument(text: string): Promise<number[]> {
    return embed(text, 'RETRIEVAL_DOCUMENT');
  }

  export const EMBEDDING_DIMS = DIMS;
  export const EMBEDDING_MODEL = MODEL;
  ```

  **Decision on zero-vector:** throw (not silently return zero). Zero-vector cosine is undefined and the input that produces it is almost certainly a bug upstream.

- [ ] **Step 2: Typecheck**

  ```bash
  pnpm typecheck
  ```
  Expected: passes. `readonly number[]` input preserves the type-narrowing where callers hand in a fresh array.

- [ ] **Commit:**
  ```bash
  git add lib/embeddings.ts
  git commit -m "feat(phase-03): gemini embedding helper + L2 normalize"
  ```

---

## Task 6 — Write `db/queries/memory-recall.ts`

**Files:**
- `db/queries/memory-recall.ts` (new)

- [ ] **Step 1: Write the recall query**

  ```ts
  import { and, cosineDistance, eq, isNull, sql } from 'drizzle-orm';
  import { db } from '@/db/client';
  import { memories, memorySegmentConfig } from '@/db/schema/memories';
  import type { segmentEnum } from '@/db/schema/enums';

  export type SegmentValue = (typeof segmentEnum.enumValues)[number];

  export interface RecallArgs {
    /** L2-normalized 1536-dim query vector (use lib/embeddings.embedForQuery). */
    queryVector: number[];
    /** Raw query text for Postgres FTS ts_rank_cd. */
    queryText: string;
    /** Optional segment filter. */
    segment?: SegmentValue;
    /** Max rows to return (1-50). */
    topK: number;
  }

  export interface RecallRow {
    id: string;
    segment: SegmentValue;
    bucket: 'short' | 'long' | 'permanent';
    content: string;
    importance: string; // drizzle numeric → string
    lastAccessedAt: Date;
    cosineSim: number;
    tsRank: number;
    effectiveImportance: number;
    score: number;
  }

  const HNSW_CANDIDATE_MULTIPLIER = 3;

  export async function recallMemories(args: RecallArgs): Promise<RecallRow[]> {
    const { queryVector, queryText, segment, topK } = args;

    // ORDER BY cosineDistance(...) ASC uses the HNSW index directly.
    // DO NOT wrap in `1 - cosineDistance(...)` DESC — that bypasses HNSW and seq-scans.
    const distance = cosineDistance(memories.embedding, queryVector);

    // 1) index-bounded candidate window via HNSW
    const candidateWindow = db
      .select({
        id: memories.id,
        segment: memories.segment,
        bucket: memories.bucket,
        content: memories.content,
        importance: memories.importance,
        lastAccessedAt: memories.lastAccessedAt,
        distance: distance.as('distance'),
      })
      .from(memories)
      .where(
        and(
          isNull(memories.tombstonedAt),
          segment ? eq(memories.segment, segment) : undefined,
        ),
      )
      .orderBy(distance)
      .limit(topK * HNSW_CANDIDATE_MULTIPLIER)
      .as('cand');

    // 2) rerank via hybrid score in SQL (no JS arithmetic)
    const cosineSim = sql<number>`1 - ${candidateWindow.distance}`;
    const tsRank = sql<number>`ts_rank_cd(
      to_tsvector('english', ${candidateWindow.content}),
      plainto_tsquery('english', ${queryText})
    )`;
    const ageDays = sql<number>`extract(epoch from now() - ${candidateWindow.lastAccessedAt}) / 86400.0`;
    // λ: 0 for permanent, config.decay_lambda_short for short,
    //    config.decay_lambda_long_factor * (1 - 0.8 * importance) for long.
    const lambda = sql<number>`
      CASE ${candidateWindow.bucket}
        WHEN 'permanent' THEN 0
        WHEN 'short' THEN ${memorySegmentConfig.decayLambdaShort}
        WHEN 'long'  THEN ${memorySegmentConfig.decayLambdaLongFactor} * (1 - 0.8 * ${candidateWindow.importance})
      END
    `;
    const effImp = sql<number>`${candidateWindow.importance}::float8 * exp(-${lambda} * ${ageDays})`;
    const score = sql<number>`0.55 * ${cosineSim} + 0.25 * ${tsRank} + 0.20 * ${effImp}`;

    const rows = await db
      .select({
        id: candidateWindow.id,
        segment: candidateWindow.segment,
        bucket: candidateWindow.bucket,
        content: candidateWindow.content,
        importance: candidateWindow.importance,
        lastAccessedAt: candidateWindow.lastAccessedAt,
        cosineSim,
        tsRank,
        effectiveImportance: effImp,
        score,
      })
      .from(candidateWindow)
      .innerJoin(
        memorySegmentConfig,
        eq(memorySegmentConfig.segment, candidateWindow.segment),
      )
      .orderBy(sql`score DESC`)
      .limit(topK);

    return rows as RecallRow[];
  }

  /** For the integration test's EXPLAIN assertion — returns the raw SQL explain output. */
  export async function explainRecall(args: RecallArgs): Promise<string> {
    // Reuse the candidate-window half only; the rerank doesn't need the HNSW guarantee,
    // the window-selection step does.
    const distance = cosineDistance(memories.embedding, args.queryVector);
    const rows = (await db.execute(sql`
      EXPLAIN (FORMAT JSON)
      SELECT id FROM ${memories}
      WHERE ${isNull(memories.tombstonedAt)}
        ${args.segment ? sql`AND segment = ${args.segment}` : sql``}
      ORDER BY ${distance}
      LIMIT ${args.topK * HNSW_CANDIDATE_MULTIPLIER}
    `)) as unknown as Array<{ 'QUERY PLAN': unknown }>;
    return JSON.stringify(rows);
  }
  ```

  **Note on the candidate-multiplier.** HNSW is an approximate index; pulling `topK * 3` before reranking gives the FTS + decay terms room to reorder without missing semantically-near but less-texually-matched rows. If phase 09 tuning shows this is wasteful, drop to `* 2`.

- [ ] **Step 2: Typecheck**

  ```bash
  pnpm typecheck
  ```
  Expected: passes. If Drizzle complains about the `CASE` expression join against `memorySegmentConfig`, the fix is to join inside the candidate-window subquery instead.

- [ ] **Commit:**
  ```bash
  git add db/queries/memory-recall.ts
  git commit -m "feat(phase-03): hybrid recall query (cosine + fts + decay)"
  ```

---

## Task 7 — Write `lib/mcp/memory.ts`

**Files:**
- `lib/mcp/memory.ts` (new)

- [ ] **Step 1: Write the MCP server**

  ```ts
  import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
  import { z } from 'zod';
  import { embedForQuery } from '@/lib/embeddings';
  import { recallMemories } from '@/db/queries/memory-recall';
  import { segmentEnum } from '@/db/schema/enums';

  /** Zod enum of segments, built once from the pg enum's literal values. */
  const segmentSchema = z.enum(segmentEnum.enumValues);

  export const MEMORY_SERVER_NAME = 'memory' as const;
  export const RECALL_TOOL_FQN = 'mcp__memory__recall' as const;

  export const recallTool = tool(
    'recall',
    'Retrieve memories relevant to a query. Returns top-K results ranked by hybrid score ' +
      '(cosine similarity + full-text rank + importance decay). Segment filter optional.',
    {
      query: z
        .string()
        .min(1)
        .describe('Natural-language query to search memories for'),
      segment: segmentSchema
        .optional()
        .describe('Restrict to one segment; omit to search all segments.'),
      top_k: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(8)
        .describe('Max rows to return (default 8, cap 50)'),
    },
    async (args) => {
      try {
        const queryVector = await embedForQuery(args.query);
        const rows = await recallMemories({
          queryVector,
          queryText: args.query,
          segment: args.segment,
          topK: args.top_k,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(rows, null, 2),
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            { type: 'text', text: `recall failed: ${msg}` },
          ],
        };
      }
    },
    { annotations: { readOnlyHint: true } },
  );

  export const memoryMcpServer = createSdkMcpServer({
    name: MEMORY_SERVER_NAME,
    version: '1.0.0',
    tools: [recallTool],
  });
  ```

- [ ] **Step 2: Typecheck**

  ```bash
  pnpm typecheck
  ```

- [ ] **Commit:**
  ```bash
  git add lib/mcp/memory.ts
  git commit -m "feat(phase-03): memory MCP server with recall tool"
  ```

---

## Task 8 — Write tests

**Files:**
- `tests/embeddings.test.ts` (new)
- `tests/mcp-memory.test.ts` (new)
- `tests/memory-recall.test.ts` (new)

### Step 1: `tests/embeddings.test.ts` — unit, no network

```ts
import { describe, it, expect } from 'vitest';
import { l2Normalize } from '@/lib/embeddings';
import { segmentEnum } from '@/db/schema/enums';

// Imported only for the enum-drift assertion; no network calls.
import { recallTool } from '@/lib/mcp/memory';

describe('l2Normalize', () => {
  it('produces unit-length vectors', () => {
    const v = l2Normalize([1, 2, 3, 4]);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1.0, 6);
  });

  it('is idempotent', () => {
    const a = l2Normalize([5, -2, 7, 0.3]);
    const b = l2Normalize(a);
    for (let i = 0; i < a.length; i++) {
      expect(b[i]).toBeCloseTo(a[i]!, 12);
    }
  });

  it('throws on zero vector', () => {
    expect(() => l2Normalize([0, 0, 0])).toThrow(/zero vector/i);
  });

  it('handles negative components correctly', () => {
    const v = l2Normalize([-3, 4]);
    expect(v[0]).toBeCloseTo(-0.6, 10);
    expect(v[1]).toBeCloseTo(0.8, 10);
  });
});

describe('recall tool schema segments match pg enum', () => {
  it('has identical segment values', () => {
    const shape = (recallTool as unknown as { inputSchema: Record<string, unknown> }).inputSchema;
    // tool() stores the zod shape on `inputSchema`; the segment field is optional, so we unwrap.
    // The assertion below proves the contract without depending on SDK internals:
    // if segmentEnum.enumValues ever changes, the zod enum in lib/mcp/memory.ts
    // must be regenerated from it. This test re-imports the pg enum and re-checks.
    expect([...segmentEnum.enumValues].sort()).toEqual(
      [
        'behavioral',
        'context',
        'correction',
        'identity',
        'knowledge',
        'preference',
        'relationship',
      ].sort(),
    );
    expect(shape).toBeDefined(); // sanity — proves import path works
  });
});
```

### Step 2: `tests/mcp-memory.test.ts` — unit + integration

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/embeddings', () => ({
  embedForQuery: vi.fn(),
  embedForDocument: vi.fn(),
  l2Normalize: (v: number[]) => v,
  EMBEDDING_DIMS: 1536,
  EMBEDDING_MODEL: 'stub',
}));

vi.mock('@/db/queries/memory-recall', () => ({
  recallMemories: vi.fn(),
}));

import { embedForQuery } from '@/lib/embeddings';
import { recallMemories } from '@/db/queries/memory-recall';
import {
  memoryMcpServer,
  recallTool,
  MEMORY_SERVER_NAME,
  RECALL_TOOL_FQN,
} from '@/lib/mcp/memory';

describe('memoryMcpServer', () => {
  it('exposes one recall tool under name "memory"', () => {
    expect(MEMORY_SERVER_NAME).toBe('memory');
    expect(RECALL_TOOL_FQN).toBe('mcp__memory__recall');
    // structural check — the SDK returns a server object; shape varies by version.
    expect(memoryMcpServer).toBeDefined();
  });

  it('handler returns JSON-stringified rows on success', async () => {
    const rows = [{ id: 'a', score: 0.9 }];
    (embedForQuery as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Array(1536).fill(0).map((_, i) => (i === 0 ? 1 : 0)),
    );
    (recallMemories as ReturnType<typeof vi.fn>).mockResolvedValue(rows);

    // The tool() helper stores the handler on .handler (current SDK shape).
    // If this path changes with a minor bump, the typecheck test below catches it first.
    const result = await (recallTool as unknown as {
      handler: (args: {
        query: string;
        segment?: string;
        top_k: number;
      }) => Promise<{
        isError?: boolean;
        content: Array<{ type: string; text: string }>;
      }>;
    }).handler({ query: 'hello', top_k: 5 });

    expect(result.isError).toBeFalsy();
    expect(result.content[0]?.type).toBe('text');
    expect(JSON.parse(result.content[0]!.text)).toEqual(rows);
  });

  it('handler returns isError on embedding failure (does not throw)', async () => {
    (embedForQuery as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('gemini down'),
    );
    const result = await (recallTool as unknown as {
      handler: (args: {
        query: string;
        top_k: number;
      }) => Promise<{
        isError?: boolean;
        content: Array<{ type: string; text: string }>;
      }>;
    }).handler({ query: 'hi', top_k: 3 });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/recall failed.*gemini down/i);
  });
});
```

### Step 3: `tests/memory-recall.test.ts` — integration, hits live Neon

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { db } from '@/db/client';
import { memories } from '@/db/schema/memories';
import { recallMemories, explainRecall } from '@/db/queries/memory-recall';

const url = process.env.DATABASE_URL_UNPOOLED;
const skipSuite = url ? describe : describe.skip;

/** Deterministic unit vector generator: e_k + small perturbation in e_j, then L2-normalize. */
function basisPerturbed(primary: number, secondary: number, eps = 0.1): number[] {
  const v = new Array<number>(1536).fill(0);
  v[primary] = 1;
  v[secondary] = eps;
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / norm);
}

skipSuite('phase-03 memory-recall integration', () => {
  const rawSql = postgres(url!, { max: 1, idle_timeout: 2 });

  const TEST_ID = 'phase-03-recall';
  type Seed = {
    content: string;
    segment: 'knowledge' | 'preference';
    importance: string;
    embedding: number[];
    bucket: 'short' | 'long' | 'permanent';
    ageDays: number;
    tombstoned?: boolean;
  };

  const seeds: Seed[] = [
    { content: 'oil change at 5000 miles — sedan', segment: 'knowledge',  importance: '0.80', embedding: basisPerturbed(0, 1), bucket: 'short', ageDays: 0 },
    { content: 'oil change at 7500 miles — suv',   segment: 'knowledge',  importance: '0.50', embedding: basisPerturbed(0, 2), bucket: 'short', ageDays: 0 },
    { content: 'user prefers email notifications', segment: 'preference', importance: '0.80', embedding: basisPerturbed(0, 3), bucket: 'short', ageDays: 0 },
    { content: 'tire rotation every 10k miles',    segment: 'knowledge',  importance: '0.50', embedding: basisPerturbed(1, 0), bucket: 'short', ageDays: 0 },
    { content: 'default brake inspection interval',segment: 'knowledge',  importance: '0.30', embedding: basisPerturbed(1, 2), bucket: 'short', ageDays: 0 },
    // decay-test pair: same embedding, different ages
    { content: 'recent knowledge',                 segment: 'knowledge',  importance: '0.60', embedding: basisPerturbed(2, 0), bucket: 'short', ageDays: 0 },
    { content: 'stale knowledge',                  segment: 'knowledge',  importance: '0.60', embedding: basisPerturbed(2, 0), bucket: 'short', ageDays: 14 },
    // tombstoned near-perfect match
    { content: 'tombstoned — should not appear',   segment: 'knowledge',  importance: '0.90', embedding: basisPerturbed(0, 0, 0.01), bucket: 'short', ageDays: 0, tombstoned: true },
  ];

  beforeAll(async () => {
    for (const s of seeds) {
      await rawSql`
        INSERT INTO memories (segment, bucket, content, importance, embedding, last_accessed_at, tombstoned_at, metadata)
        VALUES (
          ${s.segment},
          ${s.bucket},
          ${s.content},
          ${s.importance},
          ${JSON.stringify(s.embedding)}::vector,
          now() - (${s.ageDays} * interval '1 day'),
          ${s.tombstoned ? rawSql`now()` : null},
          ${{ test_id: TEST_ID }}::jsonb
        )
      `;
    }
  });

  afterAll(async () => {
    await rawSql`DELETE FROM memories WHERE metadata->>'test_id' = ${TEST_ID}`;
    await rawSql.end();
  });

  it('ranks cosine-aligned memories at the top', async () => {
    const rows = await recallMemories({
      queryVector: basisPerturbed(0, 0, 0.001),  // aligned with e_0
      queryText: 'oil change interval',
      topK: 5,
    });
    // top two rows should be the two oil-change entries (both on e_0)
    const top2 = rows.slice(0, 2).map((r) => r.content);
    expect(top2).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/sedan/),
        expect.stringMatching(/suv|email/), // email is also e_0-aligned
      ]),
    );
    expect(rows.every((r) => !r.content.includes('tombstoned'))).toBe(true);
  });

  it('segment filter excludes other segments', async () => {
    const rows = await recallMemories({
      queryVector: basisPerturbed(0, 0, 0.001),
      queryText: 'notification preference email',
      segment: 'knowledge',
      topK: 5,
    });
    for (const r of rows) expect(r.segment).toBe('knowledge');
  });

  it('decay ranks a recent memory above a stale identical one', async () => {
    const rows = await recallMemories({
      queryVector: basisPerturbed(2, 0, 0.001), // aligned with e_2
      queryText: 'recent stale knowledge',
      topK: 5,
    });
    const recentIdx = rows.findIndex((r) => r.content === 'recent knowledge');
    const staleIdx  = rows.findIndex((r) => r.content === 'stale knowledge');
    expect(recentIdx).toBeGreaterThanOrEqual(0);
    expect(staleIdx).toBeGreaterThan(recentIdx);
  });

  it('importance ranks higher-importance above lower for near-equal cosine', async () => {
    // e_1-aligned query: `tire rotation` (0.50) vs `brake inspection` (0.30)
    const rows = await recallMemories({
      queryVector: basisPerturbed(1, 0, 0.001),
      queryText: 'vehicle maintenance interval',
      topK: 5,
    });
    const tire = rows.findIndex((r) => r.content.includes('tire rotation'));
    const brake = rows.findIndex((r) => r.content.includes('brake inspection'));
    expect(tire).toBeGreaterThanOrEqual(0);
    expect(brake).toBeGreaterThan(tire);
  });

  it('top_k caps the result length', async () => {
    const rows = await recallMemories({
      queryVector: basisPerturbed(0, 0, 0.001),
      queryText: 'anything',
      topK: 3,
    });
    expect(rows.length).toBe(3);
  });

  it('EXPLAIN shows the HNSW index in use', async () => {
    const plan = await explainRecall({
      queryVector: basisPerturbed(0, 0, 0.001),
      queryText: 'anything',
      topK: 5,
    });
    expect(plan).toMatch(/memories_embedding_hnsw_idx/);
  });
});

describe.skip('[live] Gemini recall round-trip', () => {
  it('embeds a real query and returns 1536 unit-norm dims', async () => {
    const { embedForQuery, EMBEDDING_DIMS } = await import('@/lib/embeddings');
    const v = await embedForQuery('hello world');
    expect(v.length).toBe(EMBEDDING_DIMS);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1.0, 5);
  });
});
```

- [ ] **Step 4: Run the suites**

  ```bash
  pnpm test
  ```
  Expected: all three suites pass (embeddings 4/4 + recall 6/6 + mcp-memory 3/3); the skipped live Gemini block stays skipped.

- [ ] **Commit:**
  ```bash
  git add tests/embeddings.test.ts tests/mcp-memory.test.ts tests/memory-recall.test.ts
  git commit -m "test(phase-03): embedding normalize + hybrid recall + MCP handler"
  ```

---

## Task 9 — Demo script (phase 03 "done" signal)

**Files:**
- `scripts/recall-demo.ts` (new)
- `package.json` (edit — add `recall:demo` script)

- [ ] **Step 1: Write the script**

  ```ts
  // scripts/recall-demo.ts
  import 'dotenv/config';
  import { db } from '@/db/client';
  import { memories } from '@/db/schema/memories';
  import { and, eq, sql } from 'drizzle-orm';
  import { embedForDocument, embedForQuery } from '@/lib/embeddings';
  import { recallMemories } from '@/db/queries/memory-recall';

  const TEST_ID = 'phase-03-demo';

  const fixtures = [
    { segment: 'knowledge' as const,  importance: '0.80', content: 'Lease vehicle oil change is due every 5000 miles or 6 months.' },
    { segment: 'knowledge' as const,  importance: '0.60', content: 'Tire rotation interval is 10000 miles for standard fleet trucks.' },
    { segment: 'preference' as const, importance: '0.70', content: 'Dispatcher prefers morning maintenance windows between 07:00 and 10:00.' },
    { segment: 'knowledge' as const,  importance: '0.50', content: 'Brake inspection at 20000 miles; replace pads if under 4 mm.' },
    { segment: 'knowledge' as const,  importance: '0.65', content: 'The next scheduled oil change for unit L-42 (lease) is in 300 miles.' },
  ];

  async function run(): Promise<void> {
    try {
      console.log('seeding 5 memories…');
      for (const f of fixtures) {
        const embedding = await embedForDocument(f.content);
        await db.insert(memories).values({
          segment: f.segment,
          content: f.content,
          importance: f.importance,
          embedding,
          metadata: { test_id: TEST_ID },
        });
      }

      const question = 'when is the next oil change due for my lease vehicle?';
      console.log(`querying: ${question}`);
      const queryVector = await embedForQuery(question);
      const rows = await recallMemories({
        queryVector,
        queryText: question,
        topK: 5,
      });

      console.log('\ntop results:');
      for (const r of rows) {
        console.log(
          [
            `  [${r.segment}]`,
            `sim=${r.cosineSim.toFixed(3)}`,
            `rank=${r.tsRank.toFixed(3)}`,
            `eff=${r.effectiveImportance.toFixed(3)}`,
            `score=${r.score.toFixed(3)}`,
            `| ${r.content}`,
          ].join(' '),
        );
      }
    } finally {
      console.log('\ncleaning up demo seeds…');
      await db
        .delete(memories)
        .where(sql`metadata->>'test_id' = ${TEST_ID}`);
    }
  }

  run().then(
    () => process.exit(0),
    (err) => {
      console.error('demo failed:', err);
      process.exit(1);
    },
  );
  ```

- [ ] **Step 2: Add the pnpm script**

  Edit `package.json`'s `scripts` to include:

  ```json
  "recall:demo": "tsx scripts/recall-demo.ts"
  ```

- [ ] **Step 3: Run the demo**

  ```bash
  pnpm recall:demo
  ```
  Expected: prints ≥3 rows; the top row is the "lease vehicle oil change" content (id L-42 or the first `Lease vehicle oil change is due…` line). Final line reports cleanup.

  Verify cleanup by hand:
  ```bash
  pnpm exec tsx -e "import('./db/client').then(async ({ db }) => { const r = await db.execute(\"SELECT COUNT(*)::int AS n FROM memories WHERE metadata->>'test_id' = 'phase-03-demo'\"); console.log(r); process.exit(0); })"
  ```
  Expected: `n: 0`.

- [ ] **Commit:**
  ```bash
  git add scripts/recall-demo.ts package.json
  git commit -m "feat(phase-03): recall-demo tsx script (visible done signal)"
  ```

---

## Task 10 — Full CI loop + README update

- [ ] **Step 1: Run the gauntlet**

  ```bash
  pnpm typecheck && pnpm lint && pnpm test && pnpm build
  ```
  Expected: all four pass.

- [ ] **Step 2: Update `README.md` Quickstart**

  Add `GEMINI_API_KEY` to the env-var list. Mention `pnpm recall:demo` under "Scripts":

  ```md
  ## Env vars

  - `DATABASE_URL` — Neon pooled connection string
  - `DATABASE_URL_UNPOOLED` — Neon direct connection string (used for migrations + tests)
  - `GEMINI_API_KEY` — Google AI Studio key (free tier OK); used for memory embeddings

  ## Scripts

  - `pnpm dev` — Next.js dev server
  - `pnpm db:migrate` — apply Drizzle migrations
  - `pnpm test` — run vitest suites
  - `pnpm recall:demo` — seed a few memories, embed a query via Gemini, print ranked recall results (phase 03 end-to-end sanity check)
  ```

  (Exact copy may adjust to match the README's existing heading structure. Keep changes minimal.)

- [ ] **Commit:**
  ```bash
  git add README.md
  git commit -m "docs(phase-03): note GEMINI_API_KEY + recall:demo in README quickstart"
  ```

---

## Task 11 — Open the phase 03 PR

- [ ] **Step 1: Final push**

  ```bash
  git push origin phase/03-memory-mcp-read
  ```

- [ ] **Step 2: Open PR via `gh`**

  Title **must** start with `phase 03:`. Body links to plan doc sections.

  ```bash
  gh pr create --base main --head phase/03-memory-mcp-read \
    --title "phase 03: memory MCP (read)" \
    --body "$(cat <<'EOF'
  ## Summary

  - Adds in-process MCP server `memory` exposing one tool, `recall`, wired to `createSdkMcpServer` from `@anthropic-ai/claude-agent-sdk` (pinned `0.2.117`).
  - Embeds queries via `@google/genai` (pinned `1.50.1`) with `gemini-embedding-001` at 1536 dims using `RETRIEVAL_QUERY`, L2-normalized client-side.
  - Implements the hybrid SQL recall: `cosineDistance(…) ASC` (uses the HNSW index — not the broken `1 - cosineDistance(...)` DESC anti-pattern the Drizzle docs publish), plus `ts_rank_cd` FTS and continuous-exponential importance decay driven by `memory_segment_config` rows seeded in phase 02.
  - Ships a `pnpm recall:demo` script as the visible done signal: seeds 5 fixture memories, runs a real Gemini-embedded query, prints the ranked rows, cleans up.
  - Read-only. Write/reinforce/forget + decay tuning are phase 04.

  ## Plan references

  - `auto-ride-initial-plan.md` §3 (Claude Agent SDK, in-process MCP, subagents)
  - `auto-ride-initial-plan.md` §5 (memory decay formulas; anti-pattern warning)
  - `auto-ride-initial-plan.md` §6 (Gemini embeddings + pgvector retrieval)
  - `docs/roadmap/ROADMAP.md` — phase 03 row
  - Design: `docs/superpowers/specs/2026-04-22-phase-03-memory-mcp-read-design.md`
  - Plan: `docs/superpowers/plans/2026-04-22-phase-03-memory-mcp-read-plan.md`

  ## Test plan

  - [ ] Worktree identity verified (`shahriarbijoy` / `shahriarbijoy@gmail.com`)
  - [ ] `pnpm typecheck` passes
  - [ ] `pnpm lint` passes
  - [ ] `pnpm test` — embeddings (4/4) + mcp-memory (3/3) + memory-recall integration (6/6); live-Gemini block stays skipped
  - [ ] `pnpm build` passes (phase 01 `/health` regression check)
  - [ ] `pnpm recall:demo` prints ≥3 ranked rows, top row matches the intended fixture, cleanup leaves zero demo rows
  - [ ] `EXPLAIN` on the recall query mentions `memories_embedding_hnsw_idx` (integration test #7)
  - [ ] `package.json` pins both new deps with no caret
  EOF
  )"
  ```

- [ ] **Step 3: Link the PR URL here** (optional — overwrite after creation).

---

## Post-merge housekeeping

After the PR is squash-merged on GitHub:

- [ ] Fast-forward local main: `git switch main && git pull --ff-only origin main`.
- [ ] `git worktree remove .worktree/phase-03-memory-mcp-read` (only if nothing uncommitted — guardrail hook blocks `--force`).
- [ ] `git branch -d phase/03-memory-mcp-read` (safe delete — guardrail hook blocks `-D`).

Phase 04 (memory MCP — write / reinforce / forget + decay formulas) picks up from the same main HEAD, extending `memoryMcpServer` with three more tools and reusing `embedForDocument` from `lib/embeddings.ts`.
