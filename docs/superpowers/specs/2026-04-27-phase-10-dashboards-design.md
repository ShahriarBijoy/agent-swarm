# Phase 10 — Bento home, agent canvas, kanban, metrics, memories (design)

**Date:** 2026-04-27
**Status:** drafted from brainstorming session — pending user approval
**Plan references:** `auto-ride-initial-plan.md` §7 ("the webapp shape")
**Roadmap entry:** `docs/roadmap/ROADMAP.md` — phase 10 ("org chart + metrics + kanban")
**Visual sources of truth:** `.superpowers/brainstorm/347-1777309300/content/{vibe,metaphor,agent-canvas,bento-home}.html`
**Skill applied:** `nothing-design` (industrial typographic discipline) + Salesforce-style bento (light variant) — see §2

## Purpose

Phase 10 is the project's **public face**. Phases 01–09 built the swarm engine; phase 10 is the operator surface that shows it doing its job. A recruiter opening Auto-ride should land on a single view that, in under five seconds, communicates:

1. *the swarm is alive* (live indicator, current run, Doto display number)
2. *what it's doing right now* (active task subject, dispatcher's chosen workers, what each one is using)
3. *how it has behaved over the month* (cost line, agent comparison bars, cleanup outcome)
4. *what needs the human* (HITL queue card with inline approve action)

Five things ship together because they share the same theme tokens, the same widget contract, and read from the same `task_events` / `tasks` / `approval_gates` / `memories` tables. Splitting them creates duplication of the visual system:

1. **Light-mode theme system** — design tokens (palette, typography, spacing, radii, motion), Google Fonts wired in `layout.tsx`, a single `theme.ts` exporting CSS-variable constants. Replaces ad-hoc colours used in phase 06's timeline page.
2. **Bento home `/`** — greeting card with italic-serif "*here's*", monthly task-volume bars with the current month in lime, all-agents stat block with mini-bars per agent, embedded mini agent canvas for the most-recent active run, lime "memory writes today" headline card, black "active workers" contrast card, three small support cards (HITL queue, cleanup result, memory segments), and a 12-month cost line chart.
3. **Full agent canvas at `/tasks/[id]`** — replaces phase 06's vertical timeline view. React Flow canvas with the dispatcher → workers tree of *the workers actually picked* for the run. Each node carries its model, status, tool chips, and (for the active worker) a sparkline; HITL gates render inline inside the worker node. A bottom scrubber rebuilds any past moment of the run by replaying `task_events` up to the cursor. The previous timeline view stays accessible via a tab toggle (`Canvas` / `Stream`) so phase 06's tests don't have to be rewritten.
4. **Kanban at `/tasks`** — dnd-kit board with five columns (`queued` / `in-progress` / `awaiting-approval` / `done` / `failed`). Column membership is **derived** from `tasks.status` plus an open `approval_gates` row; drag-to-reassign is intentionally *not* wired (status is owned by the runner, not the operator). Drag is for sorting within a column only; the board's job is overview, not control.
5. **Per-agent metrics at `/agents/[name]`** — Recharts strip across the top (p50/p95 latency, daily token spend, success rate) plus a recent-runs table joining `task_events.payload.agent_name`. Read-only.
6. **Memories admin at `/memories`** — filterable table (bucket × segment × "touched by last cleanup"), reads from the five memory tables and `memory_cleanup_proposals`. Read-only.

Phase 11 (auth) wraps every route except `/health` in a Better Auth gate. Phase 12 (observability + deploy) wires Langfuse traces into the canvas; the canvas already renders one node per `tool_use_id`, which lines up with Langfuse's span-per-tool-call shape.

## Non-goals

- **No drag-to-reassign in the kanban.** Status is computed from `tasks.status` + `approval_gates`; an operator dragging a card to "done" would either (a) lie to the database, or (b) require a runner-bypass write path that contradicts the HITL gate. The card is draggable for *sorting* within a column only.
- **No `/metrics` cross-swarm cost trend page.** Plan §7 mentions one; the roadmap doesn't include it in phase 10. The cost line chart on the bento home covers the demo. A dedicated page is a phase 12+ refactor.
- **No widget editor / drag-to-rearrange dashboard layout.** The bento grid is fixed by `gridTemplateAreas`. Adding/removing widgets is a code change (one .tsx + one entry in `WIDGET_REGISTRY`), not a runtime configuration. Per the project's "I'll add components later" guidance the operator-developer is one person; a settings UI for layout is overkill.
- **No memory editing.** `/memories` is read-only — memories are created by agents and curated by the nightly cleanup debate (phase 09). Manual edits would defeat the audit trail.
- **No dark mode toggle.** Light mode is the only mode this phase ships. The dark `agent-canvas.html` mockup we explored becomes a possible phase 12+ option after Langfuse traces; not now. nothing-design treats both modes as first-class and we explicitly chose light per the user's pivot mid-brainstorm.
- **No real-time WebSocket / dedicated SSE for the bento home.** Polling at `refreshMs: 3000` per widget is the live-update strategy. The full canvas at `/tasks/[id]` keeps the existing phase-06 SSE feed; the home's embedded mini canvas reads the same SQL view but on a poll. Avoids a second SSE multiplexer for the home.
- **No Storybook / component gallery page.** Components are validated by their actual usage on the dashboard pages and by Playwright snapshots (see §10). A gallery would diverge from real data and rot.
- **No mobile / tablet layout.** The bento grid breakpoints to a single-column stack below 900 px (table-stakes responsive), but the design target is desktop ops. Phase 10 is not the place to invent mobile interaction patterns for a swarm cockpit.

