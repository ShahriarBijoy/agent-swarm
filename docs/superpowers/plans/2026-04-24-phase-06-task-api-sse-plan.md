# Phase 06 — task API + SSE timeline (plan)

**Date:** 2026-04-24
**Status:** ready to execute
**Design reference:** `docs/superpowers/specs/2026-04-24-phase-06-task-api-sse-design.md`
**Plan references:** `auto-ride-initial-plan.md` §3, §7

This is the ordered, atomic task list that implements phase 06. Each step ends in a verifiable state (a test passes, a file exists, a route responds). Commits follow the `feat(phase-06):` / `test(phase-06):` / `docs(phase-06):` / `refactor(phase-06):` pattern, one per step unless otherwise noted.

## Execution order

Front-load pure/testable code (SSE encoder, zod schema, query helpers). Middle wires the SDK primitive via a non-breaking `runOrchestrator` extension. End delivers the UI and the manual demo.

| # | Step | Commits | Verifies |
|---|---|---|---|
| 1 | Design + plan docs | 1 | Files under `docs/superpowers/` |
| 2 | `task-api` DB query helpers + unit tests | 2 | `pnpm test tests/task-api-queries.test.ts` green |
| 3 | `runOrchestrator` refactor to accept `taskId?` + regression tests | 1 (+ edit existing tests) | All phase-05 tests still green |
| 4 | `start-task` fire-and-forget wrapper + unit tests | 2 | `pnpm test tests/start-task.test.ts` green |
| 5 | SSE encoder helper + unit tests | 2 | `pnpm test tests/sse-encoder.test.ts` green |
| 6 | `POST /api/tasks` route + body validation tests | 2 | `pnpm test tests/task-api-validation.test.ts` green |
| 7 | `GET /api/tasks/[id]/stream` SSE route | 1 | `curl -N /api/tasks/<id>/stream` streams events |
| 8 | Timeline types + 6 presentational components | 2 (types, components) | Storybook-free smoke tests pass; typecheck green |
| 9 | `/tasks/[id]` server page + `<TimelineStream>` client | 2 | Page renders a terminal task without opening ES |
| 10 | `/tasks` list + create form | 2 | Form posts + redirects; list renders recent rows |
| 11 | README Phase 06 Quickstart + manual browser demo | 1 | Screenshot recorded for PR body |
| 12 | Open PR | n/a | `gh pr create --title "phase 06: task API + SSE timeline"` |

## Step-by-step

### Step 1 — docs

Already committed at step start: the spec + this plan file.

**Commit:** `docs(phase-06): task API + SSE timeline design spec and implementation plan`

**Files:**
- `docs/superpowers/specs/2026-04-24-phase-06-task-api-sse-design.md`
- `docs/superpowers/plans/2026-04-24-phase-06-task-api-sse-plan.md`

**Verify:** `ls docs/superpowers/specs/ docs/superpowers/plans/`.

---

### Step 2 — `task-api` DB query helpers + tests

**New file:** `db/queries/task-api.ts`

Export:

```ts
export async function createQueuedTask(args: {
  prompt: string;
  maxBudgetUsd?: number;
  maxTurns?: number;
  createdBy?: string;
  metadata?: Record<string, unknown>;
}): Promise<{ id: string; createdAt: Date }>;

export async function markTaskInProgress(taskId: string): Promise<void>;

export async function getTaskById(taskId: string): Promise<TaskRow | null>;

export async function getEventsSince(args: {
  taskId: string;
  afterId: bigint;  // bigserial cursor
  limit?: number;   // default 200
}): Promise<TaskEventRow[]>;

export async function listRecentTasks(limit?: number): Promise<TaskSummary[]>;
```

Shapes:

```ts
export type TaskRow = {
  id: string;
  prompt: string;
  status: TaskStatus;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  createdBy: string | null;
  maxBudgetUsd: string | null;  // numeric stays string in drizzle
  maxTurns: number | null;
};

export type TaskEventRow = {
  id: bigint;
  seq: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt: Date;
};

export type TaskSummary = Pick<TaskRow, 'id' | 'prompt' | 'status' | 'createdAt' | 'completedAt'>;
```

**`createQueuedTask` details:**

