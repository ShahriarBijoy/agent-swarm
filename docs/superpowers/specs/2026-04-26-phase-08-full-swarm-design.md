# Phase 08 — Full 11-agent swarm (design)

**Date:** 2026-04-26
**Status:** approved (phase 07 merged; phase 07.1 schema cleanup merged)
**Plan references:** `auto-ride-initial-plan.md` §1 (architecture), §3 (SDK primitives — `agents` map, short-alias models, `maxBudgetUsd`, `maxTurns`)
**Roadmap entry:** `docs/roadmap/ROADMAP.md` — phase 08

## Purpose

Phase 08 turns the single-worker swarm from phase 05 (orchestrator + `fleet-analyst`) into the **full 11-agent swarm** the project is named after. The dispatcher routes user prompts to one of ten specialised workers, each with its own model tier, tool surface, and budget. Memory continues to be the lever every agent pulls — `recall` before answering, `write`/`reinforce` after — so the cleanup debate in phase 09 has real corpus to chew on.

Three concrete things ship together because they're tightly coupled and none is useful alone:

1. **Ten worker `AgentDefinition`s** under `lib/agent/agents/`, registered through a typed `index.ts` registry that `buildOrchestratorOptions` consumes. Every worker uses the SDK's short-alias `model` field (`'haiku'` | `'sonnet'`) — full IDs silently fall back to `'inherit'` and burn the orchestrator's tier (plan §3 footgun #2).
2. **A dispatcher upgrade** at the top-level `query()` call: orchestrator model becomes `'claude-opus-4-7'` (full ID — full IDs are accepted on the orchestrator, only short aliases on subagents). The dispatcher's job is routing, not domain work; its prompt is rewritten around picking the right worker via the `Agent` tool.
3. **Per-agent observability + approval gates.** Every event that `lib/agent/persist.ts` writes to `task_events` gets a new `payload.agent_name` field derived from the SDK's `parent_tool_use_id` chain. The phase-07 approval-policy module learns three new gated path patterns — `dispatch-log/`, `invoices/`, `replies/` — so demo writes from `incident-responder`, `billing`, and `support` flow through the same Inngest gate the rest of the project trusts.

Phase 09 (nightly cleanup) consumes the broader memory write population this swarm produces. Phase 10 (org chart + dashboards) reads `payload.agent_name` to colour timeline events by agent and graph per-agent metrics. Phase 11 (auth) and phase 12 (sandbox + Langfuse) don't depend on this phase.

## Non-goals

Explicitly out of scope for phase 08 — resist adding them even when the diff feels short:

- **New MCP servers.** No `mcp__dispatch__*`, no `mcp__billing__*` stub server, no `mcp__support__*`. Workers exercise their domain through `Read`/`Grep`/`Glob`, the four memory tools, whitelisted `Bash`, and gated `Write`s to fictional output paths. Approach 2 (a stub MCP per domain) is a phase 12+ refactor, not a phase 08 detour.
- **Real domain integrations.** No Gmail, no GitHub Issues, no Stripe. The "billing" agent does not actually charge anybody; it writes to `invoices/` and the gate decides. Memory project `project_real_accounts_post_v1.md` covers the post-v1 plan.
- **Hard per-agent dollar enforcement.** The SDK's `maxBudgetUsd` is a *whole-run* cap, not a per-agent cap. Phase 08 documents and **logs** a soft per-agent dollar budget via `task_events` (see §6.2) but does not abort an agent when it overshoots. Phase 12 adds the cost-aggregator middleware that turns the soft budget into a hard one.
- **Nested subagents.** The SDK's `agents` map is flat — a worker cannot itself call `Agent` to spawn a sub-worker (well, it *can* if `Agent` is in its tool list, but the resulting graph is fragile and re-entry through `parent_tool_use_id` chains complicates persistence). Phase 08 keeps the topology two layers deep: dispatcher → workers, fan-out only.
- **Memory governance / auto-cleanup.** A `memory-curator` worker was discussed and **deliberately dropped**. Reasons: (a) keeping the agent count honest at 1 dispatcher + 10 workers = 11; (b) memory governance belongs in the nightly debate (phase 09), not in an interactive worker that could race with the cleanup runs.
- **Per-tool / per-agent approval policy UI.** Hard-coded in `lib/agent/approval-policy.ts`, same as phase 07. Admin UI lands in phase 10 with the dashboards.
- **A worker registry MCP exposed to the dispatcher.** The `agents` map *is* the registry the SDK reads; we don't surface it as a tool the dispatcher can introspect. The dispatcher learns the available workers through its system prompt, which lists each worker's name and one-line `description` (which is what the SDK's `Agent` tool already shows the model anyway).
- **Streaming dispatcher status to the UI ("dispatcher is thinking…", "spawned billing").** The phase-06 SSE feed already carries `assistant_turn` + `tool_call` events; the org chart in phase 10 derives "agent X is busy" from the open `tool_call` rows. No phase-08-specific UI work.
- **Run-level cost dashboards.** The `task_runs.total_cost_usd` aggregate already exists from phase 05. Per-agent breakdowns are a phase-10 read; phase 08 only ensures the rows are *taggable*, not visualised.

## Cost check

This project runs on a **Claude Max subscription via OAuth** (per `auto-ride-initial-plan.md` §2 carve-out + `docs/roadmap/ROADMAP.md` §"Auth for the Agent SDK") — Anthropic doesn't bill per run, usage is metered against the Max plan's 5-hour token quota. The dollar figures the SDK reports in `task_runs.total_cost_usd` are therefore **notional**: they're the what-it-would-have-cost-on-the-API number, useful as a relative yardstick (Opus vs Haiku, dispatcher vs worker) and — crucially — as the input to the SDK's `maxBudgetUsd` cap, which still aborts a runaway run because it consults that same notional figure. **No real $ is charged for this phase.**

- **Notional per-run cost** (what `task_runs.total_cost_usd` will show): dispatcher = Opus 4.7. A demo run touching three workers and one approved gate reports **~$0.20–$0.40**; a full seven-worker fan-out reports **~$0.80–$1.20**. The default `DEFAULT_MAX_BUDGET_USD = 1.5` cap aborts before the third Opus turn if the dispatcher loops — that safety property holds on Max too, since the SDK uses the notional figure for the check.
- **Real cost on Max:** the run draws from the Max plan's rolling token quota. A pathological loop is the only realistic way to hit the quota during phase-08 iteration; `maxBudgetUsd` + `maxTurns: 25` make that hard.
- **If Auto-ride ever turns commercial** (Anthropic's Feb 2026 terms prohibit Max OAuth for commercial Agent SDK use — `auto-ride-initial-plan.md` §2), the user switches to an `ANTHROPIC_API_KEY` and the notional figures become real dollars. The numbers above apply unchanged — pre-budget for **< $20** API spend across phase-08-equivalent iteration in that mode.
- **Gemini embeddings:** unchanged — every worker that calls `recall` embeds one query, well under the free tier.
- **Neon:** no new tables, no new indexes. The `task_events` row count grows ~3× per run because we have ~3× the agent activity, but the existing `(run_id, seq)` btree handles 10⁵ rows per run cleanly.
- **Inngest:** the existing `taskStartedFn` from phase 07 unchanged; one function invocation per task, however many workers the orchestrator spawns inside.

## Dependencies

**Zero new runtime packages.** Every worker uses tools that already exist (`Read`, `Grep`, `Glob`, `Bash`, `Write`, the four `mcp__memory__*` tools, the `Agent` tool on the dispatcher).

**No new env vars.** No schema migration. No `package.json` change.

**Versions** (pinned; phase 08 does not bump):

- `@anthropic-ai/claude-agent-sdk` — pinned at the phase-07 version. Bumping the SDK is a phase-of-its-own because of alpha churn (plan §3).
- `inngest` — pinned at the phase-07 version. Phase 08 doesn't touch Inngest functions.

**Schema:** unchanged. Phase 02 + 07.1 already provisioned every column phase 08 uses. Specifically:

- `task_events.payload` is `jsonb`, so `payload.agent_name` is a free addition — no migration.
- `approval_gates` row shape unchanged.
- `task_runs.total_cost_usd` aggregate is the existing per-run figure; per-agent slicing is a future read query, not a column add.

## Directory layout (delta from phase 07)

```
Agent-swarm/
├── lib/
│   └── agent/
│       ├── agents/                                          # NEW directory
│       │   ├── analytics-reporter.ts                        # NEW
│       │   ├── billing.ts                                   # NEW
│       │   ├── compliance-auditor.ts                        # NEW
│       │   ├── driver-coach.ts                              # NEW
│       │   ├── fleet-analyst.ts                             # MOVED from lib/agent/fleet-analyst.ts
│       │   ├── incident-responder.ts                        # NEW
│       │   ├── index.ts                                     # NEW — registry + name union type
│       │   ├── maintenance-planner.ts                       # NEW
│       │   ├── reflector.ts                                 # NEW
│       │   ├── route-optimizer.ts                           # NEW
│       │   └── support.ts                                   # NEW
│       ├── approval-policy.ts                               # EDIT — three new gated path patterns + registry
│       ├── options.ts                                       # EDIT — Opus 4.7, larger defaults, agents from registry
│       ├── persist.ts                                       # EDIT — agent_name tagging via parent_tool_use_id
│       ├── runtime.ts                                       # EDIT — pass parent_tool_use_id chain map to persist
│       └── (fleet-analyst.ts deleted)                       # MOVED
├── tests/
│   ├── agents/                                              # NEW directory
│   │   ├── definitions.test.ts                              # NEW — per-agent prompt/tool/model invariants
│   │   └── registry.test.ts                                 # NEW — registry shape + headcount + uniqueness
│   ├── agent-definitions.test.ts                            # DELETE — split into agents/{registry,definitions}
│   ├── agent-options.test.ts                                # NEW — Opus model + larger defaults regression
│   ├── agent-persist.test.ts                                # EDIT — agent_name derivation tests
│   └── approval-policy.test.ts                              # EDIT — dispatch-log / invoices / replies matrix
└── docs/superpowers/
    ├── specs/2026-04-26-phase-08-full-swarm-design.md       # NEW — this file
    └── plans/2026-04-26-phase-08-full-swarm-plan.md         # NEW (next session, via writing-plans)
```

**Why move `fleet-analyst.ts` into `agents/`:** the registry pattern only works if every worker lives under one directory and is exported through one `index.ts`. Leaving `fleet-analyst.ts` at `lib/agent/fleet-analyst.ts` would make the registry import asymmetric and tempt future workers to pick the wrong location. The move is one file rename plus a single import update in `lib/agent/options.ts` and the existing `tests/agent-definitions.test.ts` (which we're splitting anyway).

## 1. Topology

```
                                          ┌──────────────────────────────┐
                                          │   query() in runtime.ts      │
                                          │   model: claude-opus-4-7     │
                                          │   tools: Agent, Read,        │
                                          │     mcp__memory__*           │
                                          │   maxBudgetUsd: 1.5          │
                                          │   maxTurns: 25               │
                                          └──────────────┬───────────────┘
                                                         │ Agent(...)
            ┌────────────────────────────────────────────┼────────────────────────────────────────────┐
            │            │            │            │    │    │            │            │            │            │
            ▼            ▼            ▼            ▼    ▼    ▼            ▼            ▼            ▼            ▼
     ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ ┌────────┐ ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
     │ fleet-   │  │ maint-   │  │ billing  │  │support │ │reflectr│ │ route-   │  │ incident-│  │ driver-  │  │compliance│  │analytics-│
     │ analyst  │  │ planner  │  │ (sonnet) │  │(sonnet)│ │(sonnet)│ │ optimizer│  │ responder│  │ coach    │  │ auditor  │  │ reporter │
     │ (haiku)  │  │ (sonnet) │  │          │  │        │ │        │ │ (haiku)  │  │ (sonnet) │  │ (haiku)  │  │ (haiku)  │  │ (haiku)  │
     └──────────┘  └──────────┘  └──────────┘  └────────┘ └────────┘ └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘

  1 dispatcher (Opus 4.7, full ID) + 10 workers in options.agents = 11-agent swarm.
  Workers do NOT call Agent. The graph is exactly two layers deep. Fan-out only.
```

**Why "1 + 10 = 11" and not "11 in the agents map":** the SDK's `agents` field describes the **subagents the orchestrator can spawn**. The orchestrator itself is the `query()` caller, with its own `model`. Stuffing the dispatcher into `agents` would either spawn it as a subagent of itself (recursion) or never get used (the orchestrator is invoked separately). Counting the dispatcher = the headcount stays honest with the project name.

**Why no nested subagents:** the SDK's `parent_tool_use_id` chain becomes deep, persistence keys (`payload.agent_name`) become harder to derive cleanly, and resumption gets fragile (plan §3 issue #10856). Phase 08 keeps fan-out flat. If a workflow genuinely needs `support → billing` chaining, the dispatcher chains them — `support` returns its result, dispatcher reads it, dispatcher invokes `billing` next.

## 2. Agent set (the ten workers)

Final list. Order is the order they appear in the registry (which is the order they appear in the dispatcher's prompt, which subtly biases the model toward the earlier ones — a feature, not a bug, for the demo).

| # | Name (`agent_name`)    | Model  | maxTurns | Soft $ | Tools (beyond memory four)                                | Demo intent |
|---|------------------------|--------|----------|--------|------------------------------------------------------------|-------------|
| 1 | `fleet-analyst`        | haiku  | 6        | 0.05   | `Read`, `Grep`                                             | "What's the utilization of vehicle V-12?" |
| 2 | `maintenance-planner`  | sonnet | 8        | 0.20   | `Read`, `Grep`, `Write` (gated by source-tree policy)      | "Schedule the brake service for the rear axle fleet." |
| 3 | `billing`              | sonnet | 6        | 0.20   | `Read`, `Write` (gated, must target `invoices/`)           | "Generate invoice for trip T-998." |
| 4 | `support`              | sonnet | 8        | 0.25   | `Read`, `Write` (gated, must target `replies/`)            | "Draft a reply to the customer email about lost-and-found." |
| 5 | `reflector`            | sonnet | 6        | 0.15   | `Read`; only worker that can call `mcp__memory__forget`    | "What did we learn this week that contradicts older notes?" |
| 6 | `route-optimizer`      | haiku  | 6        | 0.05   | `Read`, `Grep`                                             | "Best 3-stop order for driver D-04 on Friday morning?" |
| 7 | `incident-responder`   | sonnet | 8        | 0.25   | `Read`, `Write` (gated, must target `dispatch-log/`), `Bash` (whitelisted only) | "Vehicle V-09 just went offline; triage." |
| 8 | `driver-coach`         | haiku  | 6        | 0.05   | `Read`, `Grep`                                             | "Driver D-12 had a hard-brake event yesterday — coaching note?" |
| 9 | `compliance-auditor`   | haiku  | 6        | 0.05   | `Read`, `Grep`                                             | "Are any vehicles overdue on inspection?" |
| 10| `analytics-reporter`   | haiku  | 6        | 0.05   | `Read`, `Grep`                                             | "Top 5 most-utilized routes last month?" |

Every worker has the four memory tools (`mcp__memory__recall`, `mcp__memory__write`, `mcp__memory__reinforce`, and **only the reflector** has `mcp__memory__forget`). The forget-only-on-reflector rule mirrors phase-04's policy (destructive operations are scoped to the reflective agent, never to interactive workers).

### 2.1 Model tier rationale

- **Haiku for read-mostly workers** (fleet-analyst, route-optimizer, driver-coach, compliance-auditor, analytics-reporter): they retrieve, summarise, and tag-reinforce. The corpus is small; the answer surface is structured. Haiku 4.5 is enough.
- **Sonnet for synthesis / authoring workers** (maintenance-planner, billing, support, reflector, incident-responder): they write — schedules, invoices, replies, log entries. They also branch on edge cases (overdue inspection? two billing addresses?). Sonnet 4.6 is the floor.
- **Opus only on the dispatcher.** The dispatcher's job is to read a free-form prompt and pick the right worker — that's a routing decision under uncertainty, exactly Opus's wheelhouse. Putting Opus on a worker would 5–10× the token cost of that worker without buying meaningful quality on its narrow job.

### 2.2 Why these ten and not others

Quick "considered and rejected" log so the registry doesn't drift via vibes:

- ❌ **`memory-curator`** — overlaps with phase-09's nightly debate; the debate has the right shape (multi-model, judgement-required) for memory cleanup, an interactive worker doesn't.
- ❌ **`onboarding-coach`** — too close to `driver-coach`; dispatcher would never disambiguate cleanly.
- ❌ **`fleet-coordinator`** — vague routing target; "coordinate" overlaps with the dispatcher itself.
- ❌ **`cost-tracker`** — phase 10 covers this with the dashboard; doesn't need a worker.
- ❌ **`emergency-dispatch`** — collapsed into `incident-responder` (one worker that owns the whole "something went wrong on the road" surface).

These rejections are documented here so the registry test enforces "exactly ten, exactly these names" — if a future phase wants to add an eleventh worker, the headcount math (1 + 10 = 11) breaks and the spec change is forced through a new design doc.

## 3. Tool surface (Approach 1 — minimal)

Two approaches were considered:

| | Approach 1 — minimal | Approach 2 — stub MCP servers |
|---|---|---|
| New code | Just `agents/*.ts` files + registry | + 5–6 `createSdkMcpServer` calls + tool schemas |
| Demo realism | Workers act on fictional output dirs (`invoices/foo.json`) | Workers call typed `mcp__billing__create_invoice` etc. |
| Approval-gate complexity | Reuse `Write` gate via path patterns | Each MCP tool gets its own approval policy entry |
| Cost to phase 12 | Replace path-pattern Writes with real MCP calls | Replace stub MCP with real MCP — already typed |
| Phase 08 LOC | ~600 lines | ~1,500 lines |

**Chosen: Approach 1.** The phase 08 *novelty* is the swarm shape, not the tool surface. Approach 2's stubs would mostly duplicate the memory MCP scaffolding and inflate the phase. Phase 12 (which already needs real domain integrations) is the natural place to introduce typed MCP tools per domain.

**Concretely**, every worker's `tools` field draws from this fixed pool:

| Tool                            | Owner       | Notes |
|---------------------------------|-------------|-------|
| `Read`                          | every worker| Used to inspect fictional state files (`fleet/vehicles/v-12.json`, `routes/r-04.md`) |
| `Grep` / `Glob`                 | most readers| Used by analyst-style workers to scan the fixture directory |
| `Bash` (whitelisted)            | `incident-responder` only | Phase-07 whitelist (`ls`, `git status`, `pnpm test`, etc.) — never `rm`, never `curl` |
| `Write`                         | 4 workers, gated | `maintenance-planner`, `billing`, `support`, `incident-responder` — **always** gated by `lib/agent/approval-policy.ts` |
| `mcp__memory__recall`           | every worker| |
| `mcp__memory__write`            | every worker| |
| `mcp__memory__reinforce`        | every worker| |
| `mcp__memory__forget`           | `reflector` only | Destructive — phase-04 / phase-07 convention |

The dispatcher's tools are different: `Agent` (to spawn a worker), `Read` (to inspect input fixtures), `mcp__memory__*` (to recall / write at the dispatcher level). The dispatcher does **not** have `Bash` or `Write`; if it ever needs to write something, it dispatches to `incident-responder`.

## 4. Approval policy extension

Phase 07 gates `Write` via `isSourcePath()` (anything under `src/`). Phase 08 adds three more gated path patterns so the demo writes from worker output flow through the same Inngest gate.

Edit to `lib/agent/approval-policy.ts`:

```ts
const INPUT_PREVIEW_LIMIT = 80;

/**
 * Phase-08 gated output paths. Every worker that "produces a deliverable" in
 * the demo writes here; each path is fictional (no real Stripe call, no real
 * email send) but the approval contract is real and the Inngest wait
 * survives a Next.js restart.
 */
export const GATED_OUTPUT_PATHS: readonly RegExp[] = [
  /(^|[\\/])dispatch-log[\\/]/,
  /(^|[\\/])invoices[\\/]/,
  /(^|[\\/])replies[\\/]/,
];

export function isGatedOutputPath(path: string): boolean {
  return GATED_OUTPUT_PATHS.some((rx) => rx.test(path));
}

// inside shouldRequireApproval — Write branch:
if (toolName === 'Write') {
  const path = readString(input, 'file_path');
  if (path === null) {
    return { require: true, reason: 'Write without a file_path field.' };
  }
  if (isSourcePath(path)) {
    return { require: true, reason: `Write to source tree: ${path}` };
  }
  if (isGatedOutputPath(path)) {
    return { require: true, reason: `Write to gated output path: ${path}` };
  }
  return { require: false };
}
```

Memory writes (`mcp__memory__write`, `mcp__memory__reinforce`, `mcp__memory__forget`) deliberately stay **un-gated** — they are the project's whole point and gating them would turn every demo into a click-fest. Memory destructiveness is bounded by phase 04's tombstone-not-delete + phase 09's adversarial cleanup, not by approval gates.

**Per the ROADMAP §"SDK gating contract" rules**:

1. The orchestrator's `allowedTools` continues to **exclude** `Bash` and `Write` so the canUseTool gate fires for them. The phase-07 list (`Agent`, `Read`, four memory tools) is unchanged — Opus 4.7 doesn't need anything else at the top level.
2. The phase-07 audit hook (`auditPreToolUse`) is unchanged — already returns `{}` (no `permissionDecision`), so it doesn't short-circuit `canUseTool`.
3. Phase-07's `canUseTool` callback already echoes `updatedInput` even on plain allow; phase 08 doesn't touch that path.

## 5. Per-agent budget

The SDK exposes two budget primitives:

- **`maxBudgetUsd`** on `Options` — whole-run dollar cap, hard. The SDK aborts the run mid-turn when crossed.
- **`maxTurns`** on `AgentDefinition` — per-agent turn cap, hard. The SDK ends that worker's invocation when the worker emits its `maxTurns`-th assistant turn; control returns to the orchestrator with whatever the worker had assembled.

Phase 08 uses `maxTurns` aggressively (column 4 of the agent table) and accepts that per-agent dollar tracking is **observability-only** until phase 12.

```ts
// lib/agent/options.ts (phase 08)
export const ORCHESTRATOR_MODEL = 'claude-opus-4-7' as const;
export const DEFAULT_MAX_BUDGET_USD = 1.5;          // up from 0.5
export const DEFAULT_MAX_TURNS = 25;                // up from 20
export const DEFAULT_MAX_THINKING_TOKENS = 8192;    // unchanged
```

Why 1.5 and 25:

- **$1.5 ceiling** absorbs a worst-case Opus dispatcher + 7-worker fan-out + one approved gate (which doesn't burn extra Anthropic spend, only an Inngest wait). The phase-05 demo at $0.5 is too tight for any swarm topology — even two haiku workers + one approval round-trip pushes past 0.5 once Opus is dispatching.
- **25 turns** = 1 dispatcher turn + 1 dispatch tool_use per worker + 1 result back + 1 final synthesis ≈ ~4 turns per worker × ~5 workers + 5 slack. If a run hits turn 25, something is wrong (loop, mis-prompted dispatcher) and we *want* the SDK to abort.

The orchestrator's `agents` map sets `maxTurns` per worker (column 4 of the agent table); the SDK enforces them per worker invocation.

## 6. Per-agent observability

### 6.1 `payload.agent_name` on every `task_events` row

`lib/agent/persist.ts` currently produces events without any agent attribution. The SDK does carry the information — every `assistant_turn`, `tool_call`, and `tool_result` includes `parent_tool_use_id`, which is the `tool_use_id` of the `Agent`-tool invocation that spawned the subagent. The orchestrator's own messages have `parent_tool_use_id: null`.

**Derivation rule** (deterministic, no model round-trip):

```
agent_name(event):
  if event.parent_tool_use_id is null:
    return 'dispatcher'
  else:
    look up the matching `tool_call` (where tool_use_id == event.parent_tool_use_id)
    if tool_call.tool_name == 'Agent':
      return tool_call.input.agent_name        // SDK puts it on the Agent tool input
    else:
      // unusual: nested non-Agent parent (shouldn't happen with flat fan-out)
      return 'unknown'
```

Implementation: `runOrchestrator` maintains a `Map<string /* tool_use_id */, string /* agent_name */>` populated when it sees an `Agent` `tool_call` (whose `input.agent_name` is the spawned worker's name). When `mapMessageToEvents` produces an event, the runtime augments each event's `payload.agent_name` from this map by walking the `parent_tool_use_id` once.

```ts
// runtime.ts — sketch
const agentByToolUseId = new Map<string, string>();

function tagAgentName(event: TaskEventInput, parentToolUseId: string | null): TaskEventInput {
  const agentName =
    parentToolUseId === null
      ? 'dispatcher'
      : agentByToolUseId.get(parentToolUseId) ?? 'unknown';
  return { ...event, payload: { ...event.payload, agent_name: agentName } };
}

// when we see a tool_call event for the Agent tool, capture the mapping:
if (ev.type === 'tool_call' && ev.payload.tool_name === 'Agent') {
  const childToolUseId = ev.payload.tool_use_id as string;
  const childAgentName = (ev.payload.input as { agent_name?: unknown })?.agent_name;
  if (typeof childAgentName === 'string') {
    agentByToolUseId.set(childToolUseId, childAgentName);
  }
}
```

The augmentation runs **between** `mapMessageToEvents` and `appendTaskEventAuto` so the existing pure-mapper test suite stays input-output identical (the mapper itself is untouched).

**Why not in the mapper:** the mapper is a pure SDK-message → events function with no I/O. Adding a Map dependency would couple it to runtime state and break the existing fixture-driven tests. Keeping the augmentation in the runtime keeps the mapper testable.

### 6.2 Soft per-agent dollar budget logging

The SDK does not surface per-message dollar costs (only the run-level total in `SDKResultMessage.total_cost_usd`). Phase 08 logs the **soft per-agent budget** in `task_events` once per spawned worker invocation, as part of the `tool_call` payload for `Agent`:

```ts
// when emitting the Agent tool_call event:
{
  type: 'tool_call',
  payload: {
    tool_use_id: '...',
    tool_name: 'Agent',
    input: { agent_name: 'billing', ... },
    agent_name: 'dispatcher',                    // who's calling Agent
    soft_budget_usd: 0.20,                       // looked up from the registry
    parent_tool_use_id: null,
    session_id: '...',
  },
}
```

Phase 10's per-agent metrics page sums `tool_result.usage.cost_usd` (when present) per `agent_name` and shows it next to the `soft_budget_usd` from the spawning `tool_call`. Phase 12's cost-aggregator middleware turns the soft cap into an enforceable one.

## 7. Orchestrator config delta

```ts
// lib/agent/options.ts — full file after phase 08

import type { CanUseTool, Options } from '@anthropic-ai/claude-agent-sdk';
import {
  FORGET_TOOL_FQN,
  MEMORY_SERVER_NAME,
  RECALL_TOOL_FQN,
  REINFORCE_TOOL_FQN,
  WRITE_TOOL_FQN,
  memoryMcpServer,
} from '@/lib/mcp/memory';
import { agentRegistry } from '@/lib/agent/agents';
import { auditPreToolUse } from '@/lib/agent/hooks';

// Opus 4.7 full ID — full IDs ARE accepted on the orchestrator (only short
// aliases are accepted on subagents). Phase 08 promotes the dispatcher.
export const ORCHESTRATOR_MODEL = 'claude-opus-4-7' as const;

export const DEFAULT_MAX_BUDGET_USD = 1.5;
export const DEFAULT_MAX_TURNS = 25;
export const DEFAULT_MAX_THINKING_TOKENS = 8192;

// `allowedTools` is the SDK's auto-allow fast-path (per ROADMAP §"SDK gating
// contract" rule #1). Phase 08 keeps Bash + Write OFF this list so the
// phase-07 canUseTool gate fires for them.
export const ORCHESTRATOR_ALLOWED_TOOLS: readonly string[] = [
  'Agent',
  'Read',
  RECALL_TOOL_FQN,
  WRITE_TOOL_FQN,
  REINFORCE_TOOL_FQN,
  FORGET_TOOL_FQN,
] as const;

export type BuildOrchestratorOptionsOverrides = {
  maxBudgetUsd?: number;
  maxTurns?: number;
  maxThinkingTokens?: number;
  cwd?: string;
  canUseTool?: CanUseTool;
};

export function buildOrchestratorOptions(
  overrides: BuildOrchestratorOptionsOverrides = {},
): Options {
  return {
    model: ORCHESTRATOR_MODEL,
    agents: agentRegistry,                                // <-- was { fleet-analyst: fleetAnalyst }
    allowedTools: [...ORCHESTRATOR_ALLOWED_TOOLS],
    mcpServers: { [MEMORY_SERVER_NAME]: memoryMcpServer },
    hooks: {
      PreToolUse: [{ matcher: '.*', hooks: [auditPreToolUse] }],
    },
    permissionMode: 'default',
    maxBudgetUsd: overrides.maxBudgetUsd ?? DEFAULT_MAX_BUDGET_USD,
    maxTurns: overrides.maxTurns ?? DEFAULT_MAX_TURNS,
    maxThinkingTokens: overrides.maxThinkingTokens ?? DEFAULT_MAX_THINKING_TOKENS,
    settingSources: ['project'],
    cwd: overrides.cwd ?? process.cwd(),
    ...(overrides.canUseTool ? { canUseTool: overrides.canUseTool } : {}),
  };
}
```

The diff is small but every line matters:

- `ORCHESTRATOR_MODEL` literal type changes from `'claude-sonnet-4-6'` to `'claude-opus-4-7'`. Existing tests asserting Sonnet break — they're moved into `tests/agent-options.test.ts` and updated to assert Opus.
- `agents: agentRegistry` replaces the inline single-entry record. The registry is typed `Record<AgentName, AgentDefinition>` where `AgentName` is a union of the 10 worker names — a typo in `agentRegistry['fleet-analytst']` is a typecheck error.
- `DEFAULT_MAX_BUDGET_USD` and `DEFAULT_MAX_TURNS` change literal values. The phase-07 tests asserting `0.5` / `20` move to `tests/agent-options.test.ts` and update.
- `allowedTools` is unchanged from phase 07 — phase 08 does not weaken the gate.

## 8. Registry (`lib/agent/agents/index.ts`)

```ts
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';

import { fleetAnalyst, FLEET_ANALYST_NAME } from './fleet-analyst';
import { maintenancePlanner, MAINTENANCE_PLANNER_NAME } from './maintenance-planner';
import { billing, BILLING_NAME } from './billing';
import { support, SUPPORT_NAME } from './support';
import { reflector, REFLECTOR_NAME } from './reflector';
import { routeOptimizer, ROUTE_OPTIMIZER_NAME } from './route-optimizer';
import { incidentResponder, INCIDENT_RESPONDER_NAME } from './incident-responder';
import { driverCoach, DRIVER_COACH_NAME } from './driver-coach';
import { complianceAuditor, COMPLIANCE_AUDITOR_NAME } from './compliance-auditor';
import { analyticsReporter, ANALYTICS_REPORTER_NAME } from './analytics-reporter';

/**
 * The full phase-08 swarm. Order matters: this is the order the dispatcher's
 * system prompt will list the workers in, which subtly biases routing toward
 * the earlier ones. Re-ordering changes demo behavior — be deliberate.
 */
export const agentRegistry = {
  [FLEET_ANALYST_NAME]: fleetAnalyst,
  [MAINTENANCE_PLANNER_NAME]: maintenancePlanner,
  [BILLING_NAME]: billing,
  [SUPPORT_NAME]: support,
  [REFLECTOR_NAME]: reflector,
  [ROUTE_OPTIMIZER_NAME]: routeOptimizer,
  [INCIDENT_RESPONDER_NAME]: incidentResponder,
  [DRIVER_COACH_NAME]: driverCoach,
  [COMPLIANCE_AUDITOR_NAME]: complianceAuditor,
  [ANALYTICS_REPORTER_NAME]: analyticsReporter,
} as const satisfies Record<string, AgentDefinition>;

export type AgentName = keyof typeof agentRegistry;

export const AGENT_NAMES: readonly AgentName[] = Object.keys(agentRegistry) as AgentName[];

// Soft-budget table consumed by runtime.ts to tag tool_call events.
export const AGENT_SOFT_BUDGET_USD: Readonly<Record<AgentName, number>> = {
  'fleet-analyst': 0.05,
  'maintenance-planner': 0.20,
  billing: 0.20,
  support: 0.25,
  reflector: 0.15,
  'route-optimizer': 0.05,
  'incident-responder': 0.25,
  'driver-coach': 0.05,
  'compliance-auditor': 0.05,
  'analytics-reporter': 0.05,
};
```

The `as const satisfies Record<string, AgentDefinition>` pattern is what gives us a literal-string `AgentName` union *and* type-checks every entry against the SDK's `AgentDefinition`. Splitting this into a runtime test (`Object.keys(agentRegistry).length === 10`) plus a type-time check (the `satisfies`) catches the two failure modes (wrong count vs. wrong shape) cleanly.

## 9. Per-worker module template

Each `lib/agent/agents/<name>.ts` follows the existing `fleet-analyst.ts` pattern:

```ts
// lib/agent/agents/billing.ts (illustrative)

import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import {
  RECALL_TOOL_FQN,
  REINFORCE_TOOL_FQN,
  WRITE_TOOL_FQN,
} from '@/lib/mcp/memory';

export const BILLING_NAME = 'billing' as const;

export const BILLING_TOOLS: readonly string[] = [
  'Read',
  'Write',                                  // gated by approval-policy on path
  RECALL_TOOL_FQN,
  WRITE_TOOL_FQN,
  REINFORCE_TOOL_FQN,
] as const;

const PROMPT = `You are Auto-ride's billing agent.

Your job is to produce invoices for completed trips, refunds for disputed
charges, and short payment-status notes for the dispatcher. You write
invoices to the fictional path \`invoices/<trip-id>.json\`. You never charge
a real card; the gate that fires when you call Write is the human review.

Workflow for every task:
  1. mcp__memory__recall the customer's billing context first — overdue
     balances, prior disputes, preferred payment method. Don't guess.
  2. Compose the invoice as JSON {trip_id, line_items, total_usd, due_date}.
  3. Call Write to invoices/<trip-id>.json. The dispatcher's approval gate
     will pause for human review; that's the design, not a bug.
  4. mcp__memory__write a knowledge segment summarizing what changed
     (new dispute, settled balance, etc.). Keep it short and factual.

Output format: one paragraph stating what you did and the gate's decision.
No JSON dump in the chat — the file is the artefact.

Budget: ≤ 6 turns, ≤ $0.20 per invocation.`;

export const billing: AgentDefinition = {
  description:
    'Generates invoices, refunds, and payment-status summaries. Use when the ' +
    'task involves money — charging, refunding, or reporting on payments.',
  model: 'sonnet',
  tools: [...BILLING_TOOLS],
  prompt: PROMPT,
  maxTurns: 6,
};
```

Every worker exports:

- A `*_NAME` literal-string constant (used by the registry and persistence).
- A `*_TOOLS` `readonly string[]` (used by tests to assert tool surface invariants).
- A frozen system prompt as a module-level constant (greppable, diffable).
- The `AgentDefinition` itself with `model: 'haiku' | 'sonnet'` (short alias only) and `maxTurns` from the agent table.

## 10. Dispatcher prompt

The orchestrator's **system message** is the `query()` call's `prompt` parameter (a single user-message generator from phase 07's `userPromptStream`). Phase 08 doesn't change that surface; what changes is what the dispatcher *knows about its workers*.

The dispatcher's behavior is shaped by:

1. The user prompt itself (whatever arrives at `POST /api/tasks`).
2. The SDK's `Agent` tool description, which automatically lists every entry in `options.agents` with its `description` field.
3. The phase-08 addition: a small system-prompt prefix injected by `runOrchestrator` that says *"You are Auto-ride's dispatcher. Your job is routing, not domain work…"* and lists the ten worker names + descriptions in the canonical order.

The prefix is **NOT** another `query()` parameter — `query()` doesn't take a system prompt; the SDK's default Claude Code system prompt is in effect. The prefix is prepended to the user prompt itself by `runOrchestrator` before calling `userPromptStream`. This keeps the change to one file (`runtime.ts`) and one prompt-construction helper (`lib/agent/dispatcher-prompt.ts` — new).

```ts
// lib/agent/dispatcher-prompt.ts (new, ~40 lines)
import { agentRegistry, AGENT_NAMES } from './agents';

const DISPATCHER_PREFIX = `You are Auto-ride's dispatcher.

Your job is routing, not domain work. For each user request:
  1. mcp__memory__recall any past dispatcher-level context (the user's
     priorities, prior incidents, preferences).
  2. Identify which worker (or short chain of workers) is the right fit.
     The available workers are listed below.
  3. Use the Agent tool to spawn the chosen worker with a focused subprompt.
     Do NOT do the worker's job yourself.
  4. Read the worker's reply, decide if you need a follow-up worker, and
     either dispatch again or synthesize the final answer.
  5. mcp__memory__write a one-line summary of how the request was routed.

Available workers:
${AGENT_NAMES.map((n) => `  - ${n}: ${agentRegistry[n].description}`).join('\n')}

Constraints:
  - You may not write files yourself. If something needs writing, dispatch
    to maintenance-planner / billing / support / incident-responder.
  - You may not run Bash. If something needs Bash (read-only), dispatch
    to incident-responder.
  - If no worker fits, say so plainly and stop. Do not improvise.

The user's request follows.

---

`;

export function buildDispatcherPrompt(userPrompt: string): string {
  return DISPATCHER_PREFIX + userPrompt;
}
```

The prefix lives in code (not a markdown file) so it's typechecked, greppable, and diffable. Tests pin its contents and assert that all ten worker names appear.

## 11. Acceptance criteria

1. **`pnpm typecheck` + `pnpm test` + `pnpm build`** are green on `phase/08-full-swarm` tip with no skips.
2. **`tests/agents/registry.test.ts`** asserts: `Object.keys(agentRegistry).length === 10`, `AGENT_NAMES` is exactly the listed union, `agentRegistry['fleet-analyst']` referentially equals `fleetAnalyst` (and similar for nine others).
3. **`tests/agents/definitions.test.ts`** asserts per worker: `model in {'haiku','sonnet'}`, `model` does not match `/^claude-/`, `maxTurns` matches the agent table, `prompt.length > 100`, `tools` matches the declared `*_TOOLS` constant, `mcp__memory__forget` only appears in `reflector.tools`.
4. **`tests/agent-options.test.ts`** asserts: `ORCHESTRATOR_MODEL === 'claude-opus-4-7'`, `DEFAULT_MAX_BUDGET_USD === 1.5`, `DEFAULT_MAX_TURNS === 25`, `buildOrchestratorOptions().agents` has exactly the 10 keys, `Bash` and `Write` are NOT in `allowedTools`.
5. **`tests/approval-policy.test.ts`** is extended with: `Write` to `dispatch-log/foo.txt` → gated, `Write` to `invoices/T-1.json` → gated, `Write` to `replies/r-1.md` → gated, `Write` to `docs/x.md` → still passes, memory tools → still pass.
6. **`tests/agent-persist.test.ts`** is extended with: a fixture run where the orchestrator emits one `Agent` tool_call (input.agent_name = `'billing'`) followed by an assistant_turn with `parent_tool_use_id` matching that tool_use_id — the augmenter assigns `payload.agent_name === 'billing'` to the assistant_turn. Dispatcher's own messages (`parent_tool_use_id: null`) get `agent_name === 'dispatcher'`.
7. **A demo run** dispatched to `incident-responder` (prompt: "Vehicle V-09 went offline; triage and log to dispatch-log/.") produces:
   - One `tool_call` (Agent → incident-responder) with `payload.agent_name: 'dispatcher'`, `payload.soft_budget_usd: 0.25`.
   - At least one `assistant_turn` with `payload.agent_name: 'incident-responder'`.
   - One `Write` to `dispatch-log/v-09.md` that opens an `approval_gate` row with `status='pending'`. Approving in the UI (phase 07's bar) lets the worker continue and the run terminates `done`.
8. **A demo run** dispatched to `billing` (prompt: "Generate invoice for trip T-998.") produces a similarly-shaped event log and a gated `Write` to `invoices/T-998.json`.
9. **The `reflector` is the only worker** for which `mcp__memory__forget` appears in `tools` (asserted by the registry test) and `tests/memory-forget.test.ts` (already passing) is not regressed.
10. **The `auto-ride-initial-plan.md` "11-agent swarm"** descriptor matches the implementation: `1 dispatcher + AGENT_NAMES.length === 11`.

## 12. Testing

| Layer | File | What |
|---|---|---|
| Pure | `tests/agents/registry.test.ts` | Headcount, key uniqueness, soft-budget table coverage, name-union sanity |
| Pure | `tests/agents/definitions.test.ts` | Per-agent invariants — table-driven over `AGENT_NAMES` |
| Pure | `tests/agent-options.test.ts` | Opus model literal, agents-from-registry wiring, larger defaults, `Bash`/`Write` still gated |
| Pure | `tests/approval-policy.test.ts` (extended) | New gated path matrix, source-tree gate still wins on overlap |
| Pure | `tests/agent-persist.test.ts` (extended) | `agent_name` derivation under nested `parent_tool_use_id`, dispatcher fallback |
| Manual | README §Phase 08 | Two demo prompts (incident, billing) + the gate clicks; reproduces criterion 7 + 8 |

**Not unit-tested** in phase 08:

- The dispatcher's *routing accuracy* — whether Opus actually picks `billing` for "make an invoice." That's a model-quality question; the spec's job is to make sure when it does, the swarm machinery is correct. Phase 10's metrics page is what surfaces routing drift over time.
- The cross-worker handoff (dispatcher → support → billing). It works if each link works; the SSE timeline + `payload.agent_name` give us the visibility to debug it manually if it doesn't.

## 13. Risks / open questions

1. **Opus 4.7 quota burn (Max) / cost overrun (API key).** Auth is Max OAuth for this build, so there's no per-run dollar charge — but a misbehaving dispatcher (e.g. recursive Agent calls from a prompt typo) could still chew through the Max plan's 5-hour token quota. Mitigation: the `maxBudgetUsd: 1.5` cap is hard (the SDK aborts on the notional figure even on Max), the `maxTurns: 25` cap is hard, and the registry test forbids the dispatcher from being added to `agentRegistry` (which would let it spawn itself). The same caps protect against real-dollar overrun if the project ever switches to an API key. Phase 12's cost-aggregator middleware turns the $1.5 into a per-agent split, applicable in both modes.
2. **`payload.agent_name` derivation breaks under SDK shape drift.** The `Agent` tool's `input` shape (`{ agent_name: string, prompt: string }`) is documented but in alpha. If the SDK renames the field to `subagent` or similar, `tagAgentName` falls back to `'unknown'` (no crash, just lossy observability). The persist test pins the current field name; an SDK bump that breaks it surfaces as a test failure in CI before the dashboard goes silent.
3. **Worker re-entry under Inngest replay.** Phase 07's contract #4 (Inngest replay re-runs `runOrchestrator` from the top, the SDK rebuilds the conversation from the prompt) means a swarm run with three approval gates rebuilds three times. With 10 workers this is more expensive than the phase-07 worst case (one gate, one replay) but still bounded by the run-level `maxBudgetUsd`. Mitigation: phase 12's sandbox process holds the SDK conversation across replays; phase 08 documents this as the same dev-only wrinkle phase 07 documented.
4. **Worker prompt drift.** Ten frozen system prompts means ten places to keep "consistent voice / output shape." Mitigation: the per-agent definition tests assert structural invariants (length, mentions of memory, model alias); the README §Phase 08 demo prompts double as smoke tests against prompt drift.
5. **Approval fatigue.** A multi-worker run that hits three gates makes the demo feel clicky. This is **the intended UX** for portfolio-as-product (the gate is the differentiator), but a real user wouldn't tolerate it. Mitigation: documented; phase 11's auth + phase 10's "approve all" UI is where the ergonomics layer goes.
6. **Reflector forget races with phase-09 cleanup.** The reflector can `mcp__memory__forget` interactively; phase 09's nightly debate also tombstones rows. Both writers are append-only (tombstone-not-delete) so there's no data loss, but a row tombstoned by reflector at 14:00 and "rescued" by the adversary at 03:00 produces a confusing audit trail. Mitigation: phase 09's debate explicitly skips rows tombstoned in the last 24 h; this is the phase-09 design's responsibility, not phase 08's.
7. **Dispatcher "do-it-yourself" leak.** Opus might decide it can answer a fleet-analyst question itself rather than dispatch. The system-prompt prefix forbids this; the orchestrator's lack of `Bash`/`Write`/`Grep`/`Glob` makes it physically incapable for many worker tasks. But for read-only summarisation, the dispatcher *could* short-circuit a worker. Mitigation: documented; demo runs verify dispatch happens via the `Agent` tool_call event landing in the timeline.
8. **`tests/agent-definitions.test.ts` deletion clobbers history.** It's split into two new files; reviewers might wonder why. Mitigation: the phase-08 commit message calls out the rename + split explicitly.