## Cost check

Phase 10 is **front-end only** — no SDK calls during normal operation. Cost-relevant facts:

- **Model spend:** zero. The dashboards read `task_events` / `tasks` / `approval_gates` / `memories` over Drizzle. They never invoke `query()`. The agent canvas's "live" feel comes from polling those tables, not from running new agents.
- **Embeddings:** zero new embedding calls. `/memories` displays the same Gemini-1536 vectors phase 03 stored; we don't re-embed at view time.
- **Neon:** the monthly cost-line chart adds one indexed query (`task_runs` aggregated by `started_at::date` over 365 days). The existing `task_runs_started_at_idx` (added phase 05) covers this. No new indexes.
- **Inngest:** unchanged. The dashboards do not enqueue functions.
- **First polling fan-in:** with seven cells polling at 3 s and one developer browsing, the home generates ~14 req/min against Neon. Drizzle's connection pool (default 10) absorbs this. If we ever open the dashboard in two tabs we hit ~28 req/min — still fine. Mitigation if needed: a single `/api/dashboard/snapshot` endpoint that fans out the seven SQL queries server-side; not built in this phase.

If Auto-ride ever turns commercial and we move to API key auth, none of phase 10's load shows up in the Anthropic bill — the dashboards never call Claude.

## Dependencies

**New runtime packages** (the user installs manually per the package-installs feedback memory):

| Package | Why | Pin |
|---|---|---|
| `reactflow` | Agent canvas at `/tasks/[id]` and the embedded mini canvas on home | `^11.x` (latest stable; not the v12 alpha) |
| `@dnd-kit/core` + `@dnd-kit/sortable` | Kanban column sorting | `^6.1.x` / `^8.0.x` |
| `recharts` | `/agents/[name]` metric strip + the home's cost line chart | `^2.12.x` |

**New Google Fonts** (wired via `next/font/google` in `app/layout.tsx`):

- `Space Grotesk` (300, 400, 500, 600) — body, headings
- `Space Mono` (400, 700) — ALL-CAPS labels, tabular tags
- `Instrument Serif` (italic 400) — the one editorial accent ("here's" in the greeting)
- `Doto` (900) — single display moments only (greeting brand mark, optional Doto turn-counter on `/tasks/[id]`)

**Schema:** unchanged. Phase 02 + 07.1 + 09 already provisioned every column phase 10 reads. Specifically:

- `tasks.status` drives the kanban columns (with `approval_gates.status='open'` overlay).
- `task_events.payload.agent_name` (added phase 08) drives per-agent everything.
- `task_runs.total_cost_usd` + `total_input_tokens` + `total_output_tokens` drive cost/tokens stats.
- `memories.{bucket, segment, importance, last_recall_at}` drives the memories browser.
- `memory_cleanup_proposals.{verdict, proposed_action}` drives the "cleanup last night" card.

**Versions** (pinned; phase 10 does not bump):

- `next` `15.x` — unchanged, App Router with `force-dynamic` per phase 06
- `tailwindcss` `4.x` — unchanged
- `drizzle-orm` — unchanged

## Directory layout (delta from phase 09)

