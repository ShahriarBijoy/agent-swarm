# Phase 07 — HITL approvals (design)

**Date:** 2026-04-24
**Status:** approved (phase 06 merged)
**Plan references:** `auto-ride-initial-plan.md` §3 (SDK primitives), §4 (durable HITL)
**Roadmap entry:** `docs/roadmap/ROADMAP.md` — phase 07

## Purpose

Phase 07 turns the live timeline from phase 06 into an **interactive** surface by introducing a human-in-the-loop (HITL) approval gate that survives server restarts. The agent stops before any risky tool call, records the intent in Postgres, surfaces it in the UI, and only proceeds once a human clicks **Approve** / **Deny** / **Modify**.

Two primitives land together because they're tightly coupled and neither is useful alone:

1. **`canUseTool` gate** — the Claude Agent SDK callback that fires after all hooks, pauses execution until a decision arrives, and can rewrite tool input (`updatedInput`) or deny with a reason (`message`). Requires **streaming-input mode** — the existing `query({ prompt: string })` call must become `query({ prompt: AsyncGenerator<SDKUserMessage> })` (plan §3, §4).
2. **Inngest durable workflow** — the whole orchestrator run lives inside an `inngest.createFunction` handler. The `canUseTool` callback calls `step.waitForEvent('auto-ride/approval.decided', { timeout: '24h' })`. If the Next.js process dies mid-wait — Turbopack hot-reload, `pnpm dev` restart, Vercel redeploy — Inngest resumes the same step from its durable store when the process comes back up, and the pending `approval_gates` row is still there because it was inserted *before* the wait. The React approval bar POSTs to a Server Action that updates the gate row and calls `inngest.send('auto-ride/approval.decided')`; the paused step unblocks, the SDK proceeds.

On top of those two primitives, phase 07 ships:

- A small **approval-policy module** that decides which tools require approval (`Bash` with non-whitelisted commands, `Write` to `^src/`, any `mcp__stripe__*`, any MCP tool whose annotations include `requiresApproval: true`).
- An **`<ApprovalRequest>`** timeline component (registered in the phase-06 `TimelineEventRenderer`) + an **`<ApprovalBar>`** component on `/tasks/[id]` that renders only when at least one gate for this task is `pending`.
- A **Server Action** `resolveApproval({ gateId, decision, reason?, modifiedInput? })` at `app/tasks/[id]/actions.ts`.
- A **`task_events`** row of type `approval_request` when a gate opens, and (for UI dismissal parity) a second event `approval_resolved` piggybacking the same constraint slot (§ 4 clarifies how we reuse the existing check constraint).

Phase 08 (full 11-agent swarm) adds per-tool / per-agent policy tuning on top of this gate. Phase 10 (dashboards) adds an "awaiting approval" kanban column that reads the same `approval_gates` rows. Phase 11 (auth) gates the Server Action behind Better Auth's session middleware.

## Non-goals

Explicitly out of scope for phase 07 — resist adding them even when convenient:

- **Per-agent / per-tool policy UI.** Phase 07 hard-codes the policy in `lib/agent/approval-policy.ts`. An admin UI to edit it lands in phase 10.
- **Approval batching / bulk actions** ("approve everything matching X"). One gate, one decision, one Inngest event.
- **Reviewer identity.** `approval_gates.reviewer_id` is populated with `'local-dev'` until phase 11's auth lands; the column is not surfaced in the UI.
- **Audit log surface.** The decision + reason are persisted on the gate row and emitted as a `task_event`, but there's no dedicated `/approvals` audit page. Phase 10 adds it.
- **Cross-task approval chains.** A task can have multiple sequential gates; it can never have two gates open simultaneously because `canUseTool` is serial per run. Tests assert this.
- **Approval from the list page.** `/tasks` stays a passive list; only `/tasks/[id]` shows the approval bar. Phase 10 adds an `awaiting-approval` kanban lane.
- **Cancel / time-out from the UI.** The gate auto-expires after 24 h via the Inngest timeout; no manual "cancel this gate" button. If a user wants to kill the run they can wait 24 h, or (phase 10) hit a future DELETE endpoint.
- **Sandbox / Fly.io agent process.** Still running in-process via the phase-06 `startTask`, now wrapped in an Inngest function. Phase 12 moves the runner out of the Next.js process.
- **Auth on the Inngest serve endpoint.** `POST /api/inngest` is open on localhost for phase 07; the Inngest signing key gates it in prod (phase 12).
- **Observability traces around approvals.** The SDK message flow is already persisted in `task_events`. Langfuse spans wait for phase 12.

