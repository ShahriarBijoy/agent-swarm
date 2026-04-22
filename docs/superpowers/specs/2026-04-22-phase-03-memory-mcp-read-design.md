# Phase 03 — Memory MCP (read) (design)

**Date:** 2026-04-22
**Status:** approved (brainstorming)
**Plan references:** `auto-ride-initial-plan.md` §3, §5, §6
**Roadmap entry:** `docs/roadmap/ROADMAP.md` — phase 03

## Purpose

Stand up the first piece of live agent plumbing: an in-process MCP server named `memory` exposing **one** tool, `recall`, that runs a hybrid SQL query against the `memories` table from phase 02. The query blends pgvector cosine similarity, Postgres FTS rank, and a continuous-exponential importance-decay score, returning the top candidates for a given natural-language query.

Phase 03 ships read-only. No writes, no reinforcement, no forgetting — those are phase 04. No agent orchestrator, no `query()` call — that is phase 05. This phase proves that the embedding, ranking, and MCP-tool plumbing compose cleanly on top of phase 02's schema before anything else depends on them.

## Non-goals

Explicitly out of scope — do not add them even if convenient:

- Memory write / reinforce / forget MCP tools (phase 04).
- Promotion / demotion / tombstone-expiry logic (phase 04/09).
- Orchestrator + subagents + any `query()` call (phase 05).
- `canUseTool` / Inngest `waitForEvent` (phase 07).
- Langfuse / OTel instrumentation around the MCP tool (phase 12).
- SSE endpoint, task runner, task-event writes (phase 06).
- UI (no route, no component — phase 06 onwards).
- Better Auth / login gate (phase 11).

Phase 03 registers the MCP server and verifies it works end-to-end via a CLI demo script. Wiring it into a real `query()` call is phase 05's job.

## Cost check

Near-zero incremental cost.

- **Gemini embeddings:** `gemini-embedding-001` is free on the Gemini API free tier at portfolio volumes. A `RETRIEVAL_QUERY` call returns a 1536-dim vector; every `recall` invocation is one call. Demo script calls it ~5 times total; integration tests stub it deterministically (see Testing). **Budget impact: pennies, bounded by the free tier.**
- **Neon:** already wired in phase 01. No new tables, no new indexes.
- **Anthropic API:** **untouched this phase.** No `query()` call is made, so no Claude tokens are spent. This keeps the phase independent of the phase 05 auth-path decision (Max OAuth vs LiteLLM proxy vs API key).

## Dependencies

**Newly installed — both pinned exactly, not `^`, per `CLAUDE.md` SDK-alpha guidance.**

| Package | Version | Why |
|---|---|---|
| `@anthropic-ai/claude-agent-sdk` | `0.2.117` | `createSdkMcpServer` + `tool()` in-process MCP helpers. Alpha — weekly breaking releases per `auto-ride-initial-plan.md` §8 — pin exactly. |
| `@google/genai` | `1.50.1` | Gemini embeddings client. `ai.models.embedContent` with `taskType: 'RETRIEVAL_QUERY'` and `outputDimensionality: 1536`. v1.48+ required per plan §6; legacy `@google/generative-ai` is wrong. |

**Already installed (phase 01 / 02):** `drizzle-orm@^0.45.2` exports `cosineDistance` from the `drizzle-orm` root (not `drizzle-orm/pg-core`), `zod@^4` for tool input schemas, `@neondatabase/serverless@^1.1.0`, `postgres@^3.4.9` (for tests), `tsx@^4.21.0` (for the demo script), `vitest@^4` for tests.

**Confirmed APIs** (verified against current docs before writing this spec):