```
Agent-swarm/
├── app/
│   ├── (dashboard)/                                         # NEW group — shared bento shell
│   │   ├── layout.tsx                                       # NEW — top bar, theme provider, font loading
│   │   ├── page.tsx                                         # NEW — bento home /
│   │   ├── tasks/
│   │   │   ├── page.tsx                                     # EDIT — replaces existing /tasks listing with kanban
│   │   │   ├── kanban-board.tsx                             # NEW — dnd-kit columns
│   │   │   └── [id]/
│   │   │       ├── page.tsx                                 # EDIT — adds Canvas/Stream tab toggle
│   │   │       ├── canvas-view.tsx                          # NEW — full React Flow agent canvas
│   │   │       ├── canvas-scrubber.tsx                      # NEW — replay scrubber
│   │   │       ├── timeline-stream.tsx                      # MOVE — existing phase-06 stream view (unchanged code)
│   │   │       ├── approval-bar.tsx                         # MOVE — phase-07 (unchanged)
│   │   │       └── approval-card.tsx                        # MOVE — phase-07 (unchanged)
│   │   ├── agents/
│   │   │   └── [name]/
│   │   │       └── page.tsx                                 # NEW — Recharts metrics + recent runs
│   │   └── memories/
│   │       └── page.tsx                                     # NEW — filterable browser
│   ├── api/
│   │   └── dashboard/
│   │       ├── home/route.ts                                # NEW — JSON snapshot of all home cells (poll target)
│   │       ├── agent/[name]/route.ts                        # NEW — per-agent series for Recharts
│   │       └── memories/route.ts                            # NEW — paginated memories with filters
│   └── layout.tsx                                           # EDIT — load four Google Fonts via next/font
├── components/
│   ├── theme/
│   │   ├── tokens.ts                                        # NEW — single source of truth for CSS vars
│   │   └── theme-provider.tsx                               # EDIT — light only, uses tokens.ts
│   ├── dashboard/
│   │   ├── bento-grid.tsx                                   # NEW — CSS grid wrapper
│   │   ├── bento-cell.tsx                                   # NEW — base cell with key/title/open-↗
│   │   ├── widget-registry.ts                               # NEW — id → component map
│   │   ├── widgets/                                         # NEW directory — one .tsx per widget
│   │   │   ├── greeting.tsx                                 # NEW
│   │   │   ├── all-agents.tsx                               # NEW
│   │   │   ├── mini-canvas.tsx                              # NEW
│   │   │   ├── hitl-queue.tsx                               # NEW
│   │   │   ├── memory-writes-lime.tsx                       # NEW
│   │   │   ├── cleanup-last-night.tsx                       # NEW
│   │   │   ├── cost-line-12mo.tsx                           # NEW
│   │   │   ├── memory-segments-ring.tsx                     # NEW
│   │   │   └── active-workers-black.tsx                     # NEW
│   │   ├── canvas/
│   │   │   ├── agent-canvas.tsx                             # NEW — React Flow wrapper
│   │   │   ├── agent-node.tsx                               # NEW — single node renderer (variants per state)
│   │   │   ├── canvas-layout.ts                             # NEW — pure dispatcher→workers tree layout
│   │   │   └── connector-pill.tsx                           # NEW — branch reason pill on connectors
│   │   └── kanban/
│   │       ├── kanban-column.tsx                            # NEW
│   │       └── task-card.tsx                                # NEW
│   └── timeline/                                            # unchanged from phase 06
├── lib/
│   └── dashboard/
│       ├── queries.ts                                       # NEW — every read SQL the dashboards need
│       └── poll.ts                                          # NEW — generic SWR-style poll hook (no extra dep)
├── tests/
│   ├── dashboard/
│   │   ├── widget-registry.test.ts                          # NEW — every registered widget renders with mock data
│   │   ├── canvas-layout.test.ts                            # NEW — pure layout fn (deterministic)
│   │   ├── queries.test.ts                                  # NEW — SQL query shape against fixtures
│   │   └── kanban-derive.test.ts                            # NEW — status×gate → column derivation
│   └── e2e/
│       └── dashboard.spec.ts                                # NEW — Playwright: home, /tasks, /tasks/[id], /agents/[name], /memories
└── docs/superpowers/
    ├── specs/2026-04-27-phase-10-dashboards-design.md       # NEW — this file
    └── plans/2026-04-27-phase-10-dashboards-plan.md         # NEW (next session, via writing-plans)
```

**Why a route group `(dashboard)`:** the four dashboard routes share a top bar, font loading, and theme provider. The route group keeps them under one `layout.tsx` without polluting the URL with `/dashboard/...`. The bento shell renders only inside this group; phase 11's auth wrap will go on this same group's layout.

**Why move the existing `app/tasks/[id]/*.tsx` files into `app/(dashboard)/tasks/[id]/`:** phase 06's stream view is unchanged code — just a relocation so it sits inside the new shell. The `Canvas` / `Stream` tab toggle on the page lets us A/B the new view without breaking phase-06 tests.

## 1. Visual system

The dashboards are a custom variant of `nothing-design` rules: the typographic discipline, three-layer hierarchy, "subtract don't add", and "one moment of surprise" rules are kept verbatim. The monochrome canvas constraint is broken in exactly two places (the lime card and the black card) — and in those two places only — to mirror the Salesforce-style bento contrast pattern the user approved.

### 1.1 Palette (`components/theme/tokens.ts`)

```ts
export const COLOR = {
  // canvas
  bg:           '#efece6',          // page background, warm off-white
  bg2:          '#e6e2d8',          // gradient tail
  surface:      '#ffffff',          // standard cell
  surfaceWarm:  '#f6f2ea',          // muted cell variant (cleanup, segments)

  // ink
  ink:          '#0a0a0a',          // primary text, black contrast cell
  inkSoft:      '#1a1a18',
  muted:        '#75716a',          // secondary text
  muted2:       '#a09a8e',          // tertiary text, mono labels

  // borders
  line:         'rgba(10,10,10,0.08)',
  lineStrong:   'rgba(10,10,10,0.16)',

  // accents — used at most once per screen each
  lime:         '#d4ff3f',          // the one moment of surprise (one cell + one chart accent + active states)
  limeDeep:     '#b8e623',          // lime border / hover
  red:          '#d71921',          // HITL interrupt only — never decorative
} as const;
```

