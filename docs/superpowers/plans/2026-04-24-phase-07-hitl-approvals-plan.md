# Phase 07 — HITL approvals (plan)

**Date:** 2026-04-24
**Status:** ready to execute
**Design reference:** `docs/superpowers/specs/2026-04-24-phase-07-hitl-approvals-design.md`
**Plan references:** `auto-ride-initial-plan.md` §3, §4
**Roadmap entry:** `docs/roadmap/ROADMAP.md` — phase 07

This is the ordered, atomic task list that implements phase 07. Each step ends in a verifiable state. Commits follow `feat(phase-07):` / `test(phase-07):` / `docs(phase-07):` / `refactor(phase-07):`.

## Execution order

Front-load testable code (policy, gate state machine, server action) behind module boundaries that don't yet require Inngest at runtime. Bring Inngest online once those boundaries are tested. End with the UI + manual demo.

| # | Step | Commits | Verifies |
|---|---|---|---|
| 1 | Design + plan docs | 1 | Files under `docs/superpowers/` |
| 2 | Add `inngest` dep + `inngest:dev` script + Quickstart placeholder | 1 | `package.json` patched; user installs manually |
| 3 | `approval-policy` module + table-driven tests | 1 | `pnpm test tests/approval-policy.test.ts` green |
| 4 | `approval-gates` DB queries + state-machine tests | 2 (queries, tests) | `pnpm test tests/approval-gates.test.ts` green |
| 5 | `appendTaskEventAuto` (ON CONFLICT retry seq helper) + tests | 1 | Existing phase-06 helper extended; uniqueness preserved under contention |
| 6 | `lib/inngest/{client,events,functions}.ts` + serve route | 2 (client+events, function+route) | `GET /api/inngest` returns inngest serve metadata |
| 7 | `lib/agent/approvals.ts` (`createCanUseTool`) + unit tests w/ fake step | 2 (impl, tests) | `pnpm test tests/approvals-canusetool.test.ts` green |
| 8 | Refactor `runOrchestrator` → streaming-input + `canUseTool` | 1 | Phase-05 query-demo regression: `pnpm query:demo "hi"` still completes |
| 9 | Route `start-task` through Inngest event | 1 | `POST /api/tasks` triggers `taskStartedFn` (verified via Inngest dev UI) |
| 10 | Server Action `resolveApproval` + tests | 2 (action, tests) | `pnpm test tests/resolve-approval-action.test.ts` green |
| 11 | `<ApprovalRequest>` timeline component + types extension | 1 | `TimelineEventRenderer` handles `approval_request` |
| 12 | `<ApprovalBar>` + `/tasks/[id]` page wire-up | 2 (component, page) | Manual: pending gate renders banner; clicking Approve resolves |
| 13 | README Phase 07 Quickstart + manual demo screenshots | 1 | `docs/superpowers/specs/assets/phase-07-*.png` exist |
| 14 | Open PR | n/a | `gh pr create --title "phase 07: HITL approvals"` |

## Step-by-step

### Step 1 — docs

Already drafted at step start: this plan + the design spec.

**Commit:** `docs(phase-07): HITL approvals design spec and implementation plan`

**Files:**
- `docs/superpowers/specs/2026-04-24-phase-07-hitl-approvals-design.md`
- `docs/superpowers/plans/2026-04-24-phase-07-hitl-approvals-plan.md`

**`.gitignore`:** the existing `*.md` exclusion blocks these by default. Phase 06's commit `2045959` shows the precedent — explicit allow lines are added in `.gitignore` for each phase's design + plan. We add two lines for phase 07 in this same commit.

**Verify:** `git status` shows the two markdown files staged; `git ls-files docs/superpowers/specs/` lists the new design doc.

---

### Step 2 — `inngest` dependency + dev sidecar script

Edit `package.json`:

```diff
   "scripts": {
     "dev": "next dev --turbopack",
+    "inngest:dev": "npx inngest-cli@latest dev -u http://localhost:3000/api/inngest",
     ...
   },
   "dependencies": {
+    "inngest": "^3.43.0",
     ...
   }
```