```ts
const [row] = await db.insert(tasks).values({
  prompt: args.prompt,
  status: 'queued',                              // <-- differs from existing createTask
  ...(args.maxBudgetUsd !== undefined ? { maxBudgetUsd: args.maxBudgetUsd.toFixed(4) } : {}),
  ...(args.maxTurns !== undefined ? { maxTurns: args.maxTurns } : {}),
  createdBy: args.createdBy ?? 'http',
  ...(args.metadata !== undefined ? { metadata: args.metadata } : {}),
}).returning({ id: tasks.id, createdAt: tasks.createdAt });
```

**`markTaskInProgress` details:** idempotent — UPDATE only if status is `queued`; no-op if already `in_progress`.

```ts
await db.update(tasks)
  .set({ status: 'in_progress', updatedAt: new Date() })
  .where(and(eq(tasks.id, taskId), eq(tasks.status, 'queued')));
```

**`getEventsSince` details:** joins on `task_runs.task_id = $taskId` to include events from all attempts (phase 06 only has one attempt per task, but phase 07 retries will add more).

```ts
return db.select({
  id: taskEvents.id,
  seq: taskEvents.seq,
  type: taskEvents.type,
  payload: taskEvents.payload,
  createdAt: taskEvents.createdAt,
}).from(taskEvents)
  .where(and(eq(taskEvents.taskId, args.taskId), gt(taskEvents.id, args.afterId)))
  .orderBy(asc(taskEvents.id))
  .limit(args.limit ?? 200);
```

**New file:** `tests/task-api-queries.test.ts`

- `createQueuedTask` inserts with `status: 'queued'` and returns `{id, createdAt}`
- `markTaskInProgress` transitions queued → in_progress
- `markTaskInProgress` is no-op on `in_progress` (call twice, verify updatedAt doesn't regress)
- `markTaskInProgress` is no-op on terminal states (`done`, `failed`)
- `getEventsSince({afterId: 0})` returns all events for the task ordered by id
- `getEventsSince({afterId: N})` returns only events with `id > N`
- `getTaskById` returns `null` for missing id
- `listRecentTasks` orders by `createdAt DESC`, respects limit

**Commits:**
- `feat(phase-06): task-api query helpers (createQueuedTask / getEventsSince / …)`
- `test(phase-06): task-api query helpers`

**Verify:** `pnpm test tests/task-api-queries.test.ts`.

---

### Step 3 — `runOrchestrator` accepts optional `taskId`

**File edit:** `lib/agent/runtime.ts`

Add `taskId?: string` to `RunOrchestratorArgs`. In the body:

```ts
let taskId: string;
if (args.taskId) {
  const existing = await getTaskById(args.taskId);
  if (!existing) throw new Error(`runOrchestrator: task ${args.taskId} not found`);
  if (!['queued', 'in_progress'].includes(existing.status)) {
    throw new Error(`runOrchestrator: task ${args.taskId} is ${existing.status}, cannot run`);
  }
  await markTaskInProgress(args.taskId);
  taskId = args.taskId;
} else {
  const created = await createTask({
    prompt: args.prompt,
    maxBudgetUsd: args.maxBudgetUsd,
    maxTurns: args.maxTurns,
    createdBy: args.createdBy ?? 'cli',
  });
  taskId = created.id;
}
```

Everything after this block (createTaskRun, the for-await loop, finalize) stays identical.

**Test edit:** existing `tests/agent-runtime.test.ts` gains two cases:
- `runOrchestrator({ taskId })` with a queued task → marks in_progress → runs.
- `runOrchestrator({ taskId })` with an `in_progress` task → no-op on status update, runs.
- `runOrchestrator({ taskId })` with a missing task → throws.

These reuse the phase-05 `[live]` test scaffolding (skipped by default) but the "missing task throws" case can run without Anthropic creds — split it out as a non-`[live]` unit test.

**Commit:** `refactor(phase-06): runOrchestrator accepts optional taskId for HTTP-kickoff path`

**Verify:** all existing phase-05 tests still green. `pnpm typecheck` clean.

---

### Step 4 — `start-task` fire-and-forget wrapper + tests

**New file:** `lib/runner/start-task.ts`

```ts
import { runOrchestrator } from '@/lib/agent/runtime';
import { finalizeTask } from '@/db/queries/task-runtime';

export type StartTaskArgs = {
  taskId: string;
  prompt: string;
  maxBudgetUsd?: number;
  maxTurns?: number;
};

/**
 * Kick off the orchestrator for an existing queued task. Fire-and-forget:
 * the caller (POST /api/tasks) returns immediately. Errors are captured and
 * the task is finalized to `failed` so the UI doesn't poll forever.
 *
 * PHASE 06 LIMITATION: in Turbopack dev, a hot-reload while the runner is
 * mid-flight will kill the process. Phase 07 introduces Inngest for durability.
 */
export function startTask(args: StartTaskArgs): void {
  void runOrchestrator({ ...args, createdBy: 'http' }).catch(async (err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[start-task] taskId=${args.taskId} runner rejected:`, message);
    try {
      await finalizeTask({ taskId: args.taskId, status: 'failed' });
    } catch (finalizeErr) {
      console.error(`[start-task] taskId=${args.taskId} could not finalize failed:`, finalizeErr);
    }
  });
}
```

**New file:** `tests/start-task.test.ts`

Mock `runOrchestrator` + `finalizeTask` via `vi.mock` so the test doesn't hit Anthropic.

- Happy path: `runOrchestrator` resolves → `finalizeTask` NOT called.
- Rejection path: `runOrchestrator` rejects → `finalizeTask({status: 'failed'})` called with the right taskId.
- Rejection + finalize-also-fails: both errors logged; no uncaught rejection (test by waiting for microtask drain).
- `startTask` returns `void` synchronously — the underlying promise isn't awaited by callers.

**Commits:**
- `feat(phase-06): start-task fire-and-forget runner wrapper`
- `test(phase-06): start-task error capture path`

**Verify:** `pnpm test tests/start-task.test.ts`.

---

### Step 5 — SSE encoder helper + tests

**New file:** `lib/sse/encode.ts`

```ts
import type { TaskEventRow } from '@/db/queries/task-api';