### 1.2 Typography (`app/layout.tsx`, `components/theme/tokens.ts`)

Three font families. Two weights per family. Five sizes total across the whole system.

| Token | Family | Size | Weight | Use |
|---|---|---|---|---|
| `display` | Doto | 64 px | 900 | Greeting brand mark `A`, optional turn counter on canvas page. **Once per screen, max.** |
| `numMega` | Space Grotesk | 38–44 px | 600 | Hero numbers in lime card, black card, greeting total |
| `numBig` | Space Grotesk | 30 px | 600 | Stat block primary numbers (cost, latency) |
| `h3` | Space Grotesk | 17 px | 500 | Cell headings ("Awaiting approvals") |
| `body` | Space Grotesk | 13–14 px | 400 | Card prose, summary lines |
| `label` | Space Mono | 9.5 px | 400 | ALL-CAPS cell keys, axis ticks, tool chips, branch pills. Letter-spacing 0.22em. |
| `editorial` | Instrument Serif italic | inherits | 400 | The single italic accent in the greeting (`*here's*`). Used **once on the home page**. |

Loaded via `next/font/google` so they're self-hosted at build time. No runtime CSS request.

### 1.3 Grid + spacing (`tokens.ts`)

```ts
export const GRID = {
  cols:   5,                        // bento grid is 5 columns
  gap:    '14px',
  cellRadius: '16px',
  innerPad: '22px',
} as const;

// nothing-design's "spacing as meaning" rule — used as Tailwind padding utilities
export const SPACING = {
  tight:   '8px',                   // icon + label, number + unit
  medium:  '16px',                  // list rows, form fields
  wide:    '32px',                  // section breaks
  vast:    '64px',                  // major divisions on the canvas page
} as const;
```

### 1.4 Motion (`tokens.ts`)

```ts
export const MOTION = {
  // nothing-design: percussive not fluid; subtle ease-out only; no spring/bounce.
  fast:     '150ms cubic-bezier(0.16, 1, 0.3, 1)',
  normal:   '250ms cubic-bezier(0.16, 1, 0.3, 1)',
  pulse:    '1.4s ease-in-out infinite',          // live indicator dot only
  dashFlow: '1.2s linear infinite',               // animated dashed connector on active delegation only
} as const;
```

Banned: parallax, scroll-jacking, card-stack scroll effects, scrub text reveals — anything in gpt-taste's motion catalog.

### 1.5 The two-card colour exception

`nothing-design` rules forbid coloured cells in chrome. Phase 10 violates that twice — both intentional, both load-bearing:

- **Lime cell (`<MemoryWritesLime />`)** — `bg: COLOR.lime`. The single bright moment per nothing-design's "one moment of surprise" rule. Carries the metric the project is proudest of (memory writes today; the adversarial-cleanup novelty).
- **Black cell (`<ActiveWorkersBlack />`)** — `bg: COLOR.ink`, `text: COLOR.surface`, plus a faint lime radial glow in the bottom-right corner (cross-references the lime cell on the opposite end of the grid — the Salesforce "Net Profit" trick).

These two cells are the only chrome that ignores the monochrome constraint. Every other cell is white-on-warm-off-white. The contrast they provide is what makes the rest of the page read as quiet.

## 2. Routes

### 2.1 `/` — Bento home

Five-column CSS grid using `grid-template-areas`:

```
"greet greet workers workers workers"
"canvas canvas canvas hitl   lime  "
"canvas canvas canvas cleanup lime  "
"cost   cost   cost   refl    black "
```

Cells (each one a registered widget — see §3.1 for the contract):

| Area | Widget id | Source data |
|---|---|---|
| `greet` | `greeting` | `tasks` count by month (last 6); `task_runs.total_cost_usd` summed for current month + prev |
| `workers` | `all-agents` | `task_events` grouped by `payload.agent_name`; `task_runs.total_cost_usd` / `started_at..ended_at` for latency |
| `canvas` | `mini-canvas` | most-recent `task_runs.status='in_progress'` row + its `task_events` (last 20 rows) |
| `hitl` | `hitl-queue` | `approval_gates` where `status='open'`, oldest first |
| `lime` | `memory-writes-lime` | `memories` filtered to today's `last_recall_at`; count of distinct ids touched |
| `cleanup` | `cleanup-last-night` | most recent `memory_cleanup_runs` row + `memory_cleanup_proposals` aggregated by verdict |
| `cost` | `cost-line-12mo` | `task_runs.total_cost_usd` aggregated by `started_at::date`, last 365 days, two series (total + opus-only filter) |
| `refl` | `memory-segments-ring` | `memories` grouped by `segment_id`; `importance` distribution (placeholder widget — read-only ring) |
| `black` | `active-workers-black` | distinct `payload.agent_name` from `task_events` joined to `task_runs` where `status='in_progress'` |