**User does** `pnpm install` manually (memory: don't run pnpm install in this repo).

**Commit:** `chore(phase-07): add inngest dependency + dev sidecar script`

**Verify (post-install):** `pnpm typecheck` succeeds; `node -e "import('inngest').then(m => console.log(Object.keys(m)))"` prints `Inngest`, `EventSchemas`, etc.

---

### Step 3 — `approval-policy` module + tests

**New file:** `lib/agent/approval-policy.ts`

```ts
export type ApprovalDecisionHint =
  | { require: false }
  | { require: true; reason: string };

export function shouldRequireApproval(
  toolName: string,
  input: unknown,
): ApprovalDecisionHint;

export const BASH_WHITELIST: readonly RegExp[];
```

Implementation per design §2. Pure function, no IO. Re-exports the whitelist for tests.

**New file:** `tests/approval-policy.test.ts`

Table-driven cases:

| toolName | input | expected.require | reason snippet |
|---|---|---|---|
| `mcp__stripe__charge` | `{amount:1000}` | true | "Payment tool" |
| `mcp__stripe__refund` | `{}` | true | "Payment tool" |
| `Bash` | `{command:'ls -la'}` | false | — |
| `Bash` | `{command:'git status'}` | false | — |
| `Bash` | `{command:'rm -rf /tmp/x'}` | true | "Non-whitelisted Bash" |
| `Bash` | `{}` | true | "Non-whitelisted Bash" (empty cmd ≠ whitelisted) |
| `Write` | `{file_path:'src/foo.ts'}` | true | "Write to source tree" |
| `Write` | `{file_path:'docs/x.md'}` | false | — |
| `Read` | `{file_path:'/etc/passwd'}` | false | — (Read isn't gated) |
| `mcp__memory__recall` | `{query:'fleet'}` | false | — |

**Commit:** `feat(phase-07): approval policy module + table-driven tests`

**Verify:** `pnpm test tests/approval-policy.test.ts`.

---

### Step 4 — `approval-gates` DB queries + tests

**New file:** `db/queries/approval-gates.ts`

Export:

```ts
export async function openGate(args: {
  id: string;                    // gate UUID, generated by caller
  runId: string;
  taskId: string;
  toolName: string;
  proposedInput: unknown;
}): Promise<void>;

export async function resolveGate(args: {
  id: string;
  status: 'approved' | 'modified' | 'denied';
  reviewerId?: string;            // default 'local-dev'
  reviewerNote?: string;
  resolutionInput?: unknown;      // required when status === 'modified'
}): Promise<void>;

export async function expireGate(id: string): Promise<void>;

export async function listPendingForTask(taskId: string): Promise<GateSummary[]>;

export async function getGateById(id: string): Promise<GateRow | null>;
```

Shapes:

```ts
export type GateRow = {
  id: string;
  runId: string;
  taskId: string;
  toolName: string;
  proposedInput: unknown;
  status: 'pending' | 'approved' | 'modified' | 'denied' | 'timed_out';
  resolutionInput: unknown | null;
  reviewerNote: string | null;
  reviewerId: string | null;
  inngestEventKey: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  timedOutAt: Date | null;
};

export type GateSummary = Pick<GateRow,
  'id' | 'runId' | 'taskId' | 'toolName' | 'proposedInput' | 'status' | 'createdAt'>;
```

**Invariants enforced in code (not constraints):**

- `resolveGate` rejects if current `status !== 'pending'` (returns informative error; does not throw on duplicate calls so the Server Action can short-circuit).
- `expireGate` is similarly guarded.
- `resolveGate({ status: 'modified', resolutionInput: undefined })` throws — caller bug.

**New file:** `tests/approval-gates.test.ts`

Cases (DB-hitting, like phase 06's `tests/task-api-queries.test.ts`):

1. `openGate` → row exists, `status='pending'`, `proposedInput` is the JSON we passed.
2. `resolveGate({status:'approved'})` flips status, sets `resolvedAt` non-null, leaves `timedOutAt` null.
3. `resolveGate({status:'modified', resolutionInput})` populates `resolution_input` jsonb.
4. `resolveGate({status:'denied', reviewerNote:'too risky'})` populates `reviewer_note`.
5. Double `resolveGate` no-ops without throwing; second call returns `{ ok: false, status: <existing> }`.
6. `expireGate` flips to `timed_out`, sets `timedOutAt`, leaves `resolvedAt` null.
7. `listPendingForTask` returns only pending rows for the task; ignores resolved/expired.

**Commits:**
1. `feat(phase-07): approval-gates DB query helpers`
2. `test(phase-07): approval-gates state machine`

**Verify:** `pnpm test tests/approval-gates.test.ts`.

---

### Step 5 — `appendTaskEventAuto` (seq retry helper)

**Edit:** `db/queries/task-runtime.ts` (or new sibling file `task-events.ts`).

Phase 06's `appendTaskEvent({ runId, taskId, seq, type, payload })` requires the caller to compute `seq`. Phase 07 introduces a Server Action writer that doesn't have a running counter. New helper:

```ts
export async function appendTaskEventAuto(args: {
  runId: string;
  taskId: string;
  type: TaskEventType;
  payload: Record<string, unknown>;
}): Promise<{ id: bigint; seq: number }>;
```

Implementation: the SQL in design §5, wrapped in a 3-attempt retry loop on `task_events_run_seq_uq` violation. Throws if all retries fail (unrecoverable contention).

**Tests** (extend `tests/task-api-queries.test.ts` or new `tests/append-event-auto.test.ts`):

1. Single writer: `appendTaskEventAuto` returns `seq=0`, `seq=1`, … for sequential calls.
2. Two parallel writers (Promise.all of 10 inserts each): all 20 rows commit, every `seq` from `0..19` appears exactly once.
3. After `appendTaskEvent` (manual seq) then `appendTaskEventAuto`: auto picks up at the right number.

**Commit:** `feat(phase-07): seq-safe appendTaskEventAuto helper`

**Verify:** new tests + existing phase-05/06 tests still green (no regression in `appendTaskEvent`).

---

### Step 6 — Inngest client + functions + serve route

**New file:** `lib/inngest/client.ts`

```ts
import { Inngest } from 'inngest';
import { eventSchemas } from './events';

export const inngest = new Inngest({ id: 'auto-ride', schemas: eventSchemas });
```

**New file:** `lib/inngest/events.ts`

```ts
import { EventSchemas } from 'inngest';
import { z } from 'zod';

export const taskStartedSchema = z.object({
  taskId: z.string().uuid(),
  prompt: z.string(),
  maxBudgetUsd: z.number().optional(),
  maxTurns: z.number().optional(),
});

export const approvalDecidedSchema = z.object({
  gateId: z.string().uuid(),
  approved: z.boolean(),
  reason: z.string().nullable().optional(),
  modifiedInput: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const eventSchemas = new EventSchemas().fromZod({
  'auto-ride/task.started':     { data: taskStartedSchema },
  'auto-ride/approval.decided': { data: approvalDecidedSchema },
});
```

**New file:** `lib/inngest/functions.ts`

Per design §7. Exports `taskStartedFn` only for now (the approval-decided event is consumed *inside* `taskStartedFn` via `step.waitForEvent`, so no separate function).

**New file:** `app/api/inngest/route.ts`

```ts
import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { taskStartedFn } from '@/lib/inngest/functions';

export const dynamic = 'force-dynamic';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [taskStartedFn],
});
```

**Verification:**
- After `pnpm install`: start `pnpm dev` and `pnpm inngest:dev` in two terminals.
- `curl http://localhost:3000/api/inngest` returns Inngest's introspection JSON.
- Inngest dev UI at `http://localhost:8288` lists `auto-ride/task.started`.

**Commits:**
1. `feat(phase-07): inngest client + typed event schemas`
2. `feat(phase-07): taskStartedFn + serve route`

---

### Step 7 — `createCanUseTool` factory + tests

**New file:** `lib/agent/approvals.ts`

Per design §3. Factory function returning `CanUseTool`. Accepts `{ taskId, runId, step, gateRepo? }`. Default `gateRepo` calls real DB helpers; tests inject a fake.

**New file:** `tests/approvals-canusetool.test.ts`

Cases (no DB, pure unit with fakes):

1. **Allow path** — `shouldRequireApproval` returns `{require:false}` → `canUseTool` returns `{behavior:'allow'}` immediately. No gate row, no event, no `step.waitForEvent` call.
2. **Approve** — fake `step.waitForEvent` returns `{ data: { gateId, approved: true } }` → `canUseTool` opens gate, marks task awaiting, waits, sees approved, returns `{behavior:'allow'}`. Verify gate `openGate` called once; `markTaskAwaitingApproval` called once; `markTaskInProgress` called after decision.
3. **Modify** — same as Approve but with `modifiedInput` in event data → `canUseTool` returns `{behavior:'allow', updatedInput:<modifiedInput>}`.
4. **Deny** — event data `{approved:false, reason:'too risky'}` → returns `{behavior:'deny', message:'too risky'}`.
5. **Timeout** — `step.waitForEvent` returns `null` → `expireGate` called, returns `{behavior:'deny', message:/timed out/}`.
6. **AbortSignal aborted** — even after a decision, an aborted signal returns `deny` with run-aborted message.
7. **Streaming-input generator smoke** — assert `userPrompt('hi')` yields exactly one `SDKUserMessage` with `role:'user'` and `content:'hi'` then completes.

**Commits:**
1. `feat(phase-07): canUseTool factory wiring DB + Inngest step`
2. `test(phase-07): canUseTool gate lifecycle (fake step)`

---

### Step 8 — Refactor `runOrchestrator` to streaming-input + `canUseTool`

**Edit:** `lib/agent/runtime.ts`

Per design §3.1 + §9. Two changes:

1. The `prompt` argument to `query()` becomes `userPrompt(args.prompt)` (an `AsyncGenerator<SDKUserMessage>`).
2. `buildOrchestratorOptions(overrides)` accepts `overrides.canUseTool?: CanUseTool` and threads it onto the SDK `Options` object. `runOrchestrator` calls the factory with the freshly created `runId` and passes the result.

**Edit:** `lib/agent/options.ts`

Add `canUseTool?: CanUseTool` to `BuildOrchestratorOptionsOverrides`. Conditionally include in returned options.

**Regression test:** the phase-05 `query:demo` script still works with no `canUseTool` argument. The CLI invocation `pnpm query:demo "What time is it?"` should run to completion.

**Existing tests** (`tests/agent-persist.test.ts`, `tests/agent-hooks.test.ts`) should remain green; if any assert on the prompt being a string, update to assert it's an async iterable.

**Commit:** `refactor(phase-07): streaming-input prompt + canUseTool plumbing`

**Verify:** `pnpm test` (whole suite) + manual `pnpm query:demo`.

---

### Step 9 — Route `start-task` through Inngest

**Edit:** `lib/runner/start-task.ts`

Replace fire-and-forget `Promise.resolve().then(runOrchestrator)` with:

```ts
export async function startTask(args: StartTaskArgs): Promise<void> {
  await inngest.send({
    name: 'auto-ride/task.started',
    data: {
      taskId: args.taskId,
      prompt: args.prompt,
      ...(args.maxBudgetUsd !== undefined ? { maxBudgetUsd: args.maxBudgetUsd } : {}),
      ...(args.maxTurns !== undefined ? { maxTurns: args.maxTurns } : {}),
    },
  });
}
```

Note the **signature change**: `startTask` is now async. The phase-06 caller in `app/api/tasks/route.ts` was `void startTask(...)` — change to `await startTask(...)` and add a try/catch that finalizes the task to `failed` if the Inngest send fails (otherwise the SSE stream polls forever).

**Edit:** `app/api/tasks/route.ts` — switch to `await startTask`, wrap in try/catch.

**Existing tests** `tests/start-task.test.ts` need rewriting — they covered the fire-and-forget error path which no longer exists. New tests:

1. Success: mock `inngest.send`; assert it's called once with the right `name` + `data`.
2. Failure: mock `inngest.send` to throw → `startTask` rethrows; the route handler catches and finalizes the task to `failed`.

**Commit:** `feat(phase-07): startTask sends auto-ride/task.started event`

**Verify:** unit tests + `curl POST /api/tasks` with `pnpm dev` + `pnpm inngest:dev` running → Inngest dev UI shows the function fired.

---

### Step 10 — `resolveApproval` Server Action + tests

**New file:** `app/tasks/[id]/actions.ts`

Per design §6.

**New file:** `tests/resolve-approval-action.test.ts`

Cases:

1. Missing fields → `{ok:false, error:'invalid_body', issues:[...]}`.
2. Unknown gateId → `{ok:false, error:'gate_not_found'}`.
3. Already-resolved gate (status `approved`) → `{ok:false, error:'gate_already_resolved', status:'approved'}`.
4. Approve happy path → DB row updated, `appendTaskEventAuto` called with `subtype:'resolved'`, `inngest.send` called with `approved:true`.
5. Modify with valid JSON → `resolutionInput` populated, event payload includes `modified_input`, Inngest event `modifiedInput` matches.
6. Deny with reason → status `'denied'`, event reason populated.
7. Inngest send throws → DB still committed (transaction succeeded before send); Server Action returns `{ok:true}` with a logged warning. (We don't fail the user-visible decision on Inngest send retry.)

**Commits:**
1. `feat(phase-07): resolveApproval Server Action`
2. `test(phase-07): resolveApproval validation + state transitions`

**Verify:** `pnpm test tests/resolve-approval-action.test.ts` green.

---

### Step 11 — `<ApprovalRequest>` timeline component

**New file:** `components/timeline/ApprovalRequest.tsx`

Per design §8.3. Two visual variants on `payload.subtype` (`opened` vs `resolved`).

**Edit:** `components/timeline/types.ts`

Extend `TimelineEvent.type` union:

```diff
- type: 'assistant_turn' | 'tool_call' | 'tool_result' | 'compact_boundary' | 'run_result' | 'user_message';
+ type: 'assistant_turn' | 'tool_call' | 'tool_result' | 'compact_boundary' | 'run_result' | 'user_message' | 'approval_request';
```

Add a `ApprovalRequestPayload` exported type with `subtype: 'opened' | 'resolved'` discriminator.

**Edit:** `components/timeline/TimelineEventRenderer.tsx`

```diff
   case 'compact_boundary': return <CompactBoundary event={event} />;
+  case 'approval_request': return <ApprovalRequest event={event} />;
   case 'run_result':       return <RunResult event={event} />;
```

**Smoke test:** extend `tests/timeline-renderer.test.tsx` with two fixtures (opened, resolved). Assert no throw and the discriminator routes correctly.

**Commit:** `feat(phase-07): ApprovalRequest timeline component`

**Verify:** `pnpm test tests/timeline-renderer.test.tsx` green.

---

### Step 12 — `<ApprovalBar>` + `/tasks/[id]` page wire-up

**New file:** `app/tasks/[id]/approval-bar.tsx`

Per design §8.2. Client component, opens its own `EventSource`, shows `<ApprovalCard>` per pending gate.

**New file (sub-component):** `app/tasks/[id]/approval-card.tsx`

Form-driven UI:

```tsx
<form action={resolveApproval}>
  <input type="hidden" name="gateId" value={gate.id} />
  <textarea name="reason" placeholder="Reason (optional for approve)" />
  <textarea name="modifiedInput" placeholder="JSON to modify input (optional)" />
  <button name="decision" value="approve">Approve</button>
  <button name="decision" value="modify">Approve modified</button>
  <button name="decision" value="deny">Deny</button>
</form>
```

Validation: client-side disable Modify until JSON parses; otherwise inline error.

**Edit:** `app/tasks/[id]/page.tsx`

```diff
+ const initialPendingGates = await listPendingForTask(taskId);
   ...
+  <ApprovalBar taskId={task.id} initialGates={initialPendingGates} />
   <TimelineStream … />
```

**Manual demo verification** (in README §13):
1. Start `pnpm dev` + `pnpm inngest:dev`.
2. POST `/api/tasks` with prompt `"Run 'rm -rf /tmp/demo' to clean up"` (or any prompt that hits a gated tool — the orchestrator will likely produce a `Bash` rm call).
3. Browse to `/tasks/<id>`. Wait until the orchestrator decides to call Bash. Approval bar appears.
4. Click Approve. SDK proceeds; run completes.
5. **Restart test:** repeat steps 2–3, then `Ctrl+C` the `pnpm dev` server while the bar is shown. Restart `pnpm dev`. Refresh `/tasks/<id>` (the approval bar still shows the gate from DB). Click Approve. Run completes.

**Commits:**
1. `feat(phase-07): ApprovalBar + ApprovalCard client components`
2. `feat(phase-07): wire pending gates into /tasks/[id] page`

---

### Step 13 — README Phase 07 Quickstart + screenshots

**Edit:** `README.md`

Add a `## Phase 07 — HITL approvals` section right after the phase-06 Quickstart. Include:

- 2-terminal layout: `pnpm dev` + `pnpm inngest:dev` (and a 3rd if you want `pnpm tasks:demo`-style scripted POSTs).
- Demo prompt that reliably hits a gate (`"Use Bash to run 'rm -rf /tmp/demo'"`).
- Screenshot: `docs/superpowers/specs/assets/phase-07-approval-bar.png` (PNG of the bar with three buttons).
- Screenshot: `docs/superpowers/specs/assets/phase-07-resolved-timeline.png` (timeline showing opened + resolved cards in sequence).
- Restart-survival demo write-up (matches design §10 acceptance criterion 6).
- Known limitation: Turbopack hot-reload during a wait restarts the SDK from the top (design §12 risk 6).

**`.gitignore`:** add allow-lines for the two new screenshots (existing `*.md` exclusion + assets convention from phase 06).

**Commit:** `docs(phase-07): README quickstart for HITL approvals`

---

### Step 14 — Open PR

```bash
gh pr create \
  --base main \
  --head phase/07-hitl-approvals \
  --title "phase 07: HITL approvals" \
  --body-file <(cat <<'EOF'
## Summary

- `canUseTool` gate that pauses orchestrator before risky tool calls
- Inngest `step.waitForEvent('auto-ride/approval.decided', timeout='24h')` for durable wait
- Approval bar UI on `/tasks/[id]` with Approve / Modify / Deny actions
- Server Action `resolveApproval` validates input + writes gate row + sends Inngest event
- Streaming-input migration for the SDK prompt (required by `canUseTool`)
- New seq-safe `appendTaskEventAuto` helper for the second event writer (Server Action)

Plan §§ 3 (SDK primitives) and 4 (durable HITL).
Design spec: `docs/superpowers/specs/2026-04-24-phase-07-hitl-approvals-design.md`.

## Phase checklist

- [x] Worktree at `.worktree/phase-07-hitl-approvals/`, branch `phase/07-hitl-approvals`
- [x] Git identity verified
- [x] Design spec exists
- [x] Implementation plan exists
- [x] All acceptance criteria in spec checked off (§10)
- [x] No regressions in prior phases (`pnpm test` + `pnpm typecheck` + `pnpm build`)
- [x] PR title is `phase 07: HITL approvals`
- [x] PR body links plan §§ and design spec
EOF
)
```

---

## Definition of done (phase 07)

- All 10 acceptance criteria from the design spec checked off.
- Manual restart-survival demo recorded (screenshot or short capture).
- `pnpm typecheck && pnpm test && pnpm build` green on phase/07 tip.
- PR open at `https://github.com/ShahriarBijoy/agent-swarm/pulls`.
