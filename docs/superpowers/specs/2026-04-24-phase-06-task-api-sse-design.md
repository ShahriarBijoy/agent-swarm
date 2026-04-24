# Phase 06 — task API + SSE timeline (design)

**Date:** 2026-04-24
**Status:** approved (brainstorming)
**Plan references:** `auto-ride-initial-plan.md` §3, §7
**Roadmap entry:** `docs/roadmap/ROADMAP.md` — phase 06

## Purpose

Wrap the phase-05 `runOrchestrator()` primitive in a **web surface**. A user opens `http://localhost:3000/tasks`, types a prompt, clicks "Create task", is redirected to `/tasks/<uuid>`, and watches the orchestrator + fleet-analyst work **live** — every assistant turn, tool call, tool result, and final run summary streaming into the page as they land in Postgres.

The phase proves three primitives end-to-end that the remaining nine phases stack on top of:

1. **HTTP → agent kickoff**: `POST /api/tasks` with a prompt starts a real `query()` without the caller needing CLI access.
2. **DB-tailed SSE**: `GET /api/tasks/[id]/stream` emits `task_events` rows in insertion order, survives tab reconnects via `Last-Event-ID`, and closes cleanly when the run terminates.
3. **Per-message components**: `<AssistantTurn>`, `<ToolCall>`, `<ToolResult>`, `<CompactBoundary>`, `<RunResult>`, `<UserMessage>` render each SDK message type with just enough affordance (expandable JSON for tool inputs, cost/turn summary on result) that the rest of the roadmap can style, not redesign.

Phase 07 (HITL) adds `<ApprovalRequest>` + Inngest `waitForEvent` on top of this surface. Phase 10 (kanban + org chart) reuses the same SSE tail as a multi-task dashboard data source. Phase 11 (auth) gates the routes. Phase 12 (deploy) swaps the fire-and-forget runner for a sandbox/worker process.

## Non-goals

Explicitly out of scope for phase 06 — resist adding them even when convenient:

- **Inngest** event broker and durable workflows. Phase 07 introduces Inngest when `step.waitForEvent` becomes load-bearing for HITL. Phase 06 uses a **fire-and-forget in-process runner** (see §6.4) which is enough for local dev and intentionally fragile to redeploy; we'll swap it in phase 07.
- **`canUseTool` gate / approval bar / `approval_gates` writes / `awaiting_approval` task status transitions** — phase 07.
- **Auth / login gate / session cookies** — phase 11. `/tasks` and `/api/tasks` are open locally for now.
- **Vercel deploy / Sandbox / Fly.io agent process** — phase 12. Phase 06 targets `pnpm dev` on localhost only.
- **Additional subagents** beyond `fleet-analyst` — phase 08.
- **Org chart / kanban / per-agent metrics** — phase 10. Phase 06 ships a minimal `/tasks` list + create form and a single `/tasks/[id]` detail page. No drag-drop, no React Flow.
- **Session resume from tab reconnect mid-run**: the SSE endpoint supports the `Last-Event-ID` header so the browser replays missed events, but `query()` itself is not resumable from the UI — cancelling the tab while the agent is mid-turn does not cancel the agent.
- **Task cancellation from UI**: a `DELETE /api/tasks/[id]` endpoint and a cancel button are deferred. Cap-based abort (`maxBudgetUsd`, `maxTurns`) still fires server-side.
- **Streaming partial assistant text** (`stream_event` SDK messages). Phase 05 already filters these in the mapper — one assistant message lands as one `assistant_turn` event when complete. Token-level streaming is cosmetic and can be added later by expanding `mapMessageToEvents`.
- **Langfuse / OTel tracing** — phase 12.
- **Cost / turn charts** — phase 10. Phase 06 surfaces cost + turns in `<RunResult>` as plain text only.

## Cost check

Phase 06 spends **zero new Anthropic tokens beyond what phase 05 already spent** — the web surface is a different kickoff path into the same `runOrchestrator()` primitive. Dev iteration cost is dominated by browser-driven demo runs of the same "fleet health" prompt phase 05 uses.

