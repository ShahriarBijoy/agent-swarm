# Auto-ride

An 11-agent Claude Agent SDK swarm with a three-bucket memory system and nightly adversarial cleanup, served from a Next.js 15 webapp.

- Phase roadmap: [`docs/roadmap/ROADMAP.md`](./docs/roadmap/ROADMAP.md)
- Git workflow: [`gitworkflow.md`](./gitworkflow.md)
- Contributor guide: [`CLAUDE.md`](./CLAUDE.md)

## Quickstart (through phase 07)

**Prerequisites**
- Node ≥22, pnpm ≥9
- A Neon project with **pgvector enabled** (Neon dashboard → Project → Extensions → toggle `vector` on)
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey) (free tier is enough)

**Setup**

1. Copy env template and fill in the required keys:
   ```bash
   cp .env.example .env.local
   ```
   `.env.local` needs:
   - `DATABASE_URL` — Neon **pooled** URL (hostname contains `-pooler`)
   - `DATABASE_URL_UNPOOLED` — Neon direct URL
   - `GEMINI_API_KEY` — Google AI Studio key for memory embeddings (phase 03)

2. Install and migrate:
   ```bash
   pnpm install
   pnpm db:migrate
   ```

3. Start the dev server:
   ```bash
   pnpm dev
   ```

4. Verify:
   ```bash
   curl -s http://localhost:3000/health | jq
   # { "ok": true, "checks": { "db": "up", "vector": "installed" }, ... }
   ```

   After phase 02, `pnpm db:migrate` also creates the nine core tables (`memories`, `memory_segment_config`, `memory_links`, `memory_cleanup_runs`, `memory_cleanup_proposals`, `tasks`, `task_runs`, `task_events`, `approval_gates`) and seeds seven `memory_segment_config` rows. Verify with `pnpm db:studio` or:
   ```sql
   SELECT segment, default_importance FROM memory_segment_config ORDER BY default_importance DESC;
   -- 7 rows, identity 0.90 → context 0.40
   ```

5. Phase 03 end-to-end sanity check — seed a handful of memories, embed a real query via Gemini, print ranked recall results, clean up:
   ```bash
   pnpm recall:demo
   ```
   The top row for `"when is the next oil change due for my lease vehicle?"` should be the lease-oil-change fixture.

6. Phase 04 end-to-end lifecycle dry-run — write six memories, recall with auto-reinforce, explicit reinforce, forget, evaluate a promotion proposal, evaluate a tombstone-expiry candidate, clean up:
   ```bash
   pnpm memory:demo
   ```