Polling: each widget owns its own `refreshMs`. Defaults: `mini-canvas` and `hitl-queue` at 2 s; `greeting`, `all-agents`, `active-workers-black` at 3 s; `cost-line-12mo`, `cleanup-last-night`, `memory-writes-lime`, `memory-segments-ring` at 30 s (slow-changing).

The bento grid collapses to a single-column stack below `900 px`.

### 2.2 `/tasks` — Kanban board

dnd-kit columns. Each column is `<KanbanColumn status="..." />` containing draggable `<TaskCard />`s. Status mapping:

| Column | Source filter |
|---|---|
| Queued | `tasks.status = 'queued'` |
| In progress | `tasks.status = 'in_progress' AND NO open approval_gate` |
| Awaiting approval | `tasks.status = 'in_progress' AND EXISTS open approval_gate` |
| Done | `tasks.status = 'done'` |
| Failed | `tasks.status = 'failed'` |

Column membership is **derived**, never set by the operator. Drag-to-reassign is intentionally not wired (see Non-goals). Within a column, drag reorders by `tasks.created_at` view order only — the order isn't persisted.

A `+ new task` pill at the top of the `Queued` column links to the existing phase-06 `<CreateTaskForm />` in a side sheet.

### 2.3 `/tasks/[id]` — Full agent canvas

Tab toggle at the top: `Canvas` (default) / `Stream`.

- `Canvas` renders `<AgentCanvas runId={...} mode="full" />` — React Flow with the dispatcher → workers tree, full-size cards with internal sparklines, inline HITL gate, and the bottom scrubber. Layout is computed by `canvas-layout.ts` (pure function: `(events: TaskEvent[]) => { nodes, edges }`).
- `Stream` renders the existing phase-06 `<TimelineStream />` unchanged. Phase-06 tests keep working.

The scrubber is a horizontal time-axis spanning the run's `started_at` → `ended_at` (or `now()` if live). Each `task_event` becomes a tick: cream for tool calls, red for HITL gates, vertical bar for `NOW`. Dragging the cursor left re-renders the canvas at that point in time (replay nodes/edges from the events up to that timestamp). The replay is a pure derivation — no extra state, no rewinding the runner.

### 2.4 `/agents/[name]` — Per-agent metrics

Four-section page:

1. **Header strip** — agent name, model, tool surface, soft budget (from the registry `lib/agent/agents/index.ts`).
2. **Recharts trio** —
   - p50/p95 latency over last 30 days (from `task_events` `created_at` deltas grouped by `agent_name`).
   - Daily token spend (from `task_events.payload.usage` summed per day).
   - Success rate (count of `task_runs` where this agent was used and `status='done'` / total).
3. **Recent runs table** — last 50 `task_runs` that included this agent, linkable to `/tasks/[id]`.
4. **Memory hits table** — top 10 `memories` ranked by recall count from this agent (from `mcp_memory_recall_log` if it exists; placeholder list otherwise — see §6 for the soft dependency).

All read-only. No `query()` invocation. No mutations.

### 2.5 `/memories` — Memory browser

Filter bar across the top:

- **Bucket** segment (short / long / permanent) — derived from `memories.bucket_id`.
- **Segment** dropdown (identity / correction / preference / relationship / knowledge / behavioral / context).
- **Touched by last cleanup** toggle (joins `memory_cleanup_proposals` to highlight rows the latest debate verdicted).

Below: paginated table with columns `id (truncated)`, `content (excerpt)`, `bucket`, `segment`, `importance`, `last_recall_at`, `recall_count`, `cleanup verdict (if any)`. Row click opens a side panel with the full content + a small history strip showing this memory's reinforcement events.

100 rows per page, btree-cursored on `id` for stable pagination.

## 3. Component contracts

### 3.1 `DashWidget` — the slot contract

Every bento cell is a `<DashWidget />`. The contract is intentionally narrow so the user can ship "lots of visual components later" without touching the layout.

```ts
// components/dashboard/widget-registry.ts
export type WidgetId =
  | 'greeting'
  | 'all-agents'
  | 'mini-canvas'
  | 'hitl-queue'
  | 'memory-writes-lime'
  | 'cleanup-last-night'
  | 'cost-line-12mo'
  | 'memory-segments-ring'
  | 'active-workers-black';

export type WidgetDef = {
  id: WidgetId;
  /** display name in the cell key bar */
  name: string;
  /** the area name in the bento `grid-template-areas` */
  gridArea: string;
  /** poll cadence — cell re-fetches and re-renders this often */
  refreshMs: number;
  /** SWR-style fetcher returning the data this widget needs */
  load: () => Promise<unknown>;
  /** the actual render — receives the data from load() */
  Component: React.ComponentType<{ data: unknown }>;
};

export const WIDGET_REGISTRY: Record<WidgetId, WidgetDef> = {
  greeting:               { id: 'greeting', ... },
  // ... eight more
};
```

