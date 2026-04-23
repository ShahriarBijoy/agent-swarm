# Phase 05 — first `query()` (plan)

**Date:** 2026-04-23
**Status:** ready to execute
**Design reference:** `docs/superpowers/specs/2026-04-23-phase-05-first-query-design.md`
**Plan reference:** `auto-ride-initial-plan.md` §3

This is the ordered, atomic task list that implements the phase 05 design. Each step ends in a verifiable state (tests pass, a file exists, a script runs). Commits follow the `feat(phase-05):` / `test(phase-05):` / `docs(phase-05):` / `refactor(phase-05):` pattern, one per step unless otherwise noted.

## Execution order

Front-load the pure, testable code (persist mapper → hook → definitions); middle chunk adds DB plumbing; end wires it all up and ships the demo.

| # | Step | Commits | Verifies |
|---|---|---|---|
| 1 | Design + plan docs | 1 | Files present under `docs/superpowers/` |
| 2 | `.env.example` + env-loader helper | 1 | `pnpm typecheck` clean |
| 3 | SDK-message mapper + unit tests | 2 (src, test) | `pnpm test tests/agent-persist.test.ts` green |
| 4 | Audit hook + unit tests | 2 | `pnpm test tests/agent-hooks.test.ts` green |
| 5 | Fleet-analyst definition + structural tests | 2 | `pnpm test tests/agent-definitions.test.ts` green |
| 6 | Env loader tests | 1 | `pnpm test tests/env.test.ts` green |
| 7 | Task-runtime DB helpers | 1 | `pnpm typecheck` clean |
| 8 | Orchestrator runtime wrapper | 1 | `pnpm typecheck` clean |
| 9 | CLI demo script + `package.json` script | 1 | Script file exists; `pnpm query:demo --help`-style dry-run works |
| 10 | `[live]` integration test | 1 | Un-skipped locally once, passes |
| 11 | README + `.env.example` polish | 1 | Content present |
| 12 | Open PR | n/a | `gh pr create --title "phase 05: first query()"` |

## Step-by-step

### Step 1 — docs

Already committed at step start: `docs/superpowers/specs/2026-04-23-phase-05-first-query-design.md` + this plan file.

**Commit:** `docs(phase-05): first query() design spec and implementation plan`

**Files:**
- `docs/superpowers/specs/2026-04-23-phase-05-first-query-design.md` (already written)
- `docs/superpowers/plans/2026-04-23-phase-05-first-query-plan.md` (this file)

**Verify:** `ls docs/superpowers/specs/ docs/superpowers/plans/`.

---

### Step 2 — env loader helper + `.env.example`

**File edits:**

- `lib/env.ts`: add `type AgentAuthEnv` discriminated union + `loadAgentAuthEnv(): AgentAuthEnv` per design §6. Do NOT add agent auth vars to the module-load `envSchema` (keeps existing tests valid without Anthropic creds).
- `.env.example`: move the phase-05 auth block out of the "later phases" footer into the active section with comments on the three paths.

**Commit:** `feat(phase-05): loadAgentAuthEnv helper + .env.example auth paths`

**Verify:**
- `pnpm typecheck` passes.
- `.env.example` contains `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY` all in the active (non-commented-footer) area.

---

### Step 3 — SDK-message mapper (`lib/agent/persist.ts`) + tests

**File creates:**