| Need | API | Import |
|---|---|---|
| In-process MCP server | `createSdkMcpServer({ name, version, tools })` | `@anthropic-ai/claude-agent-sdk` |
| Tool helper (TS, zod-shape) | `tool(name, description, zodShape, handler, { annotations? })` | `@anthropic-ai/claude-agent-sdk` |
| Tool handler return | `{ content: [{ type: 'text', text: string }], isError?: boolean }` | (MCP `CallToolResult`) |
| Embed one query | `ai.models.embedContent({ model, contents: [text], config })` | `@google/genai` |
| Drizzle cosine distance | `cosineDistance(col, vector)` | `drizzle-orm` |

**Zod quirk:** the `tool()` helper takes the **shape** (a plain object of named zod fields), not a wrapped `z.object(...)`. Handler `args` are typed from that shape automatically.

## Directory layout

Phase 02 flat layout continues — no `src/`. Four new files, one edit, two new test files, one new script.

```
Agent-swarm/
├── db/
│   ├── client.ts                           # unchanged
│   ├── schema/                             # unchanged from phase 02
│   └── queries/
│       └── memory-recall.ts                # NEW — hybrid SQL
├── lib/
│   ├── env.ts                              # EDIT — add GEMINI_API_KEY
│   ├── embeddings.ts                       # NEW — Gemini embed + L2 normalize
│   └── mcp/
│       └── memory.ts                       # NEW — createSdkMcpServer('memory', …)
├── scripts/
│   └── recall-demo.ts                      # NEW — tsx demo (done signal)
├── tests/
│   ├── embeddings.test.ts                  # NEW — L2 normalization unit
│   ├── memory-recall.test.ts               # NEW — integration: seed + recall + ordering
│   └── mcp-memory.test.ts                  # NEW — tool handler + MCP init smoke
└── docs/superpowers/
    ├── specs/2026-04-22-phase-03-memory-mcp-read-design.md   # NEW — this file
    └── plans/2026-04-22-phase-03-memory-mcp-read-plan.md     # NEW
```

`db/queries/` is a new directory — it will grow through phase 04 (write/reinforce/forget) and phase 09 (nightly candidate selection). `lib/mcp/` is new for the same reason: phase 04 adds `write`/`reinforce`/`forget` tools to the same MCP server, phase 08 may add additional servers (a db read-only server, a stripe server) per plan §3.

## Architecture

### 1. Query-side embedding helper — `lib/embeddings.ts`

Thin wrapper around `@google/genai` exposing two functions:

- `embedForQuery(text: string): Promise<number[]>` — `taskType: 'RETRIEVAL_QUERY'`, `outputDimensionality: 1536`, L2-normalizes the returned values, returns a plain number array sized 1536. Used by `recall`.
- `embedForDocument(text: string): Promise<number[]>` — same call but `taskType: 'RETRIEVAL_DOCUMENT'`. **Exported now for phase 04's consumption** to keep the `RETRIEVAL_QUERY`/`RETRIEVAL_DOCUMENT` asymmetry in a single file. Not called from phase 03 code except one integration test.

**Why L2-normalize in code.** Gemini's `outputDimensionality` truncates from the end of the 3072-dim native embedding via Matryoshka. Truncated vectors below 3072 dims are **not auto-normalized** by Gemini; the client must normalize before cosine similarity is meaningful (plan §6 makes this explicit). Normalizing to unit length also means `cosineDistance` (which pgvector computes as `1 - (a·b)/(‖a‖‖b‖)`) reduces to `1 - a·b` — exactly what the HNSW `vector_cosine_ops` index optimizes.

**Shape expected by Drizzle's `vector(…)` column:** a `number[]` at insert time, returned as a `number[]` on select. The helper returns `number[]` (not `Float32Array`) to match.

**Error behavior.** A Gemini API error bubbles up as a thrown `Error` with the Gemini error message preserved. The MCP tool handler catches it and returns `{ isError: true, content: […] }` so the agent loop keeps running (per SDK custom-tools doc). Throwing from the handler would stop `query()` — not what we want.

### 2. Hybrid recall query — `db/queries/memory-recall.ts`