## Cost check

Phase 07 stays cheap — we add one **extra** Anthropic round-trip per approved tool call (the continuation after the `allow` return) but otherwise burn the same tokens per run as phase 06.

- **Anthropic API:** a demo run that hits one gate, gets approved, and completes costs **$0.02–$0.05**. Iteration cost on the UI + server action is zero tokens (no `query()`). Expect **< $2** Anthropic spend for the phase.
- **Gemini embeddings:** unchanged — `recall` still embeds each query, well under the free tier.
- **Neon:** one new read-heavy surface — on every `/tasks/[id]` render we `SELECT … FROM approval_gates WHERE task_id = $1 AND status = 'pending'`. This is a single indexed lookup (phase 02 created `approval_gates_status_idx`) and is cached in React cache on the server component pass. No polling loop — the SSE stream's existing `approval_request` event tells the UI to re-fetch.
- **Inngest:** the dev server is free; Inngest Cloud's free tier (50k steps/month) is orders of magnitude above anything we'll hit during phase 07 iteration.

## Dependencies

**Two new runtime packages** (user installs manually per `CLAUDE.md` memory):

| Package | Version | Why |
|---|---|---|
| `inngest` | `^3.43.x` | Client + `createFunction` + `step.waitForEvent`. Latest 3.x line — 3.x is stable since 2024. |
| `inngest-cli` (dev-only, via `npx`) | latest | Local event broker + replay UI. Not added to `package.json`; invoked through `pnpm inngest:dev` script that calls `npx inngest-cli@latest dev -u http://localhost:3000/api/inngest`. |

`inngest`'s `serve()` helper for Next.js lives in `inngest/next`, which is the same package — no separate install.

**No new env vars** for local dev. Inngest's dev server defaults to `http://localhost:8288`; the client auto-detects it when `NODE_ENV !== 'production'`. Production (phase 12) will need `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY`.

**Next.js version:** 16.1.7 (unchanged).

**Schema:** no new tables or columns. Phase 02 already provisioned:

- `approval_gates` table with `run_id`, `task_id`, `tool_name`, `proposed_input`, `status`, `resolution_input`, `reviewer_note`, `reviewer_id`, `inngest_event_key`, `created_at`, `resolved_at`, `timed_out_at`.
- `approval_status` enum: `pending | approved | modified | denied | timed_out`.
- `task_status` enum includes `awaiting_approval`.
- `task_events` check constraint includes `approval_request`.

Only delta: we need `approval_resolved` as a second event type to cleanly dismiss the approval bar over SSE — see §4 for the compatibility approach (we reuse `approval_request` with a discriminator, no schema migration).

## Directory layout (delta from phase 06)

```
Agent-swarm/
├── app/
│   ├── api/
│   │   └── inngest/
│   │       └── route.ts                                    # NEW — GET/POST/PUT served by inngest/next
│   └── tasks/
│       └── [id]/
│           ├── actions.ts                                  # NEW — 'use server' resolveApproval Server Action
│           ├── approval-bar.tsx                            # NEW — client component; pending gates + buttons
│           └── page.tsx                                    # EDIT — fetch pending gates; pass to ApprovalBar
├── components/
│   └── timeline/
│       ├── ApprovalRequest.tsx                             # NEW — renders gate proposal + status badge
│       ├── TimelineEventRenderer.tsx                       # EDIT — case 'approval_request'
│       └── types.ts                                        # EDIT — extend TimelineEvent.type union
├── db/
│   └── queries/
│       └── approval-gates.ts                               # NEW — openGate, resolveGate, expireGate, listPendingForTask, getGateById
├── lib/
│   ├── agent/
│   │   ├── approval-policy.ts                              # NEW — shouldApprove(toolName, input) → { require: boolean, reason? }
│   │   ├── approvals.ts                                    # NEW — createCanUseTool({ taskId, runId, step })
│   │   ├── options.ts                                      # EDIT — accept optional canUseTool; keep undefined default
│   │   └── runtime.ts                                      # EDIT — streaming-input prompt; thread canUseTool through
│   ├── inngest/                                            # NEW
│   │   ├── client.ts                                       # NEW — Inngest({ id: 'auto-ride' })
│   │   ├── events.ts                                       # NEW — typed event names + schemas
│   │   └── functions.ts                                    # NEW — taskStartedFn wrapping runOrchestrator
│   └── runner/
│       └── start-task.ts                                   # EDIT — inngest.send instead of fire-and-forget
├── tests/
│   ├── approval-policy.test.ts                             # NEW — tool-name matrix
│   ├── approval-gates.test.ts                              # NEW — DB state machine
│   ├── approvals-canusetool.test.ts                        # NEW — fake-Inngest-step unit test of gate lifecycle
│   └── resolve-approval-action.test.ts                     # NEW — server action validation + DB effect
├── package.json                                            # EDIT — +inngest; +`inngest:dev` script
├── README.md                                               # EDIT — phase 07 Quickstart + 2-terminal demo
└── docs/superpowers/
    ├── specs/2026-04-24-phase-07-hitl-approvals-design.md  # NEW — this file
    └── plans/2026-04-24-phase-07-hitl-approvals-plan.md    # NEW
```