- **Anthropic API:** one `POST /api/tasks` demo run ≈ **$0.01–$0.04**, hard-capped by `maxBudgetUsd: 0.50`. Expect 10–30 demo POSTs while iterating on the UI → **< $2** in Anthropic spend for the whole phase.
- **Gemini embeddings:** unchanged — `recall` still embeds each query, well under the free tier.
- **Neon:** **one** new read-heavy access pattern — the SSE poll loop runs `SELECT ... FROM task_events WHERE run_id = $1 AND id > $2 ORDER BY id ASC LIMIT 200` every 500 ms for the life of each open stream. For a 60-second run that's **120 SQL round-trips per viewer per task**. Neon's free tier handles this easily during dev; phase 12 may want `LISTEN/NOTIFY` or a queue for prod, but that's optimization — not phase 06 scope.

## Dependencies

**No new runtime packages.** Phase 06 builds entirely on existing deps:

| Need | API | Import |
|---|---|---|
| Orchestrator primitive | `runOrchestrator({ prompt, taskId?, ... })` | `@/lib/agent/runtime` (phase 05) |
| Task row reads/writes | `createQueuedTask`, `getTaskById`, `getEventsSince` | `@/db/queries/task-api` (NEW) |
| Task lifecycle helpers | `createTaskRun`, `finalizeRun`, `finalizeTask`, `updateTaskRunSession`, `appendTaskEvent` | `@/db/queries/task-runtime` (phase 05) |
| Zod body validation | `z.object({ prompt, maxBudgetUsd?, maxTurns? })` | `zod` |
| Drizzle query | `eq`, `gt`, `and`, `asc`, `desc` | `drizzle-orm` |

**No new env vars.** Phase 06 inherits the phase-05 Anthropic auth trio (`CLAUDE_CODE_OAUTH_TOKEN` / gateway / API key).

**Next.js version:** 16.1.7 (already installed). App Router + Turbopack + RSC. No new Next config.

## Directory layout (delta from phase 05)

```
Agent-swarm/
├── app/
│   ├── api/
│   │   └── tasks/                           # NEW (route group)
│   │       ├── route.ts                     # NEW — POST /api/tasks
│   │       └── [id]/
│   │           └── stream/
│   │               └── route.ts             # NEW — GET /api/tasks/[id]/stream (SSE)
│   └── tasks/                               # NEW (page group)
│       ├── page.tsx                         # NEW — list + create form
│       └── [id]/
│           ├── page.tsx                     # NEW — server component (initial fetch)
│           └── timeline-stream.tsx          # NEW — "use client" EventSource consumer
├── components/
│   └── timeline/                            # NEW (presentational)
│       ├── types.ts                         # NEW — TimelineEvent type
│       ├── AssistantTurn.tsx                # NEW
│       ├── ToolCall.tsx                     # NEW
│       ├── ToolResult.tsx                   # NEW
│       ├── CompactBoundary.tsx              # NEW
│       ├── RunResult.tsx                    # NEW
│       ├── UserMessage.tsx                  # NEW
│       └── TimelineEventRenderer.tsx        # NEW — type → component switch
├── db/
│   └── queries/
│       └── task-api.ts                      # NEW — createQueuedTask, getTaskById, getEventsSince, listRecentTasks
├── lib/
│   ├── agent/
│   │   └── runtime.ts                       # EDIT — accept optional taskId to reuse existing task row
│   └── runner/                              # NEW
│       └── start-task.ts                    # NEW — fire-and-forget wrapper; error capture → finalizeTask(failed)
├── tests/
│   ├── task-api-validation.test.ts          # NEW — zod schema + edge cases
│   ├── task-api-queries.test.ts             # NEW — createQueuedTask + getEventsSince
│   ├── sse-encoder.test.ts                  # NEW — pure encoder
│   └── start-task.test.ts                   # NEW — fire-and-forget error path
├── package.json                             # EDIT — may add `tasks:demo` helper script
├── README.md                                # EDIT — phase 06 Quickstart section
└── docs/superpowers/
    ├── specs/2026-04-24-phase-06-task-api-sse-design.md   # NEW — this file
    └── plans/2026-04-24-phase-06-task-api-sse-plan.md     # NEW
```

## 1. Task lifecycle + status transitions

Phase 02's `task_status` enum already has the right terminal states. Phase 06 tightens the transitions:

```
           (POST /api/tasks)
                 │
                 ▼
             ┌────────┐
             │ queued │                    <-- NEW: this is what POST inserts
             └───┬────┘
                 │ (runner picks up)
                 ▼
         ┌──────────────┐
         │ in_progress  │                  <-- runOrchestrator marks here
         └──────┬───────┘
                ├─────────► done           <-- SDKResultMessage success
                ├─────────► failed         <-- SDKResultMessage error OR thrown
                └─────────► cancelled      (phase 06+ future)
```

Phase 05's `createTask()` inserts with status `'in_progress'` directly (CLI is single-user, no queue semantics). Phase 06 introduces `createQueuedTask()` that inserts with `'queued'` so a timeline viewer can visit `/tasks/[id]` *before* the runner starts and sees "waiting" rather than a broken empty-events page.

**Transition helpers in `db/queries/task-api.ts`:**

| Function | From | To | Called by |
|---|---|---|---|
| `createQueuedTask` | — | `queued` | `POST /api/tasks` route |
| `markTaskInProgress` | `queued` | `in_progress` | `runOrchestrator` (first thing after entry) |
| (existing) `finalizeTask` | `in_progress` | `done`/`failed` | `runOrchestrator` (existing) |

`markTaskInProgress` is a no-op if status is already `in_progress` (idempotent — the CLI path that bypasses `queued` still works).

## 2. `runOrchestrator` refactor — accept existing `taskId`

Phase 05's signature:

```ts
runOrchestrator({ prompt, maxBudgetUsd?, maxTurns?, maxThinkingTokens?, createdBy?, cwd?, onEvent?, onSessionStart? })
```

Phase 06 adds one optional parameter:

```ts
runOrchestrator({ prompt, taskId?, ... })
```

Behavior:

- **`taskId` omitted (CLI path, phase 05 compat):** create task row (`in_progress`), create run, execute, finalize. Unchanged.
- **`taskId` provided (HTTP path, phase 06):** load task, assert status is `queued` or `in_progress`, call `markTaskInProgress`, create run, execute, finalize. Throws if task doesn't exist or is terminal.

The refactor is **non-breaking** — phase 05's `query:demo` script continues to call `runOrchestrator({ prompt })` with no `taskId`.

## 3. `POST /api/tasks` contract

**Route:** `app/api/tasks/route.ts`
**Method:** `POST`
**Request body (JSON):**

```ts
{
  prompt: string;          // min 1, max 4000 chars
  maxBudgetUsd?: number;   // optional override, clamped to [0, 5.0] server-side
  maxTurns?: number;       // optional override, clamped to [1, 100] server-side
}
```

**Response 200:**

```ts
{
  taskId: string;          // UUID
  status: 'queued';        // always 'queued' at return time
  createdAt: string;       // ISO timestamp
}
```

**Error shapes:**

| Code | Body | When |
|---|---|---|
| 400 | `{ error: 'invalid_body', issues: [...] }` | Zod validation failure |
| 500 | `{ error: 'internal', message: string }` | DB insert fails |

**Implementation:**

```ts
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  prompt: z.string().min(1).max(4000),
  maxBudgetUsd: z.number().min(0).max(5.0).optional(),
  maxTurns: z.number().int().min(1).max(100).optional(),
});

export async function POST(req: Request) {
  const json = await safeJson(req);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  }
  const { id, createdAt } = await createQueuedTask({
    prompt: parsed.data.prompt,
    maxBudgetUsd: parsed.data.maxBudgetUsd,
    maxTurns: parsed.data.maxTurns,
    createdBy: 'http',
  });
  // Fire-and-forget runner (see §6.4). Errors captured inside startTask.
  startTask({ taskId: id, prompt: parsed.data.prompt,
              maxBudgetUsd: parsed.data.maxBudgetUsd, maxTurns: parsed.data.maxTurns });
  return Response.json({ taskId: id, status: 'queued', createdAt: createdAt.toISOString() });
}
```

**Why `createdBy: 'http'`** — phase 05 uses `createdBy: 'cli'` for the query-demo script. Distinguishing these is useful for later filtering (phase 10 dashboards).

## 4. `GET /api/tasks/[id]/stream` — SSE contract

**Route:** `app/api/tasks/[id]/stream/route.ts`
**Method:** `GET`
**Query params:** none. The `Last-Event-ID` request header (SSE native) is honored for reconnect.