7. **Phase 05 — first `query()`.** One orchestrator (`claude-sonnet-4-6`) + one Haiku subagent (`fleet-analyst`), wired to the memory MCP, with every SDK message persisted to `task_events`. Requires Anthropic auth (in addition to the phase-03 DB + Gemini keys). Set **exactly one** of:

   | Path | Env vars |
   |---|---|
   | OAuth (Pro/Max subscription) | `CLAUDE_CODE_OAUTH_TOKEN` — run `claude setup-token` in a Claude Code session |
   | Gateway / LiteLLM proxy | `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` |
   | Direct API key | `ANTHROPIC_API_KEY` (from [console.anthropic.com](https://console.anthropic.com)) |

   Decision tree: [`docs/roadmap/ROADMAP.md` → "Auth for the Agent SDK"](./docs/roadmap/ROADMAP.md#auth-for-the-agent-sdk-overrides-plan-2).

   Then run the demo:
   ```bash
   pnpm query:demo "Check the fleet and summarize today's maintenance priorities."
   ```
   (Omit the argument to use the default fleet-health prompt.) The script seeds two memories, invokes `runOrchestrator`, streams every `task_events` row to stdout, verifies contiguous seq, and cleans up the seeds. `tasks` / `task_runs` / `task_events` rows stay behind — inspect via `pnpm db:studio`.

   Phase 03's `pnpm recall:demo` and phase 04's `pnpm memory:demo` do **not** require Anthropic auth; only `pnpm query:demo` does.

8. **Phase 06 — task API + SSE timeline.** Same orchestrator, different kickoff path: create a task through a Next.js form, watch the timeline render live in the browser as events land in `task_events`.

   ```bash
   pnpm dev
   ```

   Then in the browser:

   - Open `http://localhost:3000/tasks`
   - Type a prompt (e.g. `Check the fleet.`), click **Create task**
   - Redirects to `/tasks/<uuid>` — the timeline streams live via SSE
   - `<UserMessage>` → `<AssistantTurn>` → `<ToolCall>` → `<ToolResult>` → … → `<RunResult>` with cost + turns + duration

   Or script it via curl:

   ```bash
   curl -s -X POST http://localhost:3000/api/tasks \
     -H 'content-type: application/json' \
     -d '{"prompt":"Check the fleet."}'
   # {"taskId":"...","status":"queued","createdAt":"..."}

   curl -N http://localhost:3000/api/tasks/<taskId>/stream
   # id: 1\nevent: task_event\ndata: {...}\n\n ... event: done\n\n
   ```

   **Known limitation (phase-06 scope, lifted in phase 07):** the POST handler fired the runner via `Promise.resolve().then(...)` — so in Turbopack dev, a hot-reload **while a task is running** killed the process; the `tasks` row was left `in_progress` with no terminal event. Phase 07 routes the runner through Inngest's durable workflow so this is no longer a problem.

9. **Phase 07 — HITL approvals.** A `canUseTool` gate pauses the orchestrator before risky tool calls (any `mcp__stripe__*`, non-whitelisted `Bash`, `Write` to `^src/`); the `<ApprovalBar>` on `/tasks/[id]` surfaces the gate; clicking **Approve / Modify / Deny** unblocks the SDK via Inngest. The whole orchestrator run lives inside an Inngest function so it survives a server restart mid-wait.

   This phase needs a second terminal for the Inngest dev server. Three terminals total:

   ```bash
   # Terminal 1 — Next.js
   pnpm dev

   # Terminal 2 — Inngest event broker (auto-discovers the functions on /api/inngest)
   pnpm inngest:dev
   ```

   The Inngest UI lands at [http://localhost:8288](http://localhost:8288).

   **Demo a happy-path approval:**

   - Open `http://localhost:3000/tasks` and create a task with a prompt that nudges the orchestrator toward a gated tool, e.g.:
     ```
     Use Bash to delete the file at /tmp/auto-ride-demo. Run "rm -rf /tmp/auto-ride-demo".
     ```
   - On `/tasks/<uuid>`, the timeline streams normally until the orchestrator emits a `tool_call` for `Bash` with a non-whitelisted command. The task transitions to `awaiting_approval`, an amber **awaiting approval** banner appears with the proposed input, and an inline `<ApprovalRequest>` card lands in the timeline.
   - Click **Approve**. The gate row flips to `approved`, a `subtype: 'resolved'` event is emitted, the SDK resumes, and the run completes with the usual `<RunResult>` summary.
   - **Modify** opens a JSON textarea so you can rewrite `proposed_input` (e.g. narrow the path). The SDK receives `{ behavior: 'allow', updatedInput: <your JSON> }` and runs the modified call.
   - **Deny** sends `{ behavior: 'deny', message: <reason> }` to the SDK, which the orchestrator typically reacts to by giving up or proposing an alternative.

   **Demo restart survival:**

   1. Trigger an approval as above. Stop on the amber bar (do *not* click any button yet).
   2. `Ctrl+C` Terminal 1 (`pnpm dev`). Wait two seconds. Restart `pnpm dev`.
   3. Refresh `/tasks/<uuid>` — the approval bar still shows the same gate (read from `approval_gates` rather than in-memory state).
   4. Click **Approve**. Inngest delivers `auto-ride/approval.decided`; the function picks up at the durable `step.waitForEvent` boundary; the run completes.

   **Caveats**
   - Every `step.waitForEvent` is a function-exit boundary, so Inngest re-invokes the function from the top after Approve / Modify / Deny. `runOrchestrator` is not wrapped in `step.run`, which means the SDK conversation is rebuilt from the original prompt on every replay. Gate ids are derived deterministically from `sha1(taskId-gate-${count})` so each replay opens *the same* `approval_gates` row and Inngest memoizes the wait — the run completes after a single click. Side effect: each replay still emits a duplicate `approval_request:opened` row in the timeline; functional behavior is unaffected. Phase 12's sandbox process eliminates the replay rebuild entirely.
   - Turbopack hot-reload during a live wait works the same way — the killed process is just another reason for the function to exit.
   - The Server Action has no auth in phase 07; treat the dev server as local-only. Phase 11's Better Auth gates it.

10. **Phase 08 — full 11-agent swarm.** The orchestrator promotes to `claude-opus-4-7` (full ID — full IDs are accepted on the orchestrator only) and routes prompts to one of ten workers via the `Agent` tool. Workers use short-alias models (`'haiku' | 'sonnet'`); full IDs on subagents silently fall back to `inherit` and burn the orchestrator's tier. The default per-run cap rises to **$1.5 / 25 turns** to absorb a worst-case Opus dispatcher + multi-worker fan-out + one approved gate.

    The ten workers (all defined under `lib/agent/agents/`):

    | # | Name                  | Model  | Tools                                                              |
    |---|-----------------------|--------|--------------------------------------------------------------------|
    | 1 | `fleet-analyst`       | haiku  | Read + memory                                                       |
    | 2 | `maintenance-planner` | sonnet | Read + Grep + Write + memory                                        |
    | 3 | `billing`             | sonnet | Read + **gated Write to `invoices/`** + memory                       |
    | 4 | `support`             | sonnet | Read + **gated Write to `replies/`** + memory                        |
    | 5 | `reflector`           | sonnet | Read + memory + **`mcp__memory__forget` (only worker)**              |
    | 6 | `route-optimizer`     | haiku  | Read + Grep + memory                                                |
    | 7 | `incident-responder`  | sonnet | Read + Bash (whitelisted) + **gated Write to `dispatch-log/`** + memory |
    | 8 | `driver-coach`        | haiku  | Read + Grep + memory                                                |
    | 9 | `compliance-auditor`  | haiku  | Read + Grep + memory                                                |
    | 10| `analytics-reporter`  | haiku  | Read + Grep + memory                                                |

    Three new gated path patterns join the phase-07 `src/` gate: `dispatch-log/`, `invoices/`, `replies/`. Source-tree gate still wins on overlap (e.g., `src/invoices/foo.json` is reported as a source write).

    Every persisted `task_events` row now carries `payload.agent_name` derived deterministically from the SDK's `parent_tool_use_id` chain (`'dispatcher'` for the orchestrator's own messages, the worker's name for any event whose parent chain leads back to an `Agent` tool_call). Phase 10 will use this to colour the timeline by agent and chart per-agent metrics.

    **Demo a billing dispatch (gated Write to `invoices/`):**

    - Open `http://localhost:3000/tasks` and create a task with prompt:
      ```
      Generate an invoice for trip T-998.
      ```
    - The timeline should show:
      - `tool_call` for `Agent` with `payload.agent_name: 'dispatcher'` and `payload.soft_budget_usd: 0.20`.
      - `assistant_turn` events with `payload.agent_name: 'billing'` once the worker is spawned.
      - A `tool_call` for `Write` targeting `invoices/T-998.json` — this opens an `approval_gates` row with `status='pending'`.
    - Click **Approve** in the bar. The gate flips to `approved`, the SDK resumes, the file is "written", and the run terminates `done`.

    **Demo an incident-responder dispatch (gated Write to `dispatch-log/`):**

    - Create a task with prompt:
      ```
      Vehicle V-09 just went offline; triage and log it to dispatch-log/.
      ```
    - The timeline should show:
      - `tool_call` for `Agent` with `payload.agent_name: 'dispatcher'` and `payload.soft_budget_usd: 0.25`.
      - At least one `assistant_turn` with `payload.agent_name: 'incident-responder'`.
      - One `Write` to `dispatch-log/v-09.md` opening an `approval_gates` row.
    - Click **Approve**. The run completes.

    **Caveats**
    - Auth is Max OAuth for this build (per `auto-ride-initial-plan.md` §2 carve-out): the dollar figures `task_runs.total_cost_usd` reports are **notional** — what the run would have cost on the API. No real $ is charged; usage meters against the Max plan's 5-hour token quota. The `maxBudgetUsd: 1.5` cap is still enforced — the SDK aborts on the notional figure even on Max, which is the safety property we rely on.
    - Memory writes (`mcp__memory__write`, `mcp__memory__reinforce`, `mcp__memory__forget`) are deliberately **un-gated** — they are the project's whole point and gating them would turn every demo into a click-fest. Memory destructiveness is bounded by phase-04's tombstone-not-delete + phase-09's adversarial cleanup.
    - The dispatcher does NOT have `Bash` or `Write` in its allowedTools — if a workflow needs those, the dispatcher must dispatch to `incident-responder` (Bash + Write) or one of the other Write-capable workers. This makes the dispatcher physically incapable of "doing it itself" for many workflows.
    - Per-agent dollar enforcement is observability-only in phase 08. Each `Agent` tool_call event carries `payload.soft_budget_usd` for the spawned worker; phase 10's per-agent dashboard surfaces actual-vs-budget; phase 12's cost aggregator turns the soft cap into a hard one.

11. **Phase 09 — nightly cleanup debate.** A three-agent debate (Consolidator Sonnet 4.6 → Adversary Haiku 4.5 → Judge Opus 4.6 only on contested confidence > 0.7) governs **prune** and **merge** actions over the memory store. Promotions remain on phase 04's deterministic streak path. The whole pipeline runs inside one Inngest function with two triggers: a daily `0 3 * * *` UTC cron (dormant pre-deploy) and `auto-ride/cleanup.requested` for manual/CLI demos.

    Three terminals — same shape as phase 07/08:

    ```bash
    # Terminal 1 — Next.js (port 3100; never use 3000)
    pnpm dev -p 3100

    # Terminal 2 — Inngest broker
    pnpm inngest:dev

    # Terminal 3 — trigger one cleanup run
    pnpm cleanup:run-once
    ```

    Watch the Inngest dev UI at [http://localhost:8288](http://localhost:8288) for the live function trace (8 step boundaries: stale-finalizer, open-run, select-candidates, debate, persist-proposals, apply-verdicts, expire-tombstones, close-run). Inspect results in Postgres:

    ```sql
    SELECT id, status, candidates_considered, proposals_generated,
           proposals_contested, proposals_judged, cost_usd, error
    FROM memory_cleanup_runs ORDER BY started_at DESC LIMIT 5;

    SELECT memory_id, action, final_action, applied_at,
           consolidator->>'reasoning' AS consolidator_reason,
           adversary->>'adversaryConfidence' AS adv_conf,
           judge IS NOT NULL AS judge_fired
    FROM memory_cleanup_proposals ORDER BY created_at DESC LIMIT 20;
    ```

    **Kill switch.** `MEMORY_CLEANUP_CRON_ENABLED=false` in `.env.local` → restart Next.js → the cron handler returns `{ skipped: true, reason: 'env-flag' }` immediately. Manual `pnpm cleanup:run-once` ignores the flag (useful for ad-hoc demos with the cron disabled).

    **Caveats**
    - Asymmetric loss: errors of omission are cheaper than errors of commission. Adversary parse-failure ⇒ no objection ⇒ Consolidator wins. Judge parse-failure ⇒ `keep` (no-op).
    - Cost cap: `MAX_RUN_USD = 10.0` is checked between every model call; on breach, run row is marked `failed` with the cap message and `CostCapExceededError` is rethrown for Inngest visibility.
    - Idempotency: cron skips silently if a `completed` run exists for today; manual events always proceed.
    - Cost figures are notional under Max OAuth (same caveat as phase 08).

12. **Phase 10 — operator dashboard.** A read-only window onto everything phases 02–09 produce: a light-mode bento home, a full agent canvas, a kanban over `tasks × open-gate`, per-agent metric pages, and a filterable memory browser. The dashboard speaks to Postgres only — no dashboard file imports the Agent SDK (an invariant test enforces it).

    ```bash
    # Single terminal — no Inngest required to look around
    pnpm dev -p 3100
    ```

    Then in the browser:

    | Route | What you see |
    |---|---|
    | `/` | Bento home — 9 widgets: greeting, all-agents stats, mini-canvas of the active run, HITL queue, today's memory writes, last-night cleanup, 12-month cost line, memory-segments ring, active workers |
    | `/tasks` | 5-column kanban: `queued / in_progress / awaiting_approval / done / failed` (the awaiting column is derived from `status='in_progress' ∧ open gate`) |
    | `/tasks/<uuid>?view=canvas\|stream` | Same task, two views — Canvas is React Flow over the org chart; Stream is the phase-06/07 SSE timeline |
    | `/agents/<name>` | Per-agent page — p50/p95 latency, daily-token bar chart (shadcn/ui chart over Recharts), success rate, recent runs, top-recalled memories. `<name>` must match a worker registered in `lib/agent/agents/` (the dispatcher is not a worker). |
    | `/memories` | Filterable table — bucket × segment pills + a "touched by last cleanup" toggle; filters live in the URL so the browser back button works |

    **Architecture notes**
    - Each home widget is a `WidgetDef` with `{ id, name, gridArea, refreshMs, load, Component }`. Server-rendered once on first paint, then the client polls `/api/dashboard?widget=<id>` on the widget's `refreshMs` cadence (`useDashboardPoll` pauses on `document.hidden` and dedups in-flight requests).
    - The active-run mini-canvas and the 12-month cost line are split across two files each: a `<name>.tsx` server module that owns the `WidgetDef` and a `<name>-view.tsx` client module that owns the JSX. This keeps the registry's `load` function a real server function across the React Server Component boundary instead of a serialized client reference.
    - `tests/dashboard/invariants.test.ts` enforces three guardrails: the dashboard tree never imports `@anthropic-ai/claude-agent-sdk`, every `WidgetId` has a registered `{ load, Component, gridArea }`, and home widgets never import `recharts` directly (they must dynamic-import it so the home bundle stays under budget).

    **End-to-end check**

    ```bash
    pnpm test:e2e
    ```

    Playwright spawns the dev server via the `webServer` config and visits the four routes plus a 404 sanity check.

## Scripts

| Script | Purpose |
|---|---|
| `pnpm dev` | Next.js dev server with Turbopack |
| `pnpm inngest:dev` | Inngest CLI dev server on port 8288 — durable workflow broker for phase 07 HITL (run alongside `pnpm dev`) |
| `pnpm build` / `pnpm start` | Production build / server |
| `pnpm test` / `pnpm test:watch` | vitest |
| `pnpm test:e2e` | Playwright E2E across the phase-10 dashboard routes (spawns its own dev server on 3100) |
| `pnpm typecheck` | `tsc --noEmit` under strict |
| `pnpm lint` / `pnpm format` | ESLint / Prettier |
| `pnpm db:generate` | Generate a Drizzle migration |
| `pnpm db:migrate` | Apply pending migrations (via `DATABASE_URL_UNPOOLED`) |
| `pnpm db:studio` | Open drizzle-kit studio |
| `pnpm recall:demo` | Seed memories, embed a query via Gemini, print ranked recall (phase 03) |
| `pnpm memory:demo` | End-to-end memory lifecycle dry-run: write six memories, recall with auto-reinforce, explicit reinforce, forget, evaluate promotion proposal, evaluate tombstone-expiry candidate, clean up (phase 04) |
| `pnpm query:demo` | First real `query()`: orchestrator + fleet-analyst subagent + memory MCP + task_events persistence, CLI-driven. Accepts a prompt as argv. Requires Anthropic auth (see quickstart step 7). (phase 05) |
| `pnpm cleanup:run-once` | Sends `auto-ride/cleanup.requested`; Inngest dev server invokes `memoryCleanupFn` once. Watch the run in the Inngest UI at [http://localhost:8288](http://localhost:8288). (phase 09) |

## Phase status

See [`docs/roadmap/ROADMAP.md`](./docs/roadmap/ROADMAP.md) for the 12-phase plan and the current open PR.