export function formatTaskEvent(row: TaskEventRow): string {
  const data = {
    id: Number(row.id),
    seq: row.seq,
    type: row.type,
    payload: row.payload,
    createdAt: row.createdAt.toISOString(),
  };
  return `id: ${Number(row.id)}\nevent: task_event\ndata: ${JSON.stringify(data)}\n\n`;
}

export function formatTerminal(task: { status: string; /* totals from final run_result event */ }): string {
  return `event: done\ndata: ${JSON.stringify({ status: task.status })}\n\n`;
}

export function formatHeartbeat(): string {
  return `: heartbeat\n\n`;
}
```

**New file:** `tests/sse-encoder.test.ts`

- `formatTaskEvent` emits `id: <N>\nevent: task_event\ndata: {...}\n\n`.
- The JSON payload is valid JSON (round-trip via `JSON.parse`).
- `createdAt` is serialized as ISO string.
- `formatTerminal` emits `event: done` with the status.
- `formatHeartbeat` emits a comment-only SSE record (starts with `:`).

**Commits:**
- `feat(phase-06): SSE encode helpers`
- `test(phase-06): SSE encoder format`

**Verify:** `pnpm test tests/sse-encoder.test.ts`.

---

### Step 6 — `POST /api/tasks` route + validation tests

**New file:** `app/api/tasks/route.ts`

Skeleton per spec §3. Set `export const dynamic = 'force-dynamic'` so Next doesn't try to statically analyze the POST.

**New file:** `tests/task-api-validation.test.ts`

Unit-test the exported `bodySchema` (extract into a separate file `lib/validation/task-body.ts` so tests don't have to import a Next route handler):

- Valid body → `safeParse` success.
- Missing `prompt` → fail.
- Empty `prompt` → fail.
- `prompt.length > 4000` → fail.
- `maxBudgetUsd = -1` → fail (below 0).
- `maxBudgetUsd = 10` → fail (above 5.0 clamp).
- `maxTurns = 0` → fail (below 1).
- `maxTurns = 1000` → fail (above 100).
- Non-JSON body handled by the route's `safeJson` helper (test via direct fn call if exported, or at integration level).

**Commits:**
- `feat(phase-06): POST /api/tasks route + body schema`
- `test(phase-06): task POST body validation`

**Verify:** `pnpm test tests/task-api-validation.test.ts`. Smoke-test locally:

```
curl -X POST http://localhost:3000/api/tasks -H 'content-type: application/json' \
  -d '{"prompt":"Check the fleet."}'