One function: `recallMemories({ queryVector, queryText, segment?, topK })`. Accepts a pre-computed query vector (so the MCP tool handles the Gemini call, not this layer) plus the raw query text (for FTS). Returns the top `topK` non-tombstoned rows ordered by a hybrid score.

**The SQL formula (single statement, expressed via drizzle `sql\`...\`` + `cosineDistance`):**

```
score = 0.55 · cosine_sim
      + 0.25 · ts_rank
      + 0.20 · effective_importance
```

where:

- `cosine_sim = 1 - cosineDistance(embedding, $queryVector)` — range `[0, 1]` for normalized vectors; higher = more similar.
- `ts_rank = ts_rank_cd(content_tsv, plainto_tsquery('english', $queryText))` — Postgres FTS rank; natively unbounded but ≤ 1 in practice for short documents. Returned as-is (not min-maxed) because one document's absolute rank is comparable to another's when they share the same query.
- `effective_importance = importance · exp(-λ · extract(epoch from now() - last_accessed_at) / 86400.0)`
  where `λ = memory_segment_config.decay_lambda_short` **for `bucket = 'short'`**, `λ = config.decay_lambda_long_factor · (1 - 0.8 · importance)` **for `bucket = 'long'`** (adaptive per plan §5), and `λ = 0` **for `bucket = 'permanent'`** (no decay). Evaluated in SQL via a `CASE` on `bucket` joined against `memory_segment_config`.

**Why pre-mix the three signals in SQL rather than ordering by one and post-filtering.** It's one index-seek pass. pgvector HNSW orders on `cosineDistance(col, q)` ASC; we use that ordering to bound the candidate window, then the hybrid score reranks within the window.