## 1. End-to-end flow

```
Browser                Next.js                Inngest                 DB                     SDK query()
   │                      │                      │                      │                        │
   │ POST /api/tasks      │                      │                      │                        │
   ├─────────────────────►│                      │                      │                        │
   │                      │ createQueuedTask     │                      │                        │
   │                      ├─────────────────────────────────────────────►│                       │
   │                      │ inngest.send         │                      │                        │
   │                      │  'task.started'      │                      │                        │
   │                      ├─────────────────────►│                      │                        │
   │◄─────────────────────┤ 200 { taskId }       │                      │                        │
   │ GET /tasks/<id>      │                      │                      │                        │
   │◄──── SSE ────────────┤                      │                      │                        │
   │                      │                      │ runs taskStartedFn   │                        │
   │                      │                      ├──────────────────────┼───── runOrchestrator ─►│
   │                      │                      │                      │                        │ assistant_turn
   │                      │                      │                      │                        │ tool_call
   │                      │                      │                      │                        │    ↓
   │                      │                      │                      │                        │ canUseTool?
   │                      │                      │                      │                        │    yes
   │                      │                      │ openGate             │                        │
   │                      │                      ├─────────────────────►│ approval_gates INSERT  │
   │                      │                      │ appendTaskEvent      │  status=pending        │
   │                      │                      ├─────────────────────►│ approval_request       │
   │  approval_request ◄──┤◄── SSE tick ─────────┤                      │                        │
   │                      │                      │ step.waitForEvent    │                        │
   │                      │                      │   timeout 24h        │                        │
   │ click Approve        │                      │    ⋯ paused ⋯        │                        │
   ├─────────────────────►│ Server Action        │                      │                        │
   │                      │ resolveApproval      │                      │                        │
   │                      ├─────────────────────────────────────────────►│ approval_gates UPDATE│
   │                      │                      │                      │  status=approved       │
   │                      │ appendTaskEvent      │                      │                        │
   │                      ├─────────────────────────────────────────────►│ approval_request     │
   │                      │                      │                      │  {subtype:'resolved'} │
   │                      │ inngest.send         │                      │                        │
   │                      │ 'approval.decided'   │                      │                        │
   │                      ├─────────────────────►│                      │                        │
   │                      │                      │ resumes paused step  │                        │
   │                      │                      ├──────── returns ────┼───── { allow } ───────►│
   │                      │                      │                      │                        │ (SDK continues)
   │                      │                      │                      │                        │ tool_result …
   │                      │                      │                      │                        │ run_result
   │◄──── SSE done ───────┤◄─────────────────────┤◄─────────────────────┤                        │
```

The "survive restart" proof: **kill the Next.js process any time between `step.waitForEvent` entering and the approval event arriving**. When `pnpm dev` comes back up, Inngest replays the function — it picks up at the `waitForEvent` step, which re-subscribes to the event. The `approval_gates` row is unchanged, the timeline event is still in `task_events`, the UI's SSE reconnects with `Last-Event-ID` and resumes rendering.

## 2. Approval policy

A small, deterministic function — not a model call. Lives in `lib/agent/approval-policy.ts`:

