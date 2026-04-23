# Phase 05 — first `query()` (design)

**Date:** 2026-04-23
**Status:** approved (brainstorming)
**Plan references:** `auto-ride-initial-plan.md` §3
**Roadmap entry:** `docs/roadmap/ROADMAP.md` — phase 05

## Purpose

Stand up the first real Claude Agent SDK run — a CLI-driven vertical slice that exercises the orchestrator, one subagent, the phase-04 memory MCP, a `PreToolUse` audit hook, and full SDK-message persistence into the phase-02 `task_runs` / `task_events` tables. The goal is a `pnpm query:demo "<prompt>"` command that produces a real `SDKResultMessage` with a non-zero cost, a complete timeline of events in Postgres, and no UI scaffolding.

Phases 06 (task API + SSE) and 07 (HITL) are the web-surface wrappers around this phase's primitive; keeping the runtime headless here means their UI work only has to integrate with stable, tested plumbing.

## Non-goals

Explicitly out of scope — do not add them even if convenient:

- Next.js API routes, Server Actions, or any HTTP surface around `query()` (phase 06).
- SSE timeline endpoint / `force-dynamic` streaming (phase 06).
- UI components (`<AssistantTurn>`, `<ToolCall>`, `<CompactBoundary>`, …) (phase 06).
- Inngest event broker / `step.waitForEvent` / durable sandbox lifecycle (phase 06+).
- `canUseTool` approval gate, `approval_gates` row writes, approval-bar integration (phase 07).
- Additional subagents beyond `fleet-analyst` (phase 08 fans out to the full 11).
- Cron-scheduled nightly memory cleanup, Consolidator/Adversary/Judge debate (phase 09).
- Langfuse / OpenInference OTel instrumentation (phase 12).
- Better Auth / login gate / session cookies (phase 11).
- Vercel Sandbox or Fly.io deployment of the agent runtime (phase 12).
- LiteLLM proxy setup automation — phase 05 supports LiteLLM as one of three auth paths, but the proxy itself is operated out-of-band by the developer.
- Session resume / `continue` / `forkSession` — phase 05 always starts a fresh session per run. Resume is a phase 06+ concern.
- `task_events.type` check-constraint expansion — phase 05 lives within the seven types phase 02 seeded. SDK messages that don't map to one of those types are logged to stderr and not persisted.

## Cost check

Small but real — this is the first phase that spends Anthropic tokens.

- **Anthropic API:** `pnpm query:demo` with a short "fleet health" prompt is expected to take 3–8 orchestrator turns + 1–2 subagent turns on Haiku. Ballpark cost per run at list prices: **$0.01–$0.04** (one Sonnet 4.6 orchestrator turn ≈ $0.003 per 1k input + $0.015 per 1k output; Haiku ≈ 15× cheaper). Hard-capped by `maxBudgetUsd: 0.50` on the demo invocation — a runaway loop aborts before it reaches a dollar.
- **Gemini embeddings:** memory MCP's `recall` tool embeds each query via `embedForQuery`. At most ~5 recalls per demo run → well under the free tier.
- **Neon:** three existing tables written (`tasks`, `task_runs`, `task_events`). No new tables, no new indexes, no migration.

Monthly dev-time cost with ~20 `pnpm query:demo` runs plus ad-hoc `[live]` test unskips: **< $2**.

## Dependencies

**No new packages.** Everything builds on phase 03's `@anthropic-ai/claude-agent-sdk@0.2.117` and phase 04's memory MCP.

**APIs reused from prior phases:**

| Need | API | Import |
|---|---|---|
| SDK query | `query({ prompt, options })` | `@anthropic-ai/claude-agent-sdk` |
| Agent definitions | `type AgentDefinition` | `@anthropic-ai/claude-agent-sdk` |
| Hook input / output types | `PreToolUseHookInput`, `PreToolUseHookSpecificOutput`, `HookCallback` | `@anthropic-ai/claude-agent-sdk` |
| Memory MCP server instance | `memoryMcpServer`, `*_TOOL_FQN` constants | `@/lib/mcp/memory` |
| DB client | `db` | `@/db/client` |
| Task tables | `tasks`, `taskRuns`, `taskEvents` | `@/db/schema` |

**New env vars:** phase 05 selects an Anthropic auth path. The loader validates that **at least one** of the three paths below is populated; it does not require all of them. The SDK reads the chosen vars directly — we don't forward them.

| Path | Vars | Use |
|---|---|---|
| OAuth (Pro/Max subscription) | `CLAUDE_CODE_OAUTH_TOKEN` | `claude setup-token` output — cleanest for this non-commercial build |
| Gateway / LiteLLM proxy | `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` | Point the SDK at a local proxy for Max pass-through or unified cost tracking |
| Direct API key | `ANTHROPIC_API_KEY` | Fallback / prod — console.anthropic.com key |