**Critical anti-pattern warning (plan §5, Drizzle-docs issue #436).** The Drizzle vector-search guide publishes this example:

```ts
// BROKEN — bypasses the HNSW index, turns 100 ms queries into 12-second scans
const similarity = sql<number>`1 - ${cosineDistance(col, q)}`;
.orderBy(desc(similarity))
```

pgvector's HNSW index is built on the `cosineDistance` operator (`<=>`), which gives distance (lower = more similar). Wrapping it in `1 - (…)` and sorting `DESC` **turns it into a non-index-usable scalar expression** — Postgres falls back to a sequential scan of every embedding. Phase 03 orders by the raw distance ASC:

```ts
// CORRECT — uses the HNSW index
const distance = cosineDistance(memories.embedding, queryVector);
.orderBy(distance)   // ASC; cosineDistance returns distance, smaller = more similar
```

The reranking composite (`score` above) is computed **after** the index-ordered `LIMIT` bounds the candidate window. Implementation detail: order by `distance` ASC, `LIMIT topK * 3` as the HNSW candidate window, then apply the hybrid score via a subquery / CTE.

**Filter:** `WHERE tombstoned_at IS NULL` (matches all three partial indexes from phase 02 — HNSW, GIN, and compound btree). Optional `segment` filter applies `AND segment = $segment`.

**Pagination:** none in phase 03. `top_k` caps at 50; default 8.

**Update side-effects:** **none in phase 03**. The recall should in theory increment `access_count` and bump `last_accessed_at` on the rows it returns — but those writes belong to phase 04's reinforcement logic. Phase 03 is read-only so the query can be run freely from scripts without mutating state.

### 3. In-process MCP server — `lib/mcp/memory.ts`

Exports two things:

- `recallTool` — the single `tool(…)` definition.
- `memoryMcpServer` — `createSdkMcpServer({ name: 'memory', version: '1.0.0', tools: [recallTool] })`.

**Tool shape:**

```ts
tool(
  'recall',
  'Retrieve memories relevant to a query. Returns top-K results ranked by hybrid score (cosine similarity + full-text rank + importance decay). Segment filter optional.',
  {
    query: z.string().min(1).describe('Natural-language query to search memories for'),
    segment: z
      .enum(['identity', 'correction', 'preference', 'relationship', 'knowledge', 'behavioral', 'context'])
      .optional()
      .describe('Restrict to one segment; omit to search all.'),
    top_k: z.number().int().min(1).max(50).default(8).describe('Max rows to return (default 8, cap 50)'),
  },
  async (args) => { /* embed, recall, stringify */ },
  { annotations: { readOnlyHint: true } },   // lets Claude batch with other reads (phase 05)
)
```

**Handler flow:**

1. `const queryVector = await embedForQuery(args.query);`
2. `const rows = await recallMemories({ queryVector, queryText: args.query, segment: args.segment, topK: args.top_k });`
3. Return `{ content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] }`.
4. On thrown error (Gemini outage, DB offline), wrap in `{ isError: true, content: [{ type: 'text', text: 'recall failed: …' }] }`.

**Name format.** With server key `memory`, the fully-qualified tool name becomes `mcp__memory__recall` (per SDK custom-tools doc). Phase 05 will list this in `allowedTools` on the orchestrator's `query()` call.

**Segment enum inline-duplication.** Zod `.enum(…)` can't easily derive from the Drizzle `pgEnum` values at runtime without reflection. We hard-code the seven segments in the tool schema and add a typecheck test (`tests/embeddings.test.ts` or a new `tests/mcp-memory.test.ts`) asserting the zod enum matches `segmentEnum.enumValues`. If the pg enum ever changes, the test fails before the MCP tool silently accepts a bad value.

### 4. Demo script — `scripts/recall-demo.ts`

**This is the phase's visible done signal.** A `tsx` script that:

1. Connects to Neon via the same `db` client as the app.
2. Inserts ~5 hand-written memories across two segments (e.g. `knowledge` + `preference`) with hand-crafted embeddings (one is "about oil changes", one is "about tire rotations", etc.).
3. Directly calls `embedForQuery('when is the next oil change due for my lease vehicle?')` to get a real 1536-dim vector.
4. Calls `recallMemories(…)` with that vector + the query text.
5. Prints the top-K rows formatted as a table (content preview, segment, cosine sim, FTS rank, effective importance, combined score).
6. Deletes the seeded rows on exit — so the script is idempotent.

This script runs against the **real** Gemini API (free tier) and the real Neon dev DB. It is not part of `pnpm test` — invoked manually as `pnpm recall:demo`.

**Why a script, not a route.** Roadmap phase 05 is "CLI-driven (no UI)", and phase 06 is where the first `/tasks/[id]` route appears. Adding a `/api/dev/recall` route now means either (a) exposing it unauthed pre-phase-11 (mild leak risk, demo only) or (b) wiring Better Auth early (out of scope). A `tsx` script is the lowest-friction way to exercise the full path and is consistent with the `tests/` + `scripts/` style already in the repo.

## env.ts change

Add a single required key:

```ts
GEMINI_API_KEY: z.string().min(1),
```

No optional fallback. Without the key, `loadEnv()` throws on boot and the `recall` tool would fail on the first call — loud failure is better than silently returning bad embeddings.

## Testing

Three new vitest files. All run under `pnpm test`.

### `tests/embeddings.test.ts` (unit, no network)

1. L2 normalization produces unit-length vectors: `sqrt(sum(v[i]^2))` is within `1e-6` of `1.0` for sampled inputs.
2. Normalization is idempotent: normalizing twice produces the same vector (up to `1e-12`).
3. A zero-vector input throws or returns a zero-vector unchanged — whichever is explicit in the helper (pick one; document in the spec once implemented).
4. The zod enum in `lib/mcp/memory.ts`'s recall-tool schema matches `segmentEnum.enumValues` from `db/schema/enums.ts` exactly (same members, same order).

### `tests/memory-recall.test.ts` (integration, hits live Neon)

Skipped automatically if `DATABASE_URL_UNPOOLED` is unset (same pattern as phase 02 schema test).

Seeds ~8 memories with **hand-crafted** 1536-dim embeddings — no Gemini call. Simple deterministic generator: pick a base unit vector (e.g. `e_0`), perturb component values for each seeded memory, L2-normalize. Two memories live on `e_0`, two on `e_1`, etc., across two segments (`knowledge`, `preference`). Importance values span `0.3, 0.5, 0.8`. Some `last_accessed_at` values set to 14 days ago to exercise decay.

Assertions:

1. Recall with query vector ≈ `e_0` returns the two `e_0`-aligned memories as the top two, regardless of segment.
2. Recall with `segment: 'knowledge'` excludes `preference` rows even when they're more similar.
3. Given two near-identical cosine-similarity candidates, the one with higher recent-access (smaller `last_accessed_at` gap) ranks above the older one — proves the importance-decay term is active.
4. Given two near-identical candidates, the one with higher `importance` ranks above the lower — tests the importance weighting.
5. Tombstoned rows are never returned even when their embedding is a near-perfect match.
6. `top_k: 3` returns exactly 3 rows (bounds check).
7. The query uses the HNSW index: `EXPLAIN (FORMAT JSON) …` must mention `Index Scan using memories_embedding_hnsw_idx` — regression guard against the `1 - cosineDistance` anti-pattern sneaking back in. Tolerate `Bitmap Index Scan` as a variant.

Cleanup: `DELETE FROM memories WHERE metadata->>'test_id' = 'phase-03-recall'` in `afterAll`.

### `tests/mcp-memory.test.ts` (unit + integration)

1. `createSdkMcpServer({ name: 'memory', … })` returns an object; it has the expected top-level shape (name, version, tools). Calling the tool handler directly with stubbed `embedForQuery` returns the expected `{ content: [{ type: 'text', text }] }` and `text` parses as JSON.
2. Tool handler rethrow behavior: when `embedForQuery` throws, the handler returns `{ isError: true, content: [...] }`, never throws. Guards against the SDK custom-tools doc's explicit warning that thrown exceptions end the agent loop.
3. The tool's `allowedTools` name is predictable: `mcp__memory__recall` is a string constant exported from `lib/mcp/memory.ts` so phase 05's orchestrator can reference it without string-duplication drift.

### Live-Gemini e2e (skipped by default)

`tests/memory-recall.test.ts` includes one `describe.skip('[live] Gemini recall round-trip', …)` block that calls the real `embedForQuery` once and verifies the returned vector length (1536) and unit norm. Intended to be un-skipped manually before each merge and before the phase 05 PR to confirm Gemini is still responding as expected. Not part of CI.

## Acceptance criteria

All must pass before the phase 03 PR merges:

1. `pnpm typecheck` passes with `noUncheckedIndexedAccess`.
2. `pnpm lint` passes.
3. `pnpm test` passes: embeddings unit suite (4/4), memory-recall integration suite (7/7), mcp-memory suite (3/3). Skipped blocks remain skipped.
4. `pnpm build` passes — the phase 01 `/health` route still renders. (Phase 03 doesn't add routes; this is a regression check.)
5. `pnpm recall:demo` prints a ranked list of at least 3 seeded rows with the top row being the intended match for `"when is the next oil change due for my lease vehicle?"`, and seeds are deleted at exit (`SELECT COUNT(*) FROM memories WHERE metadata->>'test_id' = 'phase-03-demo'` returns 0).
6. `EXPLAIN` on the production recall query mentions the HNSW index (captured in integration test #7 above).
7. `createSdkMcpServer` reports the memory server's tools as a one-element array; `recallTool.name === 'recall'`. Smoke-checked in `tests/mcp-memory.test.ts`.
8. Worktree git identity verified: `git config user.name` → `shahriarbijoy`, `git config user.email` → `shahriarbijoy@gmail.com`.
9. `package.json` pins both new deps with `=` / no-caret: `"@anthropic-ai/claude-agent-sdk": "0.2.117"`, `"@google/genai": "1.50.1"`. pnpm-lock.yaml committed.
10. `README.md` Quickstart mentions `GEMINI_API_KEY` as a required env var alongside `DATABASE_URL` / `DATABASE_URL_UNPOOLED`, and the new `pnpm recall:demo` command appears in the script list.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `createSdkMcpServer` alpha bug: returns a shape missing `.connect()` (issues #12 / #147 per plan §8) | Medium | Pin to `0.2.117` exactly; `tests/mcp-memory.test.ts` #1 asserts server shape. If the bug resurfaces, downgrade to the previous known-good and file in the repo's README under "known good SDK versions". |
| Drizzle-docs anti-pattern (`1 - cosineDistance` DESC) sneaks back in during code review | Medium | `tests/memory-recall.test.ts` #7 asserts `EXPLAIN` mentions the HNSW index. Fails loudly if the planner switches to a seq scan. |
| Gemini embedding API rate-limited or down → `recall` fails | Low (free tier is lenient) | Handler returns `isError: true` so the agent loop continues; the demo script reports the error and exits non-zero. Not a runtime block. |
| L2-normalization bug yields non-unit vectors → cosine comparisons wrong by a constant factor | Medium | `tests/embeddings.test.ts` #1/#2. Also: integration test #1 fails visibly (wrong top result) if normalization is broken. |
| Zod `tool()` schema shape vs `z.object(...)` — easy to wrap it when you shouldn't | Medium | Typecheck test-as-code; the SDK docs are explicit but the ergonomics mislead. Verify handler `args` type is `{ query: string; segment?: …; top_k: number }` and not `z.infer<…>` of a wrapped object. |
| `outputDimensionality` truncation on Gemini differs between model versions | Low | `tests/embeddings.test.ts` #1 verifies the returned vector length is exactly 1536. Will fail fast on any model/API change. |
| `memory_segment_config.decay_lambda_short` / `decay_lambda_long_factor` typed as `double precision` in Drizzle but come back as `number` in JS — SQL math must stay server-side | Low | Decay is computed entirely in SQL via a LATERAL / JOIN against `memory_segment_config`. No JS arithmetic on the decay lambda. Tests confirm the ordering changes with `last_accessed_at` age. |
| `numeric(3,2)` importance values returned as JS `string` by drizzle — risks string-sort bugs if we ever JS-sort | Low | We never JS-sort; all ranking is in SQL. Tests assert the returned order, not the raw type. |
| `tsx` script runs against the dev DB and leaves junk rows on crash | Low | Demo script's inserts all tag `metadata->>'test_id' = 'phase-03-demo'`; a `finally`-block deletes by that tag; a manual `scripts/cleanup-demo.ts` exists as a safety net (deletable in phase 04 once write/forget covers this). |
| SDK alpha renames `createSdkMcpServer` signature before phase 05 | Medium | Exact pin. Phase 05 will upgrade deliberately with a changelog review, not drift through a `^` bump. |

## What unlocks next

Phase 03 passing unlocks **phase 04 (memory MCP — write/reinforce/forget + decay formulas)**, which extends the existing `memoryMcpServer` with three more tools and adds the promotion/demotion/tombstone logic that consumes `memory_segment_config`. Phase 04 reuses `embedForDocument` from `lib/embeddings.ts` exactly as phase 03 exports it.

Phase 05 (first `query()`) reuses `memoryMcpServer` as its first MCP server registration and `mcp__memory__recall` as its first `allowedTools` entry. Phase 03 also gives phase 05 a known-good pattern for handler error propagation (the `isError` return, not throwing) that it will copy for the `db` MCP server.

Phase 09 (nightly cleanup) reuses the `recallMemories` SQL pattern to select merge candidates (pairs of memories within some cosine distance of each other within the same segment). The base function may generalize; phase 03 exports it in a way that phase 09 can wrap without rewriting the index-usable SQL.