**Response:** `text/event-stream`; one event per line-block in the format:

```
id: 42
event: task_event
data: {"id":42,"seq":7,"type":"tool_call","payload":{...}}

```

- `id:` is the `task_events.id` (bigserial). Browsers automatically re-send it as `Last-Event-ID` on reconnect.
- `event: task_event` is constant for the data channel; a `done` terminal event is emitted before close.
- `data:` is JSON-stringified `TimelineEvent` (see §5).

**Terminal `done` event:**

```
event: done
data: {"status":"done","total_cost_usd":0.0231,"num_turns":5}

```

Emitted once when the task transitions to `done` / `failed` / `cancelled`. After the terminal event, the server calls `controller.close()`.

**Polling loop shape (ReadableStream):**

```ts
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: taskId } = await params;
  const lastIdHeader = req.headers.get('Last-Event-ID');
  let lastId = lastIdHeader ? BigInt(lastIdHeader) : 0n;

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        while (!req.signal.aborted) {
          const events = await getEventsSince({ taskId, afterId: lastId, limit: 200 });
          for (const e of events) {
            controller.enqueue(enc.encode(formatSseEvent(e)));
            lastId = BigInt(e.id);
          }

          const task = await getTaskById(taskId);
          const isTerminal = task && ['done', 'failed', 'cancelled'].includes(task.status);
          if (isTerminal && events.length === 0) {
            controller.enqueue(enc.encode(formatTerminal(task)));
            controller.close();
            return;
          }

          await sleep(POLL_INTERVAL_MS);  // 500ms
        }
      } catch (err) {
        try { controller.error(err); } catch { /* already closed */ }
      }
    },
    cancel() { /* request aborted - loop exits on next iteration */ },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',       // Nginx / Vercel edge — don't buffer
    },
  });
}
```

**Edge cases handled:**

| Edge case | Behavior |
|---|---|
| Task not found | First poll returns no events, task read returns `null` → we treat as not-terminal, keep polling. Client can decide to time out. *(Alternative: return 404 immediately before stream starts. Chosen because race-on-create is real — the browser can navigate to `/tasks/[id]` before the POST commits.)* |
| Task terminal before any connect | First poll reads all events + terminal status → emits all + `done` → closes. |
| Client disconnect | `req.signal` aborts → loop exits next iteration → `cancel()` runs → no further DB reads. |
| Reconnect mid-run with `Last-Event-ID: 30` | Poll `id > 30n` → backfills missed events then catches up. |
| `id` greater than any event | No-op emit; keeps polling until terminal. |
| Exception in poll | `controller.error` signals the stream; browser's `EventSource.onerror` fires; it will auto-reconnect with `Last-Event-ID`. |

**Why poll not LISTEN/NOTIFY** — Neon's HTTP driver doesn't support LISTEN. A separate long-lived `postgres` TCP connection just for NOTIFY is extra plumbing for phase 06. 500 ms polling is fine for 1–2 concurrent viewers on localhost. Phase 12 can revisit.

## 5. `TimelineEvent` shape (shared client/server)

Defined in `components/timeline/types.ts`:

```ts
export type TimelineEvent = {
  id: number;              // task_events.id (bigserial → narrowed to Number; safe up to 2^53)
  seq: number;              // task_events.seq (contiguous per run_id)
  type: 'assistant_turn' | 'tool_call' | 'tool_result' | 'compact_boundary' | 'run_result' | 'user_message';
  payload: Record<string, unknown>;
  createdAt: string;        // ISO timestamp
};
```

The bigint-to-number narrowing is safe because a single run emitting 2^53 events is impossible (budget cap + turn cap enforce orders of magnitude less).

## 6. Timeline UI

### 6.1 `/tasks` — list + create form

`app/tasks/page.tsx` is a **server component** that:

1. Renders a form that POSTs to `/api/tasks` via client-side fetch and redirects on success.
2. Below the form, lists the 10 most recent tasks (status + prompt preview + created_at) with links to `/tasks/[id]`.

The form is a tiny client component (`app/tasks/create-form.tsx`) because it needs `onSubmit` + `router.push`. The list is server-rendered for first-paint parity.

### 6.2 `/tasks/[id]` — detail page

`app/tasks/[id]/page.tsx` is a **server component** that:

1. Reads the task row + all existing events for the first attempt's run_id via `getEventsSince({ taskId, afterId: 0n })`. Server-render the initial events into the timeline.
2. Passes the task + initial-events props to `<TimelineStream>` (client component) which then subscribes to the SSE endpoint for *new* events.

This avoids the "flash of empty timeline" that a pure client-fetch page would have.

### 6.3 `<TimelineStream>` — client subscription

`app/tasks/[id]/timeline-stream.tsx`:

```tsx
'use client';

export function TimelineStream({ taskId, initialEvents, initialTerminal }: Props) {
  const [events, setEvents] = useState<TimelineEvent[]>(initialEvents);
  const [terminal, setTerminal] = useState<TerminalStatus | null>(initialTerminal);

  useEffect(() => {
    if (terminal) return;  // already done; don't open ES
    const es = new EventSource(`/api/tasks/${taskId}/stream`);
    es.addEventListener('task_event', (e) => {
      const ev = JSON.parse((e as MessageEvent).data) as TimelineEvent;
      setEvents((prev) => [...prev, ev]);
    });
    es.addEventListener('done', (e) => {
      setTerminal(JSON.parse((e as MessageEvent).data));
      es.close();
    });
    es.onerror = () => { /* browser auto-reconnects with Last-Event-ID */ };
    return () => es.close();
  }, [taskId, terminal]);

  return (
    <div className="flex flex-col gap-3">
      {events.map((e) => <TimelineEventRenderer key={e.id} event={e} />)}
      {terminal && <RunResultBanner terminal={terminal} />}
    </div>
  );
}
```

**Key correctness invariants:**

- **Dedup by `id`**: server initial events have IDs `[1..N]`; SSE emits `[N+1..]` via `Last-Event-ID`. No overlap if we seed `initialEvents` sorted by id and the EventSource's natural id cursor starts at `max(initialEvents.id)`. *(Verify in tests.)*
- **No re-subscribe on terminal**: the `if (terminal) return` guard prevents opening ES for a task that's already `done`.
- **Cleanup on unmount**: `return () => es.close()` closes the stream when the user navigates away.

### 6.4 Fire-and-forget runner (`lib/runner/start-task.ts`)

The POST handler returns `{ taskId }` immediately. The actual `runOrchestrator()` call runs after the response is sent via a fire-and-forget Promise:

```ts
export function startTask(args: { taskId: string; prompt: string; maxBudgetUsd?: number; maxTurns?: number }): void {
  Promise.resolve().then(() => runOrchestrator({ ...args, createdBy: 'http' })).catch(async (err) => {
    console.error('[start-task] runner rejected:', err);
    const message = err instanceof Error ? err.message : String(err);
    try {
      await finalizeTask({ taskId: args.taskId, status: 'failed' });
    } catch (finalizeErr) {
      console.error('[start-task] could not finalize task to failed:', finalizeErr);
    }
  });
}
```

**Why not Next 15's `after()`:** `after()` runs *after response flush* but inside the serverless function's lifecycle → still subject to Vercel timeouts. Since phase 06 targets `next dev` only, fire-and-forget is sufficient and has identical semantics to `after()` in the dev server.

**Known limitation** — documented in the README phase 06 Quickstart:

> Turbopack hot-reload during a running agent task will kill the runner mid-flight. The task row will be left in `in_progress` with no terminal event, and the `<TimelineStream>` will poll forever. This is expected for phase 06. Phase 07 (Inngest) fixes durability.

### 6.5 Visible done signal

```
# Terminal 1:
pnpm dev   # user runs this manually; package-install memory prevents me from starting it

# Terminal 2 — browser at http://localhost:3000/tasks:
1. Type: "Check the fleet."
2. Click "Create task"
3. Browser navigates to /tasks/<uuid>
4. Over the next 15–60 seconds, timeline renders:
   - <UserMessage>    "Check the fleet."
   - <AssistantTurn>  "I'll recall relevant memories and delegate to fleet-analyst..."
   - <ToolCall>       mcp__memory__recall({"query":"fleet service intervals",...})
   - <ToolResult>     [{"content":"Auto-ride operates 50 lease sedans...","segment":"identity"}]
   - <AssistantTurn>  "Delegating to fleet-analyst..."
   - <ToolCall>       Agent({agent_name:"fleet-analyst", prompt:"Summarize morning dispatch..."})
   - <ToolResult>     "Based on the knowledge that service interval is 5000 miles..."
   - <AssistantTurn>  (final text summarizing morning dispatch priorities)
   - <RunResult>      success · $0.0187 · turns=4
```