# → {"taskId":"...","status":"queued","createdAt":"2026-04-24T..."}
```

---

### Step 7 — SSE stream route

**New file:** `app/api/tasks/[id]/stream/route.ts`

Implementation per spec §4. Key decisions:

- `POLL_INTERVAL_MS = 500`.
- Heartbeat comment every 15s (guards against proxy idle-timeout, cheap).
- On `req.signal.aborted` in the loop check, break and close cleanly.
- Wrap each poll in a try/catch so a transient DB error doesn't kill the stream — log + sleep + retry up to 5 times, then `controller.error`.

**Commit:** `feat(phase-06): SSE stream route for task_events tail`

**Verify:** Start dev server, POST a task, then:

```
curl -N http://localhost:3000/api/tasks/<taskId>/stream
# Should see repeated `id: N\nevent: task_event\ndata: {...}\n\n` blocks,
# then an `event: done` block, then EOF.
```

Reconnect test:

```
curl -N -H 'Last-Event-ID: 3' http://localhost:3000/api/tasks/<taskId>/stream
# Should emit only events with id > 3.
```

---

### Step 8 — Timeline types + 6 presentational components

**New file:** `components/timeline/types.ts` — `TimelineEvent` + narrowed payload shapes per SDK message type. Keep payloads loose (`Record<string, unknown>`) with per-component narrowing helpers, not strict at the type level — the runtime payload is whatever `mapMessageToEvents` produced and narrowing in React is cheaper than a cross-module type contract.

**New files (6):**
- `components/timeline/AssistantTurn.tsx` — renders `payload.message.content`: extract `type === 'text'` blocks, render as prose. Fallback: `<pre>{JSON.stringify(payload.message, null, 2)}</pre>` if no text blocks. Dim tool_use blocks (they're already shown in the next `<ToolCall>`).
- `components/timeline/ToolCall.tsx` — shows tool name + collapsed args; click to expand `<pre>` of full input JSON. Use shadcn `<Button variant="ghost" size="sm">` for the expand toggle.
- `components/timeline/ToolResult.tsx` — shows the `tool_use_id` badge, `is_error` red pill if error, truncated content preview with expand.
- `components/timeline/CompactBoundary.tsx` — one-line marker: `— compact boundary · trigger=<X> —` with a subtle rule.
- `components/timeline/RunResult.tsx` — status badge, cost, turns, duration. Error rendered below if `subtype: 'error'`.
- `components/timeline/UserMessage.tsx` — prompt text in a muted block.

**New file:** `components/timeline/TimelineEventRenderer.tsx`

```tsx
import type { TimelineEvent } from './types';
import { AssistantTurn } from './AssistantTurn';
// ... other imports