Adding a widget post-phase-10:

1. Create `components/dashboard/widgets/<your-widget>.tsx` with a default-exported `Component` accepting `{ data }`.
2. Write a `load()` that returns whatever shape your `Component` reads.
3. Add an entry to `WIDGET_REGISTRY` and assign a `gridArea`.
4. Update the home page's `grid-template-areas` to include the new area.

The widget renders inside `<BentoCell name={...} />`, which provides the standard cell chrome (border, radius, padding, key bar, ↗ icon). The widget body fills the inner content area.

### 3.2 `<AgentCanvas />` — the React Flow wrapper

```ts
type AgentCanvasProps = {
  runId: string;
  /** 'full' on /tasks/[id]; 'mini' inside the bento */
  mode: 'full' | 'mini';
  /** scrubber cursor (epoch ms); when omitted, renders live */
  asOf?: number;
};
```

- In `mini` mode: smaller node cards (no sparkline, max 3 tool chips, no scrubber, no header strip).
- In `full` mode: large nodes with internal sparkline, full tool chip list, inline HITL action card, header strip with subject + live pill, footer scrubber.
- Same `canvas-layout.ts` pure function in both modes — it returns `{ nodes, edges }` from a `TaskEvent[]`. Layout is deterministic given the same events list (so the scrubber can replay).

Layout algorithm (deterministic, test-coverable):

1. The dispatcher is always the root, positioned at the top-center.
2. Workers the dispatcher actually delegated to are positioned in a single row below, ordered by first-`tool_call` timestamp.
3. Each worker's tool calls are rendered as chips inside the worker's node — no separate child nodes, no second graph layer.
4. HITL gates render inline inside the worker node that triggered them, not as separate nodes.
5. Edges are drawn dispatcher→worker with the dispatcher's routing reason as a small pill (Stacklane's `NO`/`YES` analogue). Routing reason is parsed from the dispatcher's `assistant_turn` message preceding the `Agent` tool call.

### 3.3 `<KanbanColumn />` and `<TaskCard />`

```ts
type KanbanColumnProps = {
  status: 'queued' | 'in_progress' | 'awaiting_approval' | 'done' | 'failed';
  tasks: TaskWithGate[];
};
```

`TaskWithGate` includes `tasks.*` plus an optional `openGate` row from `approval_gates`. The card shows the task prompt (truncated to 2 lines), agent count from `task_events`, cost so far, time-since-started, and a red dot when `openGate` exists.

### 3.4 `<KanbanBoard />` polling

A single `useDashboardPoll('/api/tasks/board')` at 3 s drives the whole board. The endpoint returns one JSON payload with all columns; the client diffs it into the column components. Reduces the seven-cell fan-in problem to one query.

## 4. Data sources (read-only SQL surface)

Every dashboard query lives in `lib/dashboard/queries.ts`. No widget ad-hoc Drizzle calls. This makes the queries swappable by an `/api/dashboard/snapshot` endpoint later if polling pressure demands.

| Function | Returns | Used by |
|---|---|---|
| `getGreetingSnapshot()` | `{ months: {label, count}[], totalThisMonth: number, totalLastMonth: number, monthCost: number }` | `<Greeting />` |
| `getAllAgentsSnapshot()` | `{ avgCostPerTask: number, perAgentCost: {agent, cost}[], avgP95Latency: number, perAgentP95: {agent, ms}[] }` | `<AllAgents />` |
| `getActiveRun()` | `{ run: TaskRun, task: Task, events: TaskEvent[] } \| null` | `<MiniCanvas />`, `<AgentCanvas mode="full">` |
| `getOpenApprovalGates()` | `ApprovalGate[]` (with task prompt joined) | `<HitlQueue />` |
| `getMemoryWritesToday()` | `{ count: number, deltaVsYesterday: number }` | `<MemoryWritesLime />` |
| `getLastCleanup()` | `{ runStartedAt: Date, promoted: number, pruned: number, contested: number }` | `<CleanupLastNight />` |
| `getCostLine12Mo()` | `{ days: {date, total, opusOnly}[] }` | `<CostLine12Mo />` |
| `getMemorySegmentsSnapshot()` | `{ segments: {id, count, avgImportance}[] }` | `<MemorySegmentsRing />` |
| `getActiveWorkers()` | `{ activeAgentNames: string[], totalAgents: number }` | `<ActiveWorkersBlack />` |
| `getKanbanBoard()` | `{ queued: TaskWithGate[], inProgress: ..., awaitingApproval: ..., done: ..., failed: ... }` | `<KanbanBoard />` |
| `getAgentMetrics(name)` | `{ p50p95Latency: ..., dailyTokens: ..., successRate: number, recentRuns: TaskRun[] }` | `/agents/[name]` |
| `getMemories(filter, page)` | `{ rows: MemoryWithCleanup[], total: number }` | `/memories` |