That's the phase-06 demo. No auth, no dashboards, no org chart — just the one happy path rendered live.

## 7. Acceptance criteria

1. `POST /api/tasks` with `{ prompt: "Check the fleet." }` returns 200 with a valid `taskId`; a `tasks` row exists with status `queued`, then transitions to `in_progress` within 2 seconds.
2. `POST /api/tasks` with an empty prompt or `prompt.length > 4000` returns 400 with a zod issue list.
3. `GET /api/tasks/[id]/stream` for a running task emits at least three events (`user_message`, `assistant_turn`, `tool_call`) and closes with a `done` event when the run finishes.
4. `GET /api/tasks/[id]/stream` reconnect with `Last-Event-ID: 3` emits only events with `id > 3`.
5. `/tasks/[id]` page on a terminal task renders all historical events + `<RunResult>` without opening an `EventSource` (guarded by `initialTerminal`).
6. `/tasks/[id]` page on a live task renders events as they land; tab close stops the poll loop server-side within one poll interval.
7. All six timeline components render without runtime errors for each of the five `type` values they're responsible for, given fixture payloads that match phase-05 `mapMessageToEvents` output.
8. `pnpm typecheck` + `pnpm test` + `pnpm build` all green on phase/06 branch tip.
9. The README "Phase 06 Quickstart" explains the turbopack + fire-and-forget limitation and the terminal layout for the demo.

## 8. Testing

Phase 06 is the first phase with non-trivial React + SSE plumbing. The split is:

- **Pure unit (fast):** zod body validation, SSE encoder, runner error path, `TimelineEventRenderer` type-switching.
- **DB-hitting (fast, local Postgres):** `createQueuedTask`, `getEventsSince`, `markTaskInProgress` idempotency.
- **Integration (`[live]`, skipped by default):** full POST → runner → SSE round trip — spins up a task, subscribes to the stream, asserts the terminal event lands. Gated on `ANTHROPIC_*` env being present, marked `[live]` in test name per phase 05 convention.
- **Manual browser verification:** the visible done signal in §6.5. Counts toward acceptance criteria but not `pnpm test`.

**Not unit-tested** (deferred to phase 10's visual-regression work): exact pixel rendering of each component. For phase 06, components are smoke-tested (renders without throw) not snapshot-tested.

## 9. Risks / open questions

- **Neon HTTP polling load.** 2 req/sec per open SSE stream. If the user opens 10 tabs on 10 different tasks that's 20 req/sec on localhost. Still fine for dev. Mitigation (post-v1): add `LISTEN/NOTIFY` via a separate `postgres` connection, fall back to polling.
- **Event-id type.** `bigserial` maps to `bigint` in drizzle. The SSE payload serializes it as a number (`Number(e.id)`), which is safe up to 2^53 — far beyond any realistic run. If we ever switched to a globally-ordered event stream across runs, we'd want to keep it as a string. Documented for future readers.
- **EventSource auth.** `EventSource` can't set custom headers, so phase 11 will pass an auth token via query param. Phase 06 doesn't care — no auth yet. Design today so `?auth=<token>` can slot in without changing the stream contract.
- **Race on create.** If the user types a URL `/tasks/<new-uuid>` in a tab *before* POST commits, the page will render "task not found" on initial fetch. We handle this by having the server component render a "waiting for task row" placeholder + a client retry after 1 second. If the task row appears, it streams normally. If not, the placeholder stays. Not a realistic flow but cheap to cover.
- **Turbopack hot-reload killing the runner.** Documented, not fixed. Phase 07's Inngest solves it. The demo procedure in README tells the user not to edit files mid-run.
- **Simultaneous POST + CLI.** The CLI path and HTTP path use the same `tasks` and `task_runs` tables. If a user runs `pnpm query:demo` and hits `POST /api/tasks` concurrently, they produce two independent tasks — no interference expected (tasks are UUID-keyed). Listed for completeness.