export function TimelineEventRenderer({ event }: { event: TimelineEvent }) {
  switch (event.type) {
    case 'user_message':     return <UserMessage payload={event.payload} />;
    case 'assistant_turn':   return <AssistantTurn payload={event.payload} />;
    case 'tool_call':        return <ToolCall payload={event.payload} />;
    case 'tool_result':      return <ToolResult payload={event.payload} />;
    case 'compact_boundary': return <CompactBoundary payload={event.payload} />;
    case 'run_result':       return <RunResult payload={event.payload} />;
    default:                 return null;
  }
}
```

**Smoke test:** `tests/timeline-renderer.test.tsx` (new) — render each component with a fixture payload produced by feeding a canned SDK message through `mapMessageToEvents`. Assert no throw and expected text substring.

**Commits:**
- `feat(phase-06): timeline event types + 6 presentational components`
- `test(phase-06): timeline renderer smoke coverage`

**Verify:** `pnpm typecheck` + `pnpm test tests/timeline-renderer.test.tsx`.

---

### Step 9 — `/tasks/[id]` server page + `<TimelineStream>` client

**New file:** `app/tasks/[id]/page.tsx`

```tsx
export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = await getTaskById(id);
  if (!task) {
    return <NotFoundPlaceholder taskId={id} />;
  }
  const initialEvents = await getEventsSince({ taskId: id, afterId: 0n });
  const initialTerminal = ['done', 'failed', 'cancelled'].includes(task.status)
    ? { status: task.status }
    : null;
  return (
    <main className="mx-auto max-w-3xl p-6">
      <header className="mb-6">
        <h1 className="font-medium">Task</h1>
        <p className="text-sm text-muted-foreground">{task.prompt}</p>
        <p className="font-mono text-xs text-muted-foreground">{task.id}</p>
      </header>
      <TimelineStream taskId={task.id} initialEvents={serializeEvents(initialEvents)} initialTerminal={initialTerminal} />
    </main>
  );
}
```

`serializeEvents` converts `TaskEventRow[]` → `TimelineEvent[]` (bigint → number, Date → ISO string) so the client bundle never sees a bigint.

**New file:** `app/tasks/[id]/timeline-stream.tsx`

Per spec §6.3.

**New file:** `app/tasks/[id]/not-found-placeholder.tsx` — shows "waiting for task..." + retries `getTaskById` via `useEffect` + `setInterval` (1s), auto-redirects once the task appears. This is the race-on-create guard.

**Commits:**
- `feat(phase-06): /tasks/[id] server page with SSR initial events`
- `feat(phase-06): TimelineStream client + race-on-create placeholder`

**Verify:** Start dev server. Manually POST a task via curl (step 6). Visit `/tasks/<uuid>` — see the timeline render live.

---

### Step 10 — `/tasks` list + create form

**New file:** `app/tasks/page.tsx` (server component)

- Top half: form (client component `<CreateTaskForm>`).
- Bottom half: `listRecentTasks(10)` rendered as a table with status badges and `<Link href={`/tasks/${t.id}`}>`.

**New file:** `app/tasks/create-form.tsx` (client component)

```tsx
'use client';

export function CreateTaskForm() {
  const [prompt, setPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      if (!res.ok) throw new Error(`POST failed: ${res.status}`);
      const { taskId } = await res.json();
      router.push(`/tasks/${taskId}`);
    } catch (err) {
      console.error(err);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)}
                rows={4} maxLength={4000}
                placeholder="What should the fleet orchestrator do?"
                className="border rounded p-2 font-mono text-sm" />
      <Button type="submit" disabled={submitting || !prompt.trim()}>
        {submitting ? 'Creating…' : 'Create task'}
      </Button>
    </form>
  );
}
```

**Commits:**
- `feat(phase-06): /tasks list page with recent tasks table`
- `feat(phase-06): create-task form with redirect on POST success`

**Verify:** Browser at `/tasks` — form renders, list renders, submission redirects to `/tasks/[id]`.

---

### Step 11 — README Phase 06 Quickstart + manual browser demo

**File edit:** `README.md`

Add a "Phase 06 — task API + SSE timeline" section mirroring the phase 05 style:
- One-line intent.
- Quickstart snippet (`pnpm dev`, then open `/tasks`, type prompt, click Create).
- The Turbopack hot-reload limitation warning.
- A short curl example for scripted task creation.

**Manual demo:**

Using Playwright MCP tools — navigate to the dev server, create a task, screenshot the live timeline. Commit the screenshot as `docs/superpowers/specs/assets/2026-04-24-phase-06-timeline-demo.png` and link it from the PR body.

**Commit:** `docs(phase-06): README quickstart + timeline demo screenshot`

**Verify:** `pnpm typecheck` + `pnpm test` + `pnpm build` all green. Acceptance criteria §7 all checked.

---

### Step 12 — open PR

```
git push -u origin phase/06-task-api-sse
gh pr create \
  --base main \
  --head phase/06-task-api-sse \
  --title "phase 06: task API + SSE timeline" \
  --body-file docs/superpowers/specs/phase-06-pr-body.md
```

Include the per-phase checklist from `ROADMAP.md` in the PR body, checked off.

## Rollback

Phase 06 is entirely additive — no existing schema changes, no breaking API changes. Rolling back is `git revert <merge-commit>` with no data migration needed. Existing `task-runtime.createTask` keeps its old behavior (status inserted as `in_progress`) for phase-05 CLI callers.