Each query is its own pure async function; tests (see §10) drive them against fixtures.

## 5. Real-time strategy

**Primary mechanism: polling.** Each widget owns a `refreshMs`. A custom hook `useDashboardPoll(loader, refreshMs)` (in `lib/dashboard/poll.ts`) handles:

- initial load,
- interval refresh,
- pause when the tab is hidden (`document.visibilityState !== 'visible'`),
- resume + immediate refetch on visibility change,
- request deduplication (one in-flight per loader at a time).

No SWR / React Query dependency — a 40-line hook with `useEffect` + `setInterval` covers the surface area we need. nothing-design's "subtract don't add" rule on dependencies.

**Exception: `/tasks/[id]` Canvas mode keeps the phase-06 SSE feed.** When `mode='full'`, `<AgentCanvas />` subscribes to `/api/tasks/[id]/stream` and rebuilds nodes/edges as new events arrive. The mini canvas on the home polls instead.

**Why polling for the home:** there are seven independent widgets on the home; multiplexing seven cells over one SSE stream needs a fan-out protocol on the server (per-cell topics, per-cell auth), which doesn't ship until phase 11. Polling is enough for a portfolio demo and saves a chunk of work. The user can move any single cell to SSE later without touching the others.

## 6. Soft dependency: per-agent memory recall log

The `/agents/[name]` page wants a "top memories recalled by this agent" list. `mcp__memory__recall` doesn't currently log which agent invoked it. Two ways to surface this without a phase-10 schema migration:

1. **Use `task_events`.** When a `tool_call` for `mcp__memory__recall` lands, `payload.agent_name` is already set (phase 08). The result memory ids live in `tool_result.payload.content`. Aggregating gives us a per-agent recall histogram. Slower than a dedicated log, but free.
2. **Skip the memory list for phase 10.** Show the recent-runs table only. Add the per-agent recall list in a later phase if the demo asks for it.

**Decision: option 1.** A 30-line query in `getAgentMetrics()` parses the recall result payloads and returns a top-10 list. No new table, no schema change, no extra writes during agent execution. Performance: the query reads at most 10k rows per agent over the 30-day window (well under one second on the existing `task_events_task_id_idx`).

## 7. Acceptance criteria

The PR is mergeable when all of the following are true:

1. **Theme tokens exported.** `components/theme/tokens.ts` defines `COLOR`, `GRID`, `SPACING`, `MOTION`. No Tailwind class outside this file uses a raw hex; everything pulls from a CSS variable named after the token.
2. **Four Google Fonts loaded** via `next/font/google` in `app/layout.tsx`. No runtime `<link>` to `fonts.googleapis.com`.
3. **Widget registry has 9 entries**, every entry has a `Component`, a `load()`, and a `gridArea`. A test (`tests/dashboard/widget-registry.test.ts`) renders each widget against mock data and snapshots the output.
4. **Home page renders without errors against an empty database.** Empty states are inline mono-caps text (e.g. `[NO ACTIVE RUNS]`), not skeleton loaders. nothing-design rule.
5. **Mini canvas and full canvas share `canvas-layout.ts`.** A unit test (`tests/dashboard/canvas-layout.test.ts`) feeds the same `TaskEvent[]` to both and asserts identical node/edge structure (positions may differ via mode prop; topology must not).
6. **Kanban derives columns from `tasks.status` + `approval_gates`.** A unit test (`tests/dashboard/kanban-derive.test.ts`) covers the truth table: 5 status values × {gate open, gate closed} = 10 cases, all pinned.
7. **`/tasks/[id]` Canvas tab is the default.** Stream tab still renders the unchanged phase-06 timeline. Both tabs subscribe to the same `/api/tasks/[id]/stream`.
8. **`/agents/[name]` renders for every registered agent name** without a 404. The route is dynamic; the union of valid names is `lib/agent/agents/index.ts`'s `AgentName` type. A test asserts every name from the registry resolves.
9. **`/memories` filter combinations work.** Test for: bucket only, segment only, both, "touched by last cleanup" toggle alone, all three together. Pagination cursor stable across reloads.
10. **`/health` route still responds 200.** Phase 11 will add an auth wrap that excludes `/health`; this phase must not break it ahead of time.
11. **End-to-end Playwright spec passes** (`tests/e2e/dashboard.spec.ts`):
    - Visit `/`, see the lime cell with a number > 0 (after seeding), see the active-workers black cell.
    - Visit `/tasks`, drag a card within a column, see the order persist for the session (does NOT persist across reloads — that's intentional).
    - Visit `/tasks/[id]`, click `Canvas`, see at least one node, click `Stream`, see the timeline.
    - Visit `/agents/fleet-analyst`, see the three Recharts components mounted.
    - Visit `/memories`, apply a bucket filter, see the row count change.
12. **No new MCP servers, no `query()` calls from any dashboard route.** Grep-level invariant: `app/(dashboard)/**` and `components/dashboard/**` must not import from `@anthropic-ai/claude-agent-sdk`.
13. **Bundle size sanity.** `next build` reports the home page route under 500 kB compressed including React Flow. Recharts is dynamic-imported in `/agents/[name]` only, so the home doesn't ship it.
14. **Light mode only.** No `prefers-color-scheme: dark` rule in any committed CSS. nothing-design's "neither mode is derived" doesn't apply if we're shipping one.
15. **The bento home, the canvas page, and the Salesforce-inspired greeting visually match the approved mockups** at `.superpowers/brainstorm/347-1777309300/content/{bento-home,agent-canvas}.html`. Reviewer eyeballs them side-by-side; deliberate deviations are noted in the PR description.

## 8. Sequencing — the order tasks ship within phase 10

The plan (next session) will turn this into atomic commits. The intended order is:

1. **Theme + fonts** (`tokens.ts`, `layout.tsx`). No visible UI yet.
2. **`(dashboard)` route group + top bar.** Empty bento grid renders at `/`.
3. **`<BentoCell />` and `<BentoGrid />` primitives.** Visible chrome but no widgets.
4. **`lib/dashboard/queries.ts`** — every read query, tested against fixtures.
5. **`lib/dashboard/poll.ts`** — the polling hook, tested.
6. **Widgets in dependency order** (data → render):
   - `<Greeting />`, `<AllAgents />`, `<HitlQueue />` (read-only, no canvas dependency).
   - `<MemoryWritesLime />`, `<CleanupLastNight />`, `<CostLine12Mo />`, `<MemorySegmentsRing />`, `<ActiveWorkersBlack />`.
   - `<MiniCanvas />` (depends on `<AgentCanvas mode="mini">`).
7. **`<AgentCanvas />` + `canvas-layout.ts`** — used by the mini canvas first, then the full canvas page.
8. **`/tasks/[id]` Canvas/Stream tab toggle.**
9. **`/tasks` kanban** (depends on the existing task list page; replaces it).
10. **`/agents/[name]`** (Recharts; dynamic-imported).
11. **`/memories`** (filterable browser).
12. **Playwright E2E** spec.

Phase 11 lifts the auth wrap onto `(dashboard)/layout.tsx`. Phase 12 wires Langfuse traces into the canvas and a deploy. Neither requires re-touching phase 10's components.

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| **React Flow's default styles fight nothing-design.** | Override the four CSS classes (`react-flow__node`, `react-flow__edge`, `react-flow__handle`, `react-flow__controls`) in a single `agent-canvas.css` colocated with `<AgentCanvas />`. Don't use the `<Background />` component — render our own dotted background via CSS. |
| **dnd-kit + Next 15 + React 19 compatibility.** | Pin `@dnd-kit/core@^6.1.0` (known compatible). If a regression surfaces, fall back to native HTML5 DnD — the kanban only needs same-column reordering, not cross-column. |
| **Recharts SSR hydration warnings on the home if we put a chart on `/`.** | The cost-line chart uses Recharts, so we `next/dynamic` import it with `ssr: false`. The home renders a skeleton placeholder (mono-caps `[LOADING…]` per nothing-design's no-skeletons rule, just text) for one frame. |
| **Polling fan-in if many tabs are open.** | Each widget already pauses on `document.visibilityState !== 'visible'`. If pressure shows up in dev, a single `/api/dashboard/snapshot` endpoint replaces nine independent endpoints with one. Spec'd as a fallback, not built day one. |
| **Scrubber replay drifts from live SSE.** | When the scrubber cursor is at `now`, the canvas subscribes to SSE. When the user drags it back, the SSE subscription is paused; the canvas re-renders deterministically from the events array sliced to `asOf`. Resume = jump to live + re-subscribe. State machine is documented in `<AgentCanvas />`'s JSDoc. |
| **Memory writes count drifts on long-running cleanup nights.** | `getMemoryWritesToday()` counts memories with `last_recall_at >= midnight UTC`. Cleanup tombstones don't move that timestamp (phase 09's contract), so the count is stable across cleanup runs. |

## 10. What ships from `.superpowers/` to the commit

The brainstorm content directory (`mockups`) is gitignored. Only the spec at `docs/superpowers/specs/2026-04-27-phase-10-dashboards-design.md` and the plan that follows commit. The mockups stay local as visual sources of truth — the acceptance criteria reference them by path, not by checked-in copies.

If a future reviewer needs to see the mockups, they're in `.superpowers/brainstorm/347-1777309300/content/` on the dev machine; otherwise the spec text plus the implementation diff communicates the intent.