```ts
export type ApprovalDecisionHint =
  | { require: false }
  | { require: true; reason: string };

/**
 * Deterministic, side-effect-free: given a tool name and its input, should this
 * run require human approval? Tuned for the phase-05/07 tool surface; extend
 * via additions, not deletions, as new phases add tools.
 */
export function shouldRequireApproval(
  toolName: string,
  input: unknown,
): ApprovalDecisionHint {
  // 1. Stripe and other payment tools: always gate.
  if (toolName.startsWith('mcp__stripe__')) {
    return { require: true, reason: 'Payment tool — always gated.' };
  }

  // 2. Bash with non-whitelisted commands: gate.
  if (toolName === 'Bash') {
    const cmd = typeof (input as { command?: unknown })?.command === 'string'
      ? (input as { command: string }).command
      : '';
    if (!isWhitelistedBash(cmd)) {
      return { require: true, reason: `Non-whitelisted Bash: ${safeShort(cmd, 80)}` };
    }
    return { require: false };
  }

  // 3. Write targeting ^src/: gate. (Project convention for "code changes".)
  if (toolName === 'Write') {
    const path = typeof (input as { file_path?: unknown })?.file_path === 'string'
      ? (input as { file_path: string }).file_path
      : '';
    if (/^src[\\/]/.test(path) || path.includes('/src/')) {
      return { require: true, reason: `Write to source tree: ${path}` };
    }
    return { require: false };
  }

  // 4. Default: no approval for read-only memory / analyst tools.
  return { require: false };
}
```

**Whitelisted Bash commands** for phase 07 (read-only / observability):

```ts
const BASH_WHITELIST = [
  /^ls(\s|$)/,
  /^git\s+(status|log|show|diff)(\s|$)/,
  /^pnpm\s+(test|typecheck|lint|build)(\s|$)/,
  /^node\s+--version(\s|$)/,
];
```

Tests pin the whitelist + gated matrix; changing either requires editing the test table.