`.env.example` gains comments pointing at each path. The three are documented in `README.md`'s Phase 05 section.

## Directory layout (delta from phase 04)

Phase 02/03/04's flat layout continues. Four new runtime files under a new `lib/agent/` directory, one new query-helper file, five new tests, one new script, three edits.

```
Agent-swarm/
├── db/
│   └── queries/
│       └── task-runtime.ts              # NEW — createTask, createTaskRun, appendTaskEvent, finalizeRun, finalizeTask
├── lib/
│   ├── agent/
│   │   ├── fleet-analyst.ts             # NEW — fleet-analyst AgentDefinition
│   │   ├── hooks.ts                     # NEW — auditPreToolUse hook
│   │   ├── persist.ts                   # NEW — mapMessageToEvents (pure)
│   │   └── runtime.ts                   # NEW — runOrchestrator wrapper
│   └── env.ts                           # EDIT — loadAgentAuthEnv() helper
├── scripts/
│   └── query-demo.ts                    # NEW — visible done signal
├── tests/
│   ├── agent-definitions.test.ts        # NEW
│   ├── agent-hooks.test.ts              # NEW
│   ├── agent-persist.test.ts            # NEW
│   ├── agent-runtime.test.ts            # NEW — [live] Haiku round-trip, skipped by default
│   └── env.test.ts                      # NEW
├── package.json                         # EDIT — add `query:demo` script
├── README.md                            # EDIT — phase 05 Quickstart section
├── .env.example                         # EDIT — uncomment phase 05 auth block
└── docs/superpowers/
    ├── specs/2026-04-23-phase-05-first-query-design.md   # NEW — this file
    └── plans/2026-04-23-phase-05-first-query-plan.md     # NEW
```

`lib/agent/` is a new directory. It owns agent-runtime plumbing (definitions, hooks, persistence, the top-level `runOrchestrator` wrapper). Phase 08 will add the other ten agent definitions here as sibling files; phase 09 will add the three cleanup-debate agents; phase 07 will add the `canUseTool` gate alongside `hooks.ts`.

## Architecture

The runtime has four layers. The bottom layer (`persist.ts`) is pure and fast; the middle layers (`fleet-analyst.ts`, `hooks.ts`) are declarative config; the top layer (`runtime.ts`) orchestrates one SDK session against Postgres. Tests target the pure + declarative layers at fine grain; the top layer gets one integration test and the demo script.

```
┌──────────────────────────────────────────────────────────────────────┐
│ scripts/query-demo.ts               (CLI driver — visible done)      │
└─────────────────┬────────────────────────────────────────────────────┘
                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│ lib/agent/runtime.ts     runOrchestrator({ prompt, budgetUsd? })      │
│   ├─ insert tasks row                                                 │
│   ├─ insert task_runs row                                             │
│   ├─ call query({ model: 'claude-sonnet-4-6', agents, hooks,         │
│   │               mcpServers: { memory }, allowedTools, caps })      │
│   └─ for-await messages: mapMessageToEvents → insert task_events,    │
│      capture session_id, update totals on SDKResultMessage           │
└─────────────────┬────────────────────────────────────────────────────┘
                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│ lib/agent/persist.ts     mapMessageToEvents(msg): TaskEventInput[]    │
│   (pure — no DB, no SDK side effects)                                 │
└──────────────────────────────────────────────────────────────────────┘
                  ▲                                ▲
                  │                                │
┌─────────────────┴─────────────────┐  ┌───────────┴──────────────────┐
│ lib/agent/fleet-analyst.ts        │  │ lib/agent/hooks.ts            │
│   fleetAnalyst: AgentDefinition   │  │   auditPreToolUse: HookCallback│
│   (model: 'haiku', tools: [read,  │  │   (logs + passes through —    │
│    memory recall/write/…])        │  │    policy gates are phase 07) │
└───────────────────────────────────┘  └───────────────────────────────┘
```

### 1. Fleet analyst — `lib/agent/fleet-analyst.ts`

Single subagent definition. Exported as a named const so it can be included in an `agents` record in `runtime.ts` and inspected structurally by `tests/agent-definitions.test.ts`.

```ts
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import {
  RECALL_TOOL_FQN, WRITE_TOOL_FQN, REINFORCE_TOOL_FQN,
} from '@/lib/mcp/memory';

export const FLEET_ANALYST_NAME = 'fleet-analyst' as const;

export const fleetAnalyst: AgentDefinition = {
  description:
    'Analyzes fleet telemetry, maintenance schedules, and vehicle utilization. ' +
    'Use for anything involving fleet data, service intervals, or vehicle reports.',
  model: 'haiku',                // short alias ONLY — plan §3 footgun #2
  tools: ['Read', RECALL_TOOL_FQN, WRITE_TOOL_FQN, REINFORCE_TOOL_FQN],
  prompt: /* human-readable system prompt; see below */,
  maxTurns: 6,
};
```

