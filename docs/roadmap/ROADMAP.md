# Auto-ride — Phase Roadmap

Living document. 12 thin phases, one PR per phase, each phase ships a visible "done" signal.

Source of truth for design decisions is `auto-ride-initial-plan.md`. This roadmap sequences that plan into shippable increments; re-read the plan section linked from each phase before implementing.

Workflow per phase is defined in `gitworkflow.md`: worktree at `.worktree/phase-<NN>-<kebab>/`, branch `phase/<NN>-<kebab>`, PR titled `phase NN: <title>`.

## Sequencing principle

Phases 01→07 build a **vertical slice** (scaffold → schema → memory MCP → first `query()` → task API + SSE → HITL) per the plan's §8 recommendation. Phase 08 fans out to the full 11-agent swarm only after the slice proves every risky integration point end-to-end. Auth is intentionally deferred to phase 11 so earlier phases can be validated in a browser without fighting a login gate.

## Phases

| # | Phase | Scope summary | Plan § |
|---|---|---|---|
| 01 | **scaffold** | Next.js 15 + pnpm + Tailwind v4 + shadcn + Drizzle + Neon client + `CREATE EXTENSION vector` migration + `/health` route. Zero auth. | §1, §9 |
| 02 | **schema** | 5 memory tables + `tasks`/`task_runs`/`task_events` + `approval_gates` + 7 seeded segment configs + HNSW cosine + tsvector GIN + compound btree indexes. | §5, §6 |
| 03 | **memory MCP — read** | In-process MCP via `createSdkMcpServer` with `recall` only. Gemini `gemini-embedding-001` @ 1536 dims (asymmetric `RETRIEVAL_QUERY`/`RETRIEVAL_DOCUMENT`). Hybrid SQL: `cosineDistance(col, q) ASC` + `ts_rank_cd(content_tsv, plainto_tsquery($2))` + continuous-exponential importance decay. | §3, §5, §6 |
| 04 | **memory MCP — write / reinforce / forget** | Remaining 3 tools + short/long/permanent decay formulas + reinforcement boost `I ← min(1.0, I + 0.05·(1 − I))` + tombstone-not-delete with 14-day window. Promotion rules (short→long: ≥0.5 for 7 daily samples; long→permanent: ≥0.8 for 30 samples; `identity` fast-track at 3 days ≥0.8). | §5 |
| 05 | **first `query()`** | Orchestrator (`claude-sonnet-4-6` full ID) + 1 Haiku subagent (`fleet-analyst`, short alias only) + `PreToolUse` audit hook + memory MCP wired + every SDK message persisted to `task_events` + `maxBudgetUsd`/`maxTurns`/`maxThinkingTokens` caps + `settingSources:['project']`. CLI-driven (no UI). | §3 |
| 06 | **task API + SSE timeline** | POST `/api/tasks` → Inngest event → local runner; GET `/api/tasks/[id]/stream` tails `task_events` via `force-dynamic` SSE; `/tasks/[id]` timeline UI with `<AssistantTurn>`/`<ToolCall>`/`<ToolResult>`/`<CompactBoundary>`/`<RunResult>` components. | §3, §7 |
| 07 | **HITL approvals** | `canUseTool` gate + Inngest `step.waitForEvent` (24h timeout) + `approval_gates` row + approval bar UI + server action. Must survive mid-wait server restart. | §4 |
| 08 | **full 11-agent swarm** | Define dispatcher, fleet analyst, maintenance planner, billing, support, reflector + 5 others. Flat fan-out (no nested subagents — SDK limitation). Short-name models only on subagents. Budget caps per agent. | §3 |
| 09 | **nightly cleanup debate** | Consolidator (Sonnet 4.6) → Adversary (different model family to break correlation) → Judge (Opus 4.6 only on contested > 0.7). Tombstoned rows reversible for 14 days. Inngest cron with `memory_cleanup_runs` + `memory_cleanup_proposals` logs. | §5 |
| 10 | **org chart + metrics + kanban** | React Flow org chart (11 nodes, live status), dnd-kit kanban (queued / in-progress / awaiting-approval / done / failed), Recharts per-agent metrics (p50/p95 latency, token spend, success rate), memories admin browser with bucket/segment filters. | §7 |
| 11 | **auth** | Better Auth + sessions + sign-up/login. Gate all routes except `/health` and `/login`. `EventSource` SSE auth via short-lived signed query-param token (no cookies on EventSource). | §7 |
| 12 | **observability + deploy** | Langfuse via `@arizeai/openinference-instrumentation-claude-agent-sdk` + `@langfuse/otel` span processor (wired in sandbox process, not Vercel Functions). Vercel (webapp) + Vercel Sandbox **or** Fly.io (agent runtime — decide here) + CI. | §7, §8 |

## Dependency graph

```
01 scaffold
  └─ 02 schema
       ├─ 03 MCP read
       │   └─ 04 MCP write
       │       └─ 05 first query()
       │           └─ 06 task API + SSE
       │               └─ 07 HITL
       │                   ├─ 08 11-agent swarm
       │                   │   └─ 09 nightly cleanup (needs 04 + 08)
       │                   └─ 10 dashboards (needs 06 + 07)
       │                       └─ 11 auth
       │                           └─ 12 observability + deploy
```

Phases 08, 09, 10 are parallel-safe once 07 lands — multiple worktrees OK per `gitworkflow.md`.

## Non-goals for the roadmap

- No mobile app.
- No multi-tenant org separation beyond what Better Auth ships by default (portfolio scope).
- No production-grade on-call / alerting beyond Langfuse traces.
- qmd is explicitly out (plan §6): pgvector owns retrieval.
- Max-subscription OAuth is out (plan §2): `ANTHROPIC_API_KEY` from day one.

## Per-phase checklist (copy into each phase PR body)

- [ ] Worktree created at `.worktree/phase-<NN>-<kebab>/` with branch `phase/<NN>-<kebab>`
- [ ] Git identity verified (`shahriarbijoy` / `shahriarbijoy@gmail.com`)
- [ ] Design spec exists at `docs/superpowers/specs/YYYY-MM-DD-phase-<NN>-*-design.md`
- [ ] Implementation plan exists at `docs/superpowers/plans/YYYY-MM-DD-phase-<NN>-*-plan.md`
- [ ] All acceptance criteria in spec checked off
- [ ] No regressions in prior phases (run `pnpm test` + `pnpm typecheck` + `pnpm build`)
- [ ] PR title is `phase NN: <title>`
- [ ] PR body links the plan §§ and the design spec