**Future extension (phase 08)** — MCP tool annotations (`requiresApproval: true` on a tool's manifest) will surface through `shouldRequireApproval`; we stub the hook in phase 07 so adding the MCP server later is a 3-line change.

## 3. `canUseTool` contract

```ts
// @anthropic-ai/claude-agent-sdk — CanUseTool signature
type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  opts: { signal: AbortSignal; suggestions?: PermissionUpdate[] },
) => Promise<PermissionResult>;

type PermissionResult =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown>; updatedPermissions?: PermissionUpdate[] }
  | { behavior: 'deny';  message: string; interrupt?: boolean };
```

The factory we build:

```ts
// lib/agent/approvals.ts
import type { GetStepTools } from 'inngest';
import type { Inngest } from 'inngest';
type Step = GetStepTools<Inngest<any>>;

export type CanUseToolContext = {
  taskId: string;
  runId: string;
  step: Step;
  /** Test seam — defaults to real DB helpers. */
  gateRepo?: GateRepo;
};

export function createCanUseTool(ctx: CanUseToolContext): CanUseTool {
  return async (toolName, input, { signal }) => {
    const decisionHint = shouldRequireApproval(toolName, input);
    if (!decisionHint.require) return { behavior: 'allow' };

    const gateId = crypto.randomUUID();
    await (ctx.gateRepo ?? defaultGateRepo).openGate({
      id: gateId,
      runId: ctx.runId,
      taskId: ctx.taskId,
      toolName,
      proposedInput: input,
    });
    await appendTaskEvent({
      runId: ctx.runId,
      taskId: ctx.taskId,
      seq: await nextSeq(ctx.runId),          // see §5 for ordering guarantee
      type: 'approval_request',
      payload: {
        subtype: 'opened',
        gate_id: gateId,
        tool_name: toolName,
        proposed_input: input,
        reason: decisionHint.reason,
      },
    });
    await markTaskAwaitingApproval(ctx.taskId);

    // Durable wait. Inngest persists the step boundary — if the process dies
    // and reboots, the next function replay resumes at exactly this `await`.
    const decision = await ctx.step.waitForEvent(`approval-${gateId}`, {
      event: 'auto-ride/approval.decided',
      timeout: '24h',
      if: `async.data.gateId == "${gateId}"`,
    });

    if (signal.aborted) return { behavior: 'deny', message: 'Run aborted.' };

    if (!decision) {
      await (ctx.gateRepo ?? defaultGateRepo).expireGate(gateId);
      return { behavior: 'deny', message: 'Approval timed out after 24h.' };
    }

    // The Server Action already persisted the decision + appended the
    // 'resolved' event. Here we only branch on the event payload.
    const { approved, modifiedInput, reason } = decision.data as ApprovalDecidedPayload;
    await markTaskInProgress(ctx.taskId);  // un-pause the task row

    if (approved && modifiedInput !== undefined) {
      return { behavior: 'allow', updatedInput: modifiedInput };
    }
    if (approved) {
      return { behavior: 'allow' };
    }
    return { behavior: 'deny', message: reason ?? 'Denied by reviewer.' };
  };
}
```

### 3.1 Streaming-input migration

The SDK requires `canUseTool` to be paired with an `AsyncGenerator` prompt (SDK docs + plan §3). The phase-05 call site:

```ts
// before
for await (const msg of query({ prompt: args.prompt, options })) { ... }
```

becomes:

```ts
// after
async function* userPrompt(text: string): AsyncGenerator<SDKUserMessage> {
  yield {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
    session_id: '',           // SDK populates on first init
  };
}

for await (const msg of query({ prompt: userPrompt(args.prompt), options: { ...options, canUseTool } })) { ... }
```

**Why the generator wraps a single yield and then completes:** we're not doing multi-turn user input yet — the orchestrator's prompt is one message, and the SDK's streaming-input requirement is satisfied by any async iterator. Phase 08's orchestrator-to-worker dispatch stays inside the SDK (Agent tool), not re-entering this generator.

**Runtime smoke test:** a phase-07 unit test builds the generator and asserts it yields exactly one correctly-shaped `SDKUserMessage` before closing.

## 4. `task_events` compatibility: `approval_request` subtypes

The existing `task_events_type_check` constraint already permits `approval_request`. We need **two logical events** — opened and resolved — but only want **one type slot** (changing the constraint requires a migration). Solution: both events use `type='approval_request'` with a `payload.subtype` discriminator.

```ts
// opening
{ type: 'approval_request', payload: { subtype: 'opened',   gate_id, tool_name, proposed_input, reason } }

// resolving (inserted by the Server Action, not the SDK side)
{ type: 'approval_request', payload: { subtype: 'resolved', gate_id, decision, reason?, modified_input? } }
```

Discussion of alternatives:

| Option | Pros | Cons | Chosen |
|---|---|---|---|
| New `approval_resolved` type | Clean | Requires migration + updated check constraint | No |
| `approval_request` subtype discriminator | Zero schema churn, keeps phase 02 contract honest | UI must switch on `payload.subtype` | **Yes** |
| Reuse `run_result` | Semantic mismatch | Breaks any future "task is done" queries | No |

The `<ApprovalRequest>` component dispatches on `payload.subtype` internally.

## 5. Event ordering: `seq` under concurrent writers

Phase 06's runner is the sole writer to `task_events.seq` for a given `run_id`. Phase 07 introduces a **second writer**: the Server Action that inserts the `resolved` event. We must preserve the unique `(run_id, seq)` index.

**Chosen approach:** both writers call a shared `nextSeq(runId: string)` helper that runs

```sql
INSERT INTO task_events (run_id, task_id, seq, type, payload)
VALUES (
  $1, $2,
  COALESCE((SELECT MAX(seq) FROM task_events WHERE run_id = $1), -1) + 1,
  $3, $4
)
ON CONFLICT (run_id, seq) DO NOTHING
RETURNING id, seq;
```

A single statement selects + inserts, so we never hand out a stale `seq` to a second concurrent writer. If two transactions race, one wins and the other's `ON CONFLICT` fires; the loser retries with a bumped seq. Phase 07 adds a thin `appendTaskEventAuto({ runId, taskId, type, payload })` helper that wraps this and retries up to 3 times on conflict.

**Why not a sequence or trigger:** a per-run sequence would need dynamic DDL (one per `runId`); a trigger adds magic that's hard to test. Inline `MAX + 1` is dead-simple and correct at phase 07 concurrency levels (two writers max).

## 6. Server Action: `resolveApproval`

Lives in `app/tasks/[id]/actions.ts`:

```ts
'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';

const decisionSchema = z.object({
  gateId: z.string().uuid(),
  decision: z.enum(['approve', 'deny', 'modify']),
  reason: z.string().max(1000).optional(),
  modifiedInput: z.record(z.string(), z.unknown()).optional(),
});

export async function resolveApproval(form: FormData) {
  const raw = {
    gateId: form.get('gateId'),
    decision: form.get('decision'),
    reason: form.get('reason') || undefined,
    modifiedInput: form.get('modifiedInput')
      ? JSON.parse(String(form.get('modifiedInput')))
      : undefined,
  };
  const parsed = decisionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false as const, error: 'invalid_body', issues: parsed.error.issues };
  }

  const gate = await getGateById(parsed.data.gateId);
  if (!gate) {
    return { ok: false as const, error: 'gate_not_found' };
  }
  if (gate.status !== 'pending') {
    return { ok: false as const, error: 'gate_already_resolved', status: gate.status };
  }

  const { decision, reason, modifiedInput } = parsed.data;
  const newStatus =
    decision === 'approve' ? 'approved'
    : decision === 'modify' ? 'modified'
    : 'denied';

  // 1. Mark the gate row (same transaction as the event append to keep UI coherent).
  await db.transaction(async (tx) => {
    await tx.update(approvalGates)
      .set({
        status: newStatus,
        resolutionInput: decision === 'modify' ? modifiedInput ?? gate.proposedInput : null,
        reviewerNote: reason ?? null,
        reviewerId: 'local-dev',        // phase 11 replaces this with the session user
        resolvedAt: new Date(),
      })
      .where(eq(approvalGates.id, parsed.data.gateId));

    await appendTaskEventAuto({
      runId: gate.runId,
      taskId: gate.taskId,
      type: 'approval_request',
      payload: {
        subtype: 'resolved',
        gate_id: parsed.data.gateId,
        decision: newStatus,
        reason: reason ?? null,
        modified_input: decision === 'modify' ? modifiedInput ?? gate.proposedInput : null,
      },
    });
  });

  // 2. Release the paused SDK step via Inngest.
  await inngest.send({
    name: 'auto-ride/approval.decided',
    data: {
      gateId: parsed.data.gateId,
      approved: decision !== 'deny',
      reason: reason ?? null,
      modifiedInput: decision === 'modify' ? modifiedInput ?? gate.proposedInput : null,
    },
  });

  revalidatePath(`/tasks/${gate.taskId}`);
  return { ok: true as const, gateId: parsed.data.gateId, status: newStatus };
}
```

The transaction ensures that if the DB write succeeds, the Server Action result reflects the truth; if the `inngest.send` fails after commit, the gate is still visible as `approved` in the UI (and the SDK stays paused until 24 h expiry). We log the inngest error but don't rollback — the user's decision is recorded; the agent simply won't resume until we retry. Phase 12's deploy hardens this with a background Inngest event retry loop.

## 7. Inngest function: `taskStartedFn`

```ts
// lib/inngest/functions.ts
import { inngest } from './client';
import { runOrchestrator } from '@/lib/agent/runtime';
import { createCanUseTool } from '@/lib/agent/approvals';

export const taskStartedFn = inngest.createFunction(
  {
    id: 'task.started',
    name: 'Task started — run orchestrator',
    concurrency: { limit: 1, key: 'event.data.taskId' }, // per-task serial
  },
  { event: 'auto-ride/task.started' },
  async ({ event, step }) => {
    const { taskId, prompt, maxBudgetUsd, maxTurns } = event.data;
    // runOrchestrator accepts a canUseTool factory so the whole SDK stream
    // can use `step` for durable waits inside the callback.
    const result = await runOrchestrator({
      taskId, prompt, maxBudgetUsd, maxTurns,
      createdBy: 'inngest',
      canUseTool: (runId) => createCanUseTool({ taskId, runId, step }),
    });
    return { taskId: result.taskId, status: result.status, totalCostUsd: result.totalCostUsd };
  },
);
```

**Why `concurrency: { limit: 1, key: 'event.data.taskId' }`:** prevents a rogue duplicate `task.started` event from spinning up two concurrent runs on the same task. Phase 06 already serializes at the DB level via task status transitions; this is belt-and-suspenders.

**`createCanUseTool` is curried on `runId`** because `runOrchestrator` creates the `task_runs` row; the factory only has the `runId` after. Signature:

```ts
type CanUseToolFactory = (runId: string) => CanUseTool;
```

## 8. UI — `/tasks/[id]`

### 8.1 Server-side data flow

`app/tasks/[id]/page.tsx` (server component) is extended to:

1. Read the task row + existing events (phase 06, unchanged).
2. Read pending gates for this task via `listPendingForTask(taskId)` (NEW).
3. Pass `initialPendingGates: GateSummary[]` to `<TimelineStream>` **and** to a new `<ApprovalBar>`.

```tsx
<ApprovalBar taskId={task.id} initialGates={initialPendingGates} />
<TimelineStream
  taskId={task.id}
  initialEvents={initialEvents}
  initialTerminal={initialTerminal}
  onGateOpened={/* client derives from SSE */}
  onGateResolved={/* client derives from SSE */}
/>
```

### 8.2 `<ApprovalBar>` (client)

```tsx
'use client';

export function ApprovalBar({ taskId, initialGates }: Props) {
  const [gates, setGates] = useState<GateSummary[]>(initialGates);

  useEffect(() => {
    const es = new EventSource(`/api/tasks/${taskId}/stream`);
    es.addEventListener('task_event', (e) => {
      const ev = JSON.parse((e as MessageEvent).data) as TimelineEvent;
      if (ev.type !== 'approval_request') return;
      const p = ev.payload as ApprovalRequestPayload;
      if (p.subtype === 'opened') {
        setGates((prev) => [...prev, toSummary(p)]);
      } else {
        // resolved
        setGates((prev) => prev.filter((g) => g.id !== p.gate_id));
      }
    });
    return () => es.close();
  }, [taskId]);

  if (gates.length === 0) return null;
  return (
    <div role="region" aria-label="Pending approvals" className="mb-4">
      {gates.map((g) => <ApprovalCard key={g.id} gate={g} />)}
    </div>
  );
}
```

Each `<ApprovalCard>` is a `<form action={resolveApproval}>` with three submit buttons (`<button name="decision" value="approve">`, same for `deny`, `modify`). "Modify" expands a `<textarea>` for JSON that replaces `proposed_input`.

**Note:** `<ApprovalBar>` opens its **own** `EventSource` to the same stream. Two SSE connections per open task page (one in `<TimelineStream>`, one here) is fine for localhost dev and 1-2 tabs. Phase 10 refactors to a shared context if the pattern spreads.

### 8.3 `<ApprovalRequest>` timeline component

Renders inline in the chronological timeline (not just the floating bar), so the historical record of "gate opened at 12:03, approved at 12:05" stays visible after the banner dismisses.

```tsx
export function ApprovalRequest({ event }: { event: TimelineEvent }) {
  const p = event.payload as ApprovalRequestPayload;
  if (p.subtype === 'opened') {
    return (
      <Card className="border-amber-500/50">
        <CardHeader>
          <Badge variant="warning">Awaiting approval</Badge>
          <CardTitle>{p.tool_name}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{p.reason}</p>
          <pre className="text-xs">{JSON.stringify(p.proposed_input, null, 2)}</pre>
        </CardContent>
      </Card>
    );
  }
  // resolved
  return (
    <Card className={decisionColor(p.decision)}>
      <CardHeader>
        <Badge>{p.decision}</Badge>
      </CardHeader>
      {p.reason && <CardContent><p className="text-sm">{p.reason}</p></CardContent>}
    </Card>
  );
}
```

## 9. `runOrchestrator` signature change

```ts
export type RunOrchestratorArgs = {
  prompt: string;
  taskId?: string;
  maxBudgetUsd?: number;
  maxTurns?: number;
  maxThinkingTokens?: number;
  createdBy?: string;
  cwd?: string;
  onEvent?: (event: PersistedEvent) => void;
  onSessionStart?: (sessionId: string) => void;
  /**
   * Phase-07 HITL. If provided, the callback returned is passed as the SDK's
   * `canUseTool`. The factory is given the `runId` so the callback can persist
   * gates keyed to the run. Undefined = no gate (phase-05 CLI path).
   */
  canUseTool?: (runId: string) => CanUseTool;
};
```

- Phase-05 CLI script (`pnpm query:demo`) continues to call `runOrchestrator({ prompt })` with no `canUseTool` — no behavior change.
- Phase-07 `taskStartedFn` passes the factory; `runOrchestrator` threads the callback into `buildOrchestratorOptions`.

`buildOrchestratorOptions` gains an `overrides.canUseTool?: CanUseTool` field and conditionally sets it on the returned `Options` object. When unset, the SDK falls back to its default (allow-all within `allowedTools`).

## 10. Acceptance criteria

1. **`POST /api/tasks`** with any prompt dispatches an Inngest event, the function runs, the task reaches `done`. Same end-to-end latency as phase 06 ± one extra hop (< 100 ms).
2. **An orchestrator run that invokes a gated tool** (e.g. prompt includes "run `rm -rf /tmp/demo`" to trigger non-whitelisted Bash) stops at the gate: `approval_gates` row appears with `status='pending'`, `task_events` gets one `approval_request` row with `payload.subtype='opened'`, task row transitions to `awaiting_approval`.
3. **Clicking Approve** via the UI: Server Action returns `ok:true`, `approval_gates.status` becomes `'approved'`, a second `approval_request` row with `subtype='resolved'` lands, the task transitions back to `in_progress`, the SDK proceeds, run terminates as `done`.
4. **Clicking Deny** with a reason: gate status `'denied'`, event `subtype='resolved'`, SDK receives `{behavior:'deny', message:<reason>}` — the orchestrator gets the reason as a tool-result error and can react.
5. **Clicking Modify** with a JSON patch: gate status `'modified'`, `approval_gates.resolution_input` populated, SDK receives `{behavior:'allow', updatedInput: <modified>}`, the tool runs with the edited input.
6. **Restart survival**: during a pending gate, `kill -9` the Next.js dev server, `pnpm dev` again, approve in UI → the run still completes. Manually verifiable + documented in README §Phase 07.
7. **Timeout**: a gate left open for >24 h (simulated in a unit test via a fake `step.waitForEvent` that returns `null`) flips to `timed_out`, SDK gets `{behavior:'deny', message:'Approval timed out after 24h.'}`, task terminates as `failed`.
8. **Two gates in one run, sequential**: if the orchestrator hits a second gate after approving the first, both are handled correctly, each with its own `gate_id`, in order.
9. **`pnpm typecheck` + `pnpm test` + `pnpm build`** green on phase/07 tip.
10. **README Phase 07 Quickstart** documents the 2-terminal setup (Next.js + `pnpm inngest:dev`), the demo prompt, and the restart test.

## 11. Testing

| Layer | File | What |
|---|---|---|
| Pure | `tests/approval-policy.test.ts` | Table-driven matrix of `(toolName, input) → require?` |
| Pure | `tests/approvals-canusetool.test.ts` | Fake `step.waitForEvent` returning approve/deny/modify/null; fake `gateRepo`; assert `PermissionResult` |
| DB-hitting | `tests/approval-gates.test.ts` | `openGate` → `resolveGate(approved/denied/modified)` → `expireGate` state transitions + invariants |
| DB-hitting | `tests/resolve-approval-action.test.ts` | Server action validation errors, double-resolve rejection, DB transaction atomicity |
| SSE integration | extend `tests/task-api-queries.test.ts` | `appendTaskEventAuto` conflict retry + seq monotonicity |
| Manual | README §Phase 07 | Restart survival demo |

**Not unit-tested**: the Inngest → SDK handshake end-to-end (that's what the manual demo proves). Phase 12 adds CI integration tests that spin up the Inngest dev server in a container.

## 12. Risks / open questions

1. **SDK streaming-input prompt surface area.** The SDK's `SDKUserMessage` shape has shifted across alpha releases. We pin `@anthropic-ai/claude-agent-sdk@0.2.117` (current) and assert in a unit test that our generator satisfies the type. If the next SDK bump changes `session_id`'s expected initial value (currently `''`), the test breaks before anything else does.
2. **Inngest dev server port conflict.** Default `8288` overlaps with… almost nothing, but the user may already have a service bound. Mitigation: README explains `npx inngest-cli@latest dev -p <other>`. The client auto-detects via `INNGEST_DEV` env var.
3. **Server Action auth.** With no auth in phase 07, any browser can POST to `resolveApproval`. Local dev only; phase 11's Better Auth gates it. Documented in README as "do not deploy phase 07 to the internet."
4. **Concurrent gate writes.** Covered by `appendTaskEventAuto`'s ON CONFLICT retry (§5). If three writers ever hit the same run (unlikely pre-phase-08), retries climb but correctness holds.
5. **Inngest replay semantics.** `step.waitForEvent` is deterministic across replays (same event matches same step). If we ever add **non-deterministic** code (e.g. `Math.random()`) between `runOrchestrator`'s first line and the step, replays could diverge. Mitigation: `taskStartedFn` has zero non-determinism outside the SDK call itself, and the SDK call is wrapped in the step via `canUseTool` boundaries — everything *before* the first wait re-runs identically on replay.
6. **Turbopack hot-reload during a live canUseTool wait.** The SDK side-car process restart interrupts any open request; Inngest's step replay restarts the function from the top. On replay `runOrchestrator` re-calls `query()` which starts a fresh SDK session — this is **not** the seamless resume we want. Phase 07 documents this as a known dev-only wrinkle: if you hot-reload during a gate, the run starts over (gate row stays, decision event still fires when you approve, but the agent's context resets). Phase 12's sandbox process fixes this because the SDK runs outside the Next.js module boundary.
7. **Modify with malformed JSON.** The Server Action `JSON.parse(modifiedInput)` throws on invalid input → caught at the form boundary, returns `invalid_body` to the form submission. The UI disables the Modify button until the JSON textarea parses.
8. **Denied tool looks like an error to the SDK.** The SDK surfaces `{behavior:'deny'}` as a tool-result with `is_error: true`. The orchestrator's next assistant turn is free to retry with different input or give up; we don't special-case it here.