- `lib/agent/persist.ts` — exports `type TaskEventInput` and `mapMessageToEvents(msg: SDKMessage): TaskEventInput[]` per design §3. Use narrowing on `msg.type` / `msg.subtype`. For `assistant`, iterate `msg.message.content` to pull `tool_use` blocks. For `user` with array content, split on block `type === 'tool_result'`.
- `tests/agent-persist.test.ts` — 10 cases from design §Testing. Use `describe` + `it`. Construct fixture messages inline (don't mock SDK). Assert on `events.length`, `events[0].type`, and `events[0].payload` keys.

**Type narrowing detail:**

```ts
if (msg.type === 'system' && msg.subtype === 'init') return [];
if (msg.type === 'stream_event') return [];
if (msg.type === 'system' && msg.subtype === 'compact_boundary') { ... }
// etc.
```

Keep a trailing `return [];` for unrecognized message types — future SDK additions won't throw.

**Commits:**
- `feat(phase-05): SDK-message → task_events mapper`
- `test(phase-05): mapMessageToEvents unit coverage`

**Verify:** `pnpm test tests/agent-persist.test.ts` — 10/10.

---

### Step 4 — audit hook + tests

**File creates:**

- `lib/agent/hooks.ts` — exports `auditPreToolUse: HookCallback` per design §2. Also exports `safeShort(value: unknown, limit = 200): string` helper for testability.
- `tests/agent-hooks.test.ts` — 5 cases from design §Testing. Spy on `console.error` via `vi.spyOn`; restore in `afterEach`.

**Commits:**
- `feat(phase-05): PreToolUse audit hook`
- `test(phase-05): audit hook coverage`

**Verify:** `pnpm test tests/agent-hooks.test.ts` — 5/5.

---

### Step 5 — fleet-analyst definition + structural tests

**File creates:**

- `lib/agent/fleet-analyst.ts` — exports `FLEET_ANALYST_NAME` + `fleetAnalyst: AgentDefinition`. Prompt text ~150 words; saved inline as a template literal.
- `tests/agent-definitions.test.ts` — 6 cases from design §Testing. The `buildOrchestratorOptions()` helper referenced in case 6 is pulled out of `runtime.ts` for testability; export it from `lib/agent/runtime.ts` alongside `runOrchestrator` (step 8). Since runtime.ts doesn't exist yet, the definitions test file imports the helper lazily inside an `it` that step 8 will unblock — OR, alternatively, implement the helper as part of step 5 in a new `lib/agent/options.ts` that both `runtime.ts` and the test can import.

**Decision:** extract `buildOrchestratorOptions()` into `lib/agent/options.ts` in step 5. Keeps step 5's test suite self-contained. Step 8's `runtime.ts` imports from `options.ts`.

**Files after step 5:**
- `lib/agent/fleet-analyst.ts`
- `lib/agent/options.ts` — exports `buildOrchestratorOptions(overrides?): Options`
- `tests/agent-definitions.test.ts`

**Commits:**
- `feat(phase-05): fleet-analyst subagent + orchestrator options builder`
- `test(phase-05): agent definition invariants`

**Verify:** `pnpm test tests/agent-definitions.test.ts` — 6/6. Also `pnpm typecheck`.

---

### Step 6 — env-loader tests

**File creates:**

- `tests/env.test.ts` — 6 cases from design §Testing. Use `vi.stubEnv(name, value)` / `vi.unstubAllEnvs()`. Each case sets a minimal fixture env, calls `loadAgentAuthEnv()`, asserts the result `kind` and payload keys. Case 6 asserts the throw message mentions all three env var names.

**Commit:** `test(phase-05): loadAgentAuthEnv precedence coverage`

**Verify:** `pnpm test tests/env.test.ts` — 6/6.

---

### Step 7 — task-runtime DB helpers

**File create:**

- `db/queries/task-runtime.ts` — five exported async functions per design §4. Each is one Drizzle statement. `appendTaskEvent` writes with the raw `payload` jsonb; callers pass pre-serialized objects. `updateTaskRunSession` uses `update(taskRuns).set({ sessionId }).where(eq(taskRuns.id, runId))`. `finalizeRun` sets `status`, `endedAt: new Date()`, `totalCostUsd`, `totalInputTokens`, `totalOutputTokens`, and `error` in one update. `finalizeTask` sets `status`, `completedAt`, bumps `updatedAt`.

**Commit:** `feat(phase-05): task-runtime DB helpers`

**Verify:** `pnpm typecheck` passes. No new tests at this step — step 10 exercises these functions end-to-end.

---

### Step 8 — orchestrator runtime wrapper

**File create:**

- `lib/agent/runtime.ts` — exports `runOrchestrator(args: RunOrchestratorArgs): Promise<RunOrchestratorResult>` per design §5. At the first line, call `loadAgentAuthEnv()` (throws if unset). Build options via `buildOrchestratorOptions({ maxBudgetUsd, maxTurns, maxThinkingTokens })`. Wrap the for-await loop in a try/catch; on throw, best-effort `finalizeRun` with `status='failed'` and re-throw. Guard the `onEvent` callback with an inner try/catch so a stdout EPIPE doesn't abort the run.

**Detail:** the SDKResultMessage handling is inside the loop, not after. Capture `totalCostUsd`, `totalInputTokens`, `totalOutputTokens`, `numTurns`, `result`, `errors` into closure-scoped vars the moment we see a `result` message. After the loop ends (iterator returns), write `finalizeRun` / `finalizeTask` with the captured values.

**Edge cases:**
- Result message missing (loop ends without one): treat as a failure. `status='failed'`, error=`'query ended without SDKResultMessage'`.
- Init message missing (no session_id): OK — leave `task_runs.session_id` null; log a warning to stderr.
- `SDKResultError` subtype (error_max_*): still emit the `run_result` event row. `status='failed'`, error=`msg.errors.join('; ')`.

**Commit:** `feat(phase-05): runOrchestrator wrapper wiring query() + persistence`

**Verify:** `pnpm typecheck` passes.

---

### Step 9 — CLI demo script + `pnpm query:demo`

**File creates + edits:**

- `scripts/query-demo.ts` — per design §7. `tsx --env-file=.env.local` loads env before module imports (matches phase 03/04 pattern). Use `process.argv.slice(2).join(' ')` as prompt, or a default fleet-health prompt if empty.
- `package.json` — add `"query:demo": "tsx --env-file=.env.local scripts/query-demo.ts"`.

**Default prompt (when no argv):**

> "Check the fleet. Use the memory MCP to recall what you know about service intervals and vehicle counts. Then use the fleet-analyst subagent to summarize what a morning-of maintenance dispatch should prioritize. Be concise — one paragraph."

Exercises Agent tool (delegation) + memory MCP (recall) + orchestrator summarization.

**Commit:** `feat(phase-05): query-demo CLI script (visible done signal)`

**Verify:** file exists. Locally: `pnpm query:demo` runs end-to-end given a valid auth path (this is step 12's job, not this step's).

---

### Step 10 — `[live]` integration test

**File create:**

- `tests/agent-runtime.test.ts` — one `describe.skip('[live] Haiku round-trip', …)` block with 5 assertions per design §Testing. Constructs a minimal prompt (`'Say "ok" and nothing else.'`), runs with `maxBudgetUsd: 0.10, maxTurns: 3`, asserts persistence shape. Cleanup deletes the task/run/events.

**Commit:** `test(phase-05): [live] runtime integration (skipped by default)`

**Verify (manual):** un-skip locally, run `pnpm test tests/agent-runtime.test.ts`, confirm 1 passing. Then re-skip (keep the `.skip` — CI shouldn't hit live API). The un-skipped run is the phase 05 acceptance criterion #6.

---

### Step 11 — README + `.env.example` polish

**Edits:**

- `README.md` — add a "Phase 05 — first query" subsection between the existing Phase 03 sanity-check step and the Scripts table. Content per design §8. Add `pnpm query:demo` row to the Scripts table.
- `.env.example` — verify the auth block is clear; add a final-line comment pointing at the roadmap's §"Auth for the Agent SDK" for the full decision tree.

**Commit:** `docs(phase-05): README quickstart + .env.example polish for phase 05`

**Verify:** grep `README.md` for `query:demo`. Read-through for obvious typos.

---

### Step 12 — open PR

Before opening:

1. Re-run the full test suite: `pnpm test` — everything green, `[live]` skipped.
2. `pnpm typecheck`, `pnpm lint`, `pnpm build` all clean.
3. Un-skip `tests/agent-runtime.test.ts` locally, run it, see 1 passing. Re-skip. Do NOT commit the un-skip.
4. Run `pnpm query:demo` end-to-end. See `status: 'done'`, cost > 0, events streamed.
5. `git log --oneline phase/05-first-query` — confirm commits are tidy and scoped.

Open the PR:

```bash
gh pr create \
  --base main \
  --head phase/05-first-query \
  --title "phase 05: first query() — orchestrator + fleet-analyst + memory MCP + task_events" \
  --body "Implements phase 05 of the Auto-ride roadmap. See docs/roadmap/ROADMAP.md and auto-ride-initial-plan.md §3.

## Summary
- Orchestrator (\`claude-sonnet-4-6\` full ID) + 1 Haiku subagent (\`fleet-analyst\`, short alias).
- \`PreToolUse\` audit hook logging every tool call.
- Memory MCP wired into orchestrator + subagent (recall/write/reinforce on subagent; + forget on orchestrator).
- Every mappable SDK message persisted to \`task_events\` with contiguous seq.
- \`maxBudgetUsd\` / \`maxTurns\` / \`maxThinkingTokens\` caps; \`settingSources: ['project']\`.
- Three auth paths supported (OAuth / gateway / API key); precedence documented.
- CLI demo: \`pnpm query:demo\` is the visible done signal.

## Test plan
- [x] \`pnpm test\` (all suites, \`[live]\` skipped)
- [x] \`pnpm typecheck\` / \`pnpm lint\` / \`pnpm build\`
- [x] \`[live] Haiku round-trip\` test un-skipped locally, passing
- [x] \`pnpm query:demo\` end-to-end, status=done, cost > 0"
```

## Deviations — allowed

If during execution something diverges from the design, favor:

1. Halting + asking over silently adapting — one short Q is cheaper than a week of drift.
2. Shrinking scope over expanding it — phase 06/07/08 can pick up anything that spills.
3. Adding tests over adding production code — the one thing no one regrets.

## Deviations — NOT allowed

- Changing the 6 allowed `task_events.type` values (phase 02 check constraint) without a new migration.
- Adding a full Anthropic model ID to `AgentDefinition.model` (plan §3 footgun #2).
- Adding any new dependency to `package.json` without a design-doc edit first.
- Committing an un-skipped `[live]` test (CI has no Anthropic auth — it will hang or fail).
- Committing a `.env.local` or any file containing an actual OAuth token / API key.