**Why `model: 'haiku'` (short alias, not `'claude-haiku-4-5'`).** Plan §3 gotcha #2 — `AgentDefinition.model` only accepts short aliases; full IDs silently fall back to `'inherit'` and the subagent quietly runs on the orchestrator's Sonnet. The orchestrator uses the full ID `'claude-sonnet-4-6'` in `Options.model` (where full IDs *are* accepted); the subagent uses the alias. This asymmetry is the #1 thing phase 05 exists to prove works.

**Why `Read` + three memory FQNs, not all four.** The subagent can recall, write, and reinforce, but `forget` is destructive (phase 07 will require approval for every call). Giving the subagent `forget` at this stage would either fire `canUseTool` (not wired yet) or go through unchecked. Conservative: leave it off for now; phase 07 adds it back once the gate exists.

**Prompt shape.** ~150 words. Sets the role (fleet analyst at Auto-ride), reminds the agent to always `recall` before answering questions involving prior context, and caps the response at a single paragraph + optional bullet list — short outputs keep demo runs cheap. Full text lives in the file; spec omits for brevity.

**`maxTurns: 6`.** Defensive cap at the subagent level (plan §8 risk #4: runaway loops). The subagent should typically finish in 1–3 turns (recall + synthesize + return); 6 is headroom without being generous.

### 2. Audit hook — `lib/agent/hooks.ts`

A single `PreToolUse` hook that logs every tool call to stderr and passes through. No blocking, no mutation — policy is phase 07's concern.

```ts
import type {
  HookCallback, PreToolUseHookInput, PreToolUseHookSpecificOutput,
} from '@anthropic-ai/claude-agent-sdk';

export const auditPreToolUse: HookCallback = async (input, toolUseId) => {
  const p = input as PreToolUseHookInput;
  const isSubagent = Boolean(p.agent_id);
  const label = isSubagent ? `subagent ${p.agent_type ?? '?'}` : 'orchestrator';
  console.error(
    `[audit] ${label} tool=${p.tool_name} id=${toolUseId ?? '?'} ` +
    `session=${p.session_id} input=${safeShort(p.tool_input)}`,
  );
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
    } satisfies PreToolUseHookSpecificOutput,
  };
};
```

`safeShort(input)` stringifies and trims to 200 chars — keeps stderr readable when an MCP call ships a 1536-dim embedding back in its input.

**Why explicit `permissionDecision: 'allow'`.** Returning `{}` from a `PreToolUse` hook is also a pass-through, but an explicit `allow` is self-documenting and matches phase 07's pattern (where `canUseTool` will start returning `'ask'` / `'deny'` for destructive tools). Reading the code in three months should make the intent obvious.

**Wiring in `runtime.ts`.**

```ts
hooks: {
  PreToolUse: [{ matcher: '.*', hooks: [auditPreToolUse] }],
},
```

Matcher `.*` fires on every tool name. The matcher is a regex on the tool name, not the tool FQN — the SDK strips the `mcp__memory__` prefix before matching. The `'.*'` is intentional: we want an audit row for *every* call, including MCP calls, for later forensics in phase 12.

### 3. SDK-message mapper — `lib/agent/persist.ts`

Pure function. Takes a `SDKMessage`, returns zero-or-more `TaskEventInput` rows. No DB, no SDK side effects; easily unit-tested against fixture messages.

```ts
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

export type TaskEventInput = {
  type: 'assistant_turn' | 'tool_call' | 'tool_result'
      | 'compact_boundary' | 'run_result' | 'user_message';
  payload: Record<string, unknown>;
};

export function mapMessageToEvents(msg: SDKMessage): TaskEventInput[];
```

#### Mapping rules

| SDK message type (subtype)                 | Emitted events                                                                 |
|--------------------------------------------|--------------------------------------------------------------------------------|
| `assistant`                                | 1× `assistant_turn` (full `msg`); + 1× `tool_call` per `tool_use` content block |
| `user` (content has `tool_result` blocks)  | 1× `tool_result` per `tool_result` content block                               |
| `user` (no `tool_result` blocks)           | 1× `user_message` (human turn)                                                 |
| `system` (subtype `compact_boundary`)      | 1× `compact_boundary`                                                          |
| `result` (subtype `success` / `error_*`)   | 1× `run_result` (full `msg` — includes cost, tokens, num_turns, usage)         |
| `system` (subtype `init`)                  | 0 rows (sessionId captured separately by runtime)                              |
| `stream_event` / `tool_progress` / …       | 0 rows (not needed for timeline; dropped silently)                             |

**Why emit both `assistant_turn` and per-block `tool_call` for one SDK message.** Phase 06's UI renders `<ToolCall>` as a distinct component from `<AssistantTurn>`. Decomposing at the persistence layer lets phase 06 render each component from a direct event row without parsing JSON content blocks at render time. The assistant turn row carries the full text / thinking output; tool-call rows carry just the `tool_use_id`, `tool_name`, `input`.

**Payload shapes** (strict — phase 06's components type against these):

```ts
assistant_turn: { uuid, session_id, parent_tool_use_id, message: BetaMessage }
tool_call:      { tool_use_id, tool_name, input, parent_tool_use_id, session_id }
tool_result:    { tool_use_id, is_error, content }
compact_boundary: { uuid, session_id, compact_metadata }
run_result:     { subtype, total_cost_usd, duration_ms, num_turns, usage,
                  modelUsage, result?, errors?, uuid, session_id }
user_message:   { uuid?, session_id?, message }
```

**Zero-row cases matter.** Phase 02's `task_events.seq` is a compound unique index with `run_id`; if the mapper emits zero events, the runtime must not advance `seq`. Design holds: `runtime.ts` advances `seq` per *emitted* event, not per SDK message.

**Why skip `stream_event`.** We don't set `includePartialMessages: true` — there's no UI in phase 05 and token-level streaming would 10x the row count for zero benefit. Phase 06 revisits this when the SSE layer exists.

**Why skip `init` rows.** The phase 02 check constraint doesn't include a `system` or `init` type. Rather than expand the constraint, the runtime reads `session_id` from the init message and writes it directly to `task_runs.session_id` — one scalar update, no event row.

### 4. Task-runtime queries — `db/queries/task-runtime.ts`

Five small helpers. Each is a single SQL statement via Drizzle. Exported as named async functions.

```ts
createTask({ prompt, maxBudgetUsd?, maxTurns?, createdBy?, metadata? }): { id }
createTaskRun({ taskId, attempt? }): { id }
appendTaskEvent({ runId, taskId, seq, type, payload }): void
updateTaskRunSession({ runId, sessionId }): void
finalizeRun({ runId, status: 'done' | 'failed', cost, inputTokens, outputTokens, error? }): void
finalizeTask({ taskId, status: 'done' | 'failed', completedAt? }): void
```

Each helper is intentionally small so the runtime orchestration in `runtime.ts` reads like pseudocode. No transactions — if a row write fails mid-stream, the run row is left in `in_progress`; the demo script surfaces this as an error and exits non-zero. Phase 06 will revisit durability (inngest retry semantics).

**`appendTaskEvent`** returns `void` intentionally. The caller owns `seq` — having the helper auto-increment would require either a reserved-row table lock (expensive) or a best-effort `MAX(seq) + 1` read (racy). Callers that stream events from a single `query()` iterator are serial by construction; passing `seq` from the caller keeps the SQL trivial.

### 5. Orchestrator runtime — `lib/agent/runtime.ts`

Single exported function. No class, no private state; the SDK's async iterator is the state machine.

```ts
import { query } from '@anthropic-ai/claude-agent-sdk';
import { memoryMcpServer, RECALL_TOOL_FQN, WRITE_TOOL_FQN,
         REINFORCE_TOOL_FQN, FORGET_TOOL_FQN } from '@/lib/mcp/memory';
import { fleetAnalyst, FLEET_ANALYST_NAME } from '@/lib/agent/fleet-analyst';
import { auditPreToolUse } from '@/lib/agent/hooks';
import { mapMessageToEvents } from '@/lib/agent/persist';
import * as tr from '@/db/queries/task-runtime';

export type RunOrchestratorArgs = {
  prompt: string;
  maxBudgetUsd?: number;    // default 0.50
  maxTurns?: number;        // default 20
  maxThinkingTokens?: number; // default 8192
  createdBy?: string;       // 'cli' for demo
  onEvent?: (e: TaskEventInput & { seq: number }) => void; // for demo stdout
};

export type RunOrchestratorResult = {
  taskId: string;
  runId: string;
  sessionId: string | null;
  status: 'done' | 'failed';
  totalCostUsd: number;
  numTurns: number;
  finalText: string | null;
  errorText: string | null;
};

export async function runOrchestrator(args: RunOrchestratorArgs): Promise<RunOrchestratorResult>;
```

#### Flow (one call = one `query()` invocation = one `task_run`)

1. `createTask({ prompt, maxBudgetUsd, maxTurns, createdBy })` → `taskId`.
2. `createTaskRun({ taskId })` → `runId`. (`status` defaults to `in_progress`.)
3. Build `options`:
   ```ts
   {
     model: 'claude-sonnet-4-6',              // full ID — orchestrator only
     agents: { [FLEET_ANALYST_NAME]: fleetAnalyst },
     allowedTools: [
       'Agent', 'Read',
       RECALL_TOOL_FQN, WRITE_TOOL_FQN, REINFORCE_TOOL_FQN, FORGET_TOOL_FQN,
     ],
     mcpServers: { memory: memoryMcpServer },
     hooks: { PreToolUse: [{ matcher: '.*', hooks: [auditPreToolUse] }] },
     permissionMode: 'default',
     maxBudgetUsd: args.maxBudgetUsd ?? 0.50,
     maxTurns: args.maxTurns ?? 20,
     maxThinkingTokens: args.maxThinkingTokens ?? 8192,
     settingSources: ['project'],             // picks up .claude/CLAUDE.md + agents
     cwd: process.cwd(),
   }
   ```
4. `let seq = 0; let sessionId: string | null = null; let totals = { ... };`
5. `for await (const msg of query({ prompt: args.prompt, options }))`:
   - If `msg.type === 'system' && msg.subtype === 'init'`: record `sessionId = msg.session_id`; call `updateTaskRunSession({ runId, sessionId })`.
   - Else: compute `events = mapMessageToEvents(msg)`; for each, `appendTaskEvent({ runId, taskId, seq, ...e })`, then `args.onEvent?.({ seq, ...e })`, then `seq++`.
   - On `SDKResultMessage` (type `'result'`): capture `total_cost_usd`, `usage.input_tokens`, `usage.output_tokens`, `num_turns`, `result` (if success), `errors` (if error). Continue iterating — the `for await` will end after result.
6. On loop end:
   - `finalizeRun({ runId, status: resultWasSuccess ? 'done' : 'failed', cost, inputTokens, outputTokens, error })`.
   - `finalizeTask({ taskId, status: resultWasSuccess ? 'done' : 'failed', completedAt: new Date() })`.
7. Return `{ taskId, runId, sessionId, status, totalCostUsd, numTurns, finalText, errorText }`.

On throw (network, auth, etc.), catch at the top: best-effort `finalizeRun({ status: 'failed', error: e.message })` and re-throw. The caller (demo script or test) sees the error.

**`permissionMode: 'default'`.** Explicit. Phase 07 changes this pattern via `canUseTool`.

**Why `settingSources: ['project']`.** Plan §3 — enables project-scoped CLAUDE.md auto-discovery so the orchestrator reads repo context. The existing `.claude/settings.json` (git-guardrails Bash hook) is also loaded, but `Bash` is not in the orchestrator's `allowedTools` so the guardrails hook is never fired from an SDK session. Documented risk below.

**Abort / cancellation.** Not wired in phase 05. The demo runs to completion; Ctrl-C kills the process and the row stays in `in_progress`. Phase 06's task API adds `abortController` + cancellation.

### 6. Env loader edit — `lib/env.ts`

Current `loadEnv()` is called at module import and requires DB + Gemini vars. Agent auth is *not* added to that schema, because tests that don't need `query()` (most of phase 02/03/04) should keep working in CI without Anthropic creds.

New separate helper:

```ts
export type AgentAuthEnv =
  | { kind: 'oauth'; oauthToken: string }
  | { kind: 'gateway'; baseUrl: string; authToken: string }
  | { kind: 'api_key'; apiKey: string };

export function loadAgentAuthEnv(): AgentAuthEnv;
```

`loadAgentAuthEnv()` inspects `process.env` in precedence order:

1. `ANTHROPIC_API_KEY` present → `{ kind: 'api_key', apiKey }`
2. `ANTHROPIC_BASE_URL && ANTHROPIC_AUTH_TOKEN` → `{ kind: 'gateway', baseUrl, authToken }`
3. `CLAUDE_CODE_OAUTH_TOKEN` present → `{ kind: 'oauth', oauthToken }`

If none match, throws with a message naming all three options and pointing at the roadmap's §"Auth for the Agent SDK".

**Precedence matches the SDK's internal resolution** (plan §2: "cloud-provider credentials first, then `ANTHROPIC_AUTH_TOKEN`, then `ANTHROPIC_API_KEY`, then `apiKeyHelper`, then subscription OAuth"). `loadAgentAuthEnv()` doesn't *configure* the SDK — the SDK reads env vars itself — but surfacing precedence in TS prevents silent fallthrough: if a developer has both `CLAUDE_CODE_OAUTH_TOKEN` and `ANTHROPIC_API_KEY` set, they'll think OAuth is being used when the SDK actually uses the API key. `loadAgentAuthEnv()` logs which path is active at startup so the demo output is unambiguous.

**Why not validate at module import.** Phase 05 tests that don't exercise `query()` (mapper tests, hook tests, definition tests) should still pass on a CI machine without any Anthropic creds. Validation lives at `runtime.ts` import time — the first line of `runOrchestrator` calls `loadAgentAuthEnv()`. Tests that want to stub the check can mock the module.

### 7. CLI demo — `scripts/query-demo.ts`

**The phase's visible done signal.** Usage: `pnpm query:demo "<prompt>"` (or no argument for a default fleet-health prompt).

Stages, numbered in stdout:

1. **Announce.** Print auth mode (from `loadAgentAuthEnv`), cap values, the prompt.
2. **Seed.** Write 2 memories (one `identity` — "fleet is 50 lease sedans", one `knowledge` — "5000mi service interval"). Track their ids for cleanup. Tagged `metadata.test_id = 'phase-05-demo'`.
3. **Run.** Call `runOrchestrator({ prompt, onEvent })`. `onEvent` prints a one-line tag per event: `[seq=N] [type=...] summary`. For `tool_call`, summary is `tool_name(input_preview)`; for `assistant_turn`, it's the first 120 chars of text; for `run_result`, it's `$cost, Nturns`.
4. **Verify.** Re-read `task_events` rows for this run. Assert count ≥ 3 (one user_message, one assistant_turn, one run_result at minimum). Print sequence + type table.
5. **Summarize.** Print final text, total cost, duration, token counts from the run row.
6. **Cleanup.** `DELETE FROM memories WHERE metadata->>'test_id' = 'phase-05-demo'`. The task row stays — it's the artifact of the run; useful for inspecting in `pnpm db:studio`.

Runs against the real Neon dev DB + real Gemini + real Anthropic. Not part of `pnpm test`. Invoked manually as `pnpm query:demo`. Exits non-zero on any thrown error or if the final run row's status is `failed`.

**Why the memory seeds.** Without them, the fleet analyst has nothing to recall — the demo would look like a one-shot LLM call. Seeding two memories and picking a prompt that benefits from recalling them exercises the MCP round-trip visibly. The seeds are wiped at the end; the `tasks` / `task_runs` / `task_events` rows stay (portfolio artifact).

### 8. `.env.example` + `README.md` edits

`.env.example`: move the phase-05 auth block out of the "later phases" commented footer into the active section. Keep all three options documented with one-line comments pointing at the roadmap.

`README.md`: add a "Phase 05 — first query" subsection to the Quickstart. Content:
- Which auth env var to set (the three paths, linked to roadmap §"Auth for the Agent SDK").
- How to run: `pnpm query:demo` — what it does in one sentence.
- How to inspect: `pnpm db:studio` → `tasks` / `task_runs` / `task_events` tables.
- A note that `pnpm memory:demo` and `pnpm recall:demo` don't require Anthropic auth; only `query:demo` does.

## Testing

Five vitest files. Unit tests are fast (no DB, no network); integration + live tests are opt-in.

### `tests/agent-definitions.test.ts` (NEW — unit)

Structural checks on `fleetAnalyst` and on the runtime's assembled options record. These tests catch the plan §3 footgun #2 (full model ID on subagent silently falls back to `inherit`) and confirm the allowedTools list stays in sync with the memory FQN constants.

1. `fleetAnalyst.model === 'haiku'` — not `'claude-haiku-4-5'`, not `undefined`.
2. `fleetAnalyst.tools` equals the expected exact list (order matters: Read, recall, write, reinforce).
3. `fleetAnalyst.tools` does NOT include `FORGET_TOOL_FQN`.
4. `fleetAnalyst.maxTurns === 6`; `fleetAnalyst.description` is a non-empty string; `fleetAnalyst.prompt.length > 100`.
5. `FLEET_ANALYST_NAME === 'fleet-analyst'`.
6. A `buildOrchestratorOptions()` helper (extracted from `runtime.ts` for test visibility) returns an `Options` whose `model === 'claude-sonnet-4-6'` (full ID, orchestrator only), `allowedTools` includes `Agent` + all four memory FQNs + `Read`, and `agents[FLEET_ANALYST_NAME]` is the exported fleetAnalyst.

### `tests/agent-hooks.test.ts` (NEW — unit)

Shape tests for `auditPreToolUse`. Pure — spies on `console.error`, constructs fixture inputs.

1. Returns `{ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }` for every input.
2. Logs a line to stderr containing `tool=` + the tool name.
3. For inputs with `agent_id` set, log prefix is `subagent <agent_type>`; without, it's `orchestrator`.
4. Long `tool_input` (mock 1536-element array) truncates to ≤ 200 chars in the log.
5. Does not throw on `tool_input === null` or missing `tool_use_id`.

### `tests/agent-persist.test.ts` (NEW — unit)

Pure mapper. Fixture SDK messages → expected event arrays. Around 20 assertions across 8 cases.

1. `SDKSystemMessage (init)` → empty array.
2. `SDKAssistantMessage` with one text block → 1× `assistant_turn`.
3. `SDKAssistantMessage` with text + one tool_use → 1× `assistant_turn` + 1× `tool_call`. Order: assistant_turn first.
4. `SDKAssistantMessage` with two tool_use blocks → 1× `assistant_turn` + 2× `tool_call` (block ids distinct).
5. `SDKUserMessage` with a string content (plain human prompt) → 1× `user_message`.
6. `SDKUserMessage` with a tool_result array content → 1× `tool_result` per block; payloads include `tool_use_id`, `is_error`, `content`.
7. `SDKCompactBoundaryMessage` → 1× `compact_boundary`; payload includes `compact_metadata`.
8. `SDKResultMessage` success → 1× `run_result`; payload includes `total_cost_usd`, `num_turns`, `usage`, `result`.
9. `SDKResultMessage` error (`error_max_budget_usd`) → 1× `run_result`; payload `subtype` matches and `errors` array is preserved.
10. Unknown message type (`tool_progress`, `stream_event`, `rate_limit_event`) → empty array. No throws.

### `tests/agent-runtime.test.ts` (NEW — [live] skipped by default)

One `describe.skip('[live] Haiku round-trip', …)` block. Un-skipped manually before merging. Requires an Anthropic auth path + a DB.

1. `runOrchestrator({ prompt: 'Say "ok" and nothing else.', maxBudgetUsd: 0.10, maxTurns: 3 })` returns with `status === 'done'`.
2. The run row has `session_id` non-null, `total_cost_usd > 0`, `ended_at` set within 30s.
3. `task_events` for the run: ≥ 1 `user_message`, ≥ 1 `assistant_turn`, exactly 1 `run_result`, all with contiguous `seq` values starting at 0.
4. The `run_result` event's payload `total_cost_usd` equals the task_runs row's `total_cost_usd`.
5. Cleanup: `DELETE FROM task_events WHERE run_id = $1; DELETE FROM task_runs WHERE id = $1; DELETE FROM tasks WHERE id = $1`.

Skip reason: `describe.skip` prefix; the CI machine doesn't have Anthropic auth. Un-skip locally before the PR review.

### `tests/env.test.ts` (NEW — unit)

Isolated env-var precedence tests. Uses `vi.stubEnv` to set / unset env vars around each case; restores via `afterEach(() => vi.unstubAllEnvs())`.

1. Only `ANTHROPIC_API_KEY` set → returns `{ kind: 'api_key', apiKey }`.
2. Only `CLAUDE_CODE_OAUTH_TOKEN` set → returns `{ kind: 'oauth', oauthToken }`.
3. Only `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` set → returns `{ kind: 'gateway', … }`.
4. `ANTHROPIC_BASE_URL` set without `ANTHROPIC_AUTH_TOKEN` → falls through; if no other var set, throws.
5. `ANTHROPIC_API_KEY` + `CLAUDE_CODE_OAUTH_TOKEN` both set → returns `api_key` (precedence). Includes a log assertion: a console-error call tells the user OAuth is being shadowed.
6. None set → throws with message naming all three paths.

## Acceptance criteria

All must pass before the phase 05 PR merges:

1. `pnpm typecheck` passes with `noUncheckedIndexedAccess`.
2. `pnpm lint` passes.
3. `pnpm test` passes: all phase 02/03/04 suites still green; new suites all green (`agent-definitions` 6/6, `agent-hooks` 5/5, `agent-persist` 10/10, `env` 6/6). `[live]` runtime test remains skipped in CI.
4. `pnpm build` passes — phase 01 `/health` route still renders. (Phase 05 adds no routes; this is a regression check.)
5. `pnpm query:demo` end-to-end: with a valid Anthropic auth path and DB, a single run completes with `status: 'done'`, prints at least `user_message`, `assistant_turn`, and `run_result` events in sequence, reports a non-zero cost under $0.50, and cleanly deletes the seed memories. Exits 0.
6. Un-skipped `[live]` Haiku test in `tests/agent-runtime.test.ts` passes locally once, before the PR is opened.
7. `fleetAnalyst.model === 'haiku'` (short alias); `buildOrchestratorOptions().model === 'claude-sonnet-4-6'` (full ID).
8. `task_events` rows produced by `runOrchestrator`: contiguous `seq` from 0, only the 6 types allowed by the phase-02 check constraint appear (`user_message`, `assistant_turn`, `tool_call`, `tool_result`, `compact_boundary`, `run_result` — `approval_request` stays unused).
9. `auditPreToolUse` fires on every tool call in the demo run (stderr log count ≥ tool_call event count).
10. `loadAgentAuthEnv()` throws when all three auth env vars are unset; returns the correct `kind` + payload when any one is set.
11. Worktree git identity verified: `git config user.name` → `shahriarbijoy`, `git config user.email` → `shahriarbijoy@gmail.com`.
12. `README.md` Quickstart gains a Phase 05 section mentioning `pnpm query:demo` and the three auth paths.
13. `.env.example` documents all three auth paths in its active section.
14. No new dependencies in `package.json` — phase 05 adds zero packages.
15. SDK pin remains exactly `@anthropic-ai/claude-agent-sdk@0.2.117` (plan §3: pin aggressively).

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `AgentDefinition.model` typo (full ID instead of short alias) slips in, subagent silently runs on Sonnet, cost quietly doubles | Medium | `tests/agent-definitions.test.ts` case 1 asserts `fleetAnalyst.model === 'haiku'` — exact string match, not just `startsWith`. Plan §3 footgun #2. |
| `.claude/settings.json` git-guardrails Bash hook fires inside an SDK session because `settingSources: ['project']` loads it | Low | The orchestrator's `allowedTools` excludes `Bash`; the guardrails hook can't be triggered from within a `query()` session. If phase 06+ adds Bash to allowedTools, revisit: either scope the guardrails matcher to skip agent-sourced calls, or move them to a non-project settings file. |
| Phase 02's `task_events.type` check constraint rejects a mapper output | Low (bounded) | Mapper only emits one of the 6 constraint-approved types. Test 10 in `agent-persist.test.ts` pins all unknown SDK message types to empty arrays. CI guards against drift. |
| SDK 0.2.117 has the early-alpha `createSdkMcpServer().connect()` missing bug (plan §3) | Low (pinned) | Pin is already past 0.1.8. `tests/mcp-memory.test.ts` from phase 03 asserts the server instance has `.connect`. If a future dependency update touches the SDK, this test will catch regressions. |
| `for await (const msg of query(…))` throws inside the loop; `finalizeRun` isn't called; task row sticks at `in_progress` forever | Medium | Top-level try/catch in `runOrchestrator` writes `status='failed'` + error message to both run and task rows before re-throwing. Demo script exits non-zero. Tests cover both happy-path and auth-failure cases. |
| `maxBudgetUsd` / `maxTurns` caps don't fire as expected because SDK semantics drifted in 0.2.117 | Low | Defensive: the demo uses **both** caps (`maxBudgetUsd: 0.50`, `maxTurns: 20`). The `[live]` test sets `maxBudgetUsd: 0.10` — if a regression makes the cap non-functional, the test either overruns the DB row-count assertion or burns $0.10 of actual cost, both of which are visible. |
| Env-var precedence mismatch between TS loader and SDK runtime: developer sets `CLAUDE_CODE_OAUTH_TOKEN` + `ANTHROPIC_API_KEY`, `loadAgentAuthEnv()` says "api_key" but the SDK actually routes through OAuth | Medium | TS precedence is documented to *match* the SDK's documented precedence (`ANTHROPIC_API_KEY` > OAuth). If the SDK's runtime behavior differs, `loadAgentAuthEnv()` logs at startup which path it thinks is active — a mismatch will be visibly wrong in the demo output, not silent. |
| `onEvent` callback in demo throws (stdout EPIPE on a broken pipe) and unwinds through the for-await, aborting the run with a half-written state | Very low | `onEvent` is wrapped in try/catch inside `runtime.ts`; stdout errors are swallowed; the loop continues. |
| Subagent resumption bug (plan §3: `claude-code` #10856 — subagents fork from checkpoint instead of accumulating context) | N/A in phase 05 | Phase 05 never resumes. Every `pnpm query:demo` starts fresh. Flagged for phase 06 when session resume lands. |
| `settingSources: ['project']` fails at session start if `.claude/` has files the SDK can't parse | Low | The repo's current `.claude/settings.json` and `.claude/hooks/git-guardrails.sh` are standard Claude Code formats. The `[live]` test exercises this; a parse failure will surface as an init-message error on the very first run. |

## What unlocks next

Phase 05 passing unlocks **phase 06 (task API + SSE timeline)**, which:

1. Exposes `runOrchestrator` behind `POST /api/tasks` via a Server Action that dispatches an Inngest event.
2. Tails `task_events` rows (already written by phase 05's `appendTaskEvent`) from a `force-dynamic` SSE route.
3. Renders the 6 event types as React components (`<UserMessage>`, `<AssistantTurn>`, `<ToolCall>`, `<ToolResult>`, `<CompactBoundary>`, `<RunResult>`) — the payload shapes `persist.ts` writes are already aligned with these.

Phase 07 (HITL) uses:

1. `hooks.ts`'s pattern — a `canUseTool` callback alongside `auditPreToolUse` in `runtime.ts`'s options.
2. The `approval_gates` table (phase 02) + Inngest `waitForEvent` around the gate.
3. `fleetAnalyst`'s deliberate omission of `FORGET_TOOL_FQN`: phase 07 adds it back with `destructiveHint: true` (phase 04 annotation) routing the call through the approval gate.

Phase 08 (11-agent swarm) uses:

1. `fleet-analyst.ts` as the template for ten more sibling definitions.
2. `runtime.ts`'s `agents` option — flat fan-out, one orchestrator delegating via the Agent tool, no nesting (plan §3 gotcha #1).

Phase 12 (observability) uses:

1. `auditPreToolUse` as the anchor for OpenInference spans — every tool call already routes through one place.
2. `persist.ts`'s mapper emits payload shapes suitable for Langfuse attribute export.
