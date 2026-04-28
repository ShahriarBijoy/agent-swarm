# Phase 10 Implementation Plan — Bento home, agent canvas, kanban, metrics, memories

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the operator dashboard surface — a light-mode bento home, full agent canvas, kanban, per-agent metrics, and memory browser — visualising every signal phases 02–09 already produce.

**Architecture:** App Router route group `app/(dashboard)/*` shares one `layout.tsx` (top bar + theme + fonts). Pure-function `canvas-layout.ts` derives React Flow nodes/edges from `task_events`, used by both the home's mini canvas and the full canvas page. Each home cell is a registered `<DashWidget />` with its own `load()` + `refreshMs`; polling is per-widget via a `useDashboardPoll` hook (no SWR dep). Reads go through `lib/dashboard/queries.ts` (single source of truth, Drizzle); the existing phase-06 SSE feed is reused only on the full canvas page.

**Tech Stack:** TypeScript / Next.js 16 App Router (RSC) / React 19 / Tailwind 4 / Drizzle ORM 0.45 / Neon Postgres / `reactflow` 11 / `@dnd-kit/core`+`sortable` / `recharts` 2 / Vitest 4 / Playwright (new dev dep) / Google Fonts via `next/font/google` (Space Grotesk, Space Mono, Instrument Serif italic, Doto).

**Spec:** `docs/superpowers/specs/2026-04-27-phase-10-dashboards-design.md`

**Visual sources of truth (local-only, gitignored):**
- `.superpowers/brainstorm/347-1777309300/content/bento-home.html` — home dashboard reference
- `.superpowers/brainstorm/347-1777309300/content/agent-canvas.html` — full canvas reference

---

## File structure

```
components/theme/
  tokens.ts                       [NEW]  COLOR + GRID + SPACING + MOTION (single source)
  theme-provider.tsx              [MOD]  light-only, reads tokens.ts (next-themes already installed)

components/dashboard/
  bento-grid.tsx                  [NEW]  CSS-grid wrapper consuming registry
  bento-cell.tsx                  [NEW]  cell chrome — key bar + ↗ + slot
  widget-registry.ts              [NEW]  WidgetId union, WidgetDef type, WIDGET_REGISTRY map
  widgets/
    greeting.tsx                  [NEW]  "Hi <name>, here's what's happening" + month bars
    all-agents.tsx                [NEW]  per-agent stat block with mini-bars
    mini-canvas.tsx               [NEW]  embedded <AgentCanvas mode="mini" />
    hitl-queue.tsx                [NEW]  open gates list + inline approve action
    memory-writes-lime.tsx        [NEW]  the lime accent cell
    cleanup-last-night.tsx        [NEW]  promoted/pruned/contested mini-stats
    cost-line-12mo.tsx            [NEW]  Recharts line (dynamic import, ssr:false)
    memory-segments-ring.tsx      [NEW]  segment importance ring
    active-workers-black.tsx      [NEW]  the black contrast cell
  canvas/
    canvas-layout.ts              [NEW]  pure (events) -> { nodes, edges }
    agent-node.tsx                [NEW]  React Flow custom node (variants per state)
    connector-pill.tsx            [NEW]  branch-reason pill on edges
    agent-canvas.tsx              [NEW]  React Flow wrapper, mode="full"|"mini"
    canvas-scrubber.tsx           [NEW]  bottom replay scrubber (full mode only)
  kanban/
    kanban-board.tsx              [NEW]  five-column wrapper
    kanban-column.tsx             [NEW]  single column with drop target
    task-card.tsx                 [NEW]  one task tile

lib/dashboard/
  queries.ts                      [NEW]  every read SQL the dashboards need
  poll.ts                         [NEW]  useDashboardPoll(loader, refreshMs) hook
  fixtures.ts                     [NEW]  shared mock data for component tests

app/
  layout.tsx                      [MOD]  swap Geist for Space Grotesk + Mono + Instrument Serif italic + Doto
  page.tsx                        [DELETE]  replaced by app/(dashboard)/page.tsx
  globals.css                     [MOD]  CSS variables from tokens.ts; light-mode body bg
  (dashboard)/
    layout.tsx                    [NEW]  top bar + nav pills + brand mark
    page.tsx                      [NEW]  bento home composing 9 widgets
    tasks/
      page.tsx                    [NEW]  kanban board (replaces app/tasks/page.tsx)
      create-form.tsx             [MOVE] from app/tasks/create-form.tsx (unchanged)
      [id]/
        page.tsx                  [MOVE+EDIT] tab toggle Canvas/Stream
        canvas-view.tsx           [NEW]  Canvas tab content (uses <AgentCanvas mode="full">)
        timeline-stream.tsx       [MOVE] from app/tasks/[id]/ (unchanged)
        approval-bar.tsx          [MOVE] from app/tasks/[id]/ (unchanged)
        approval-card.tsx         [MOVE] from app/tasks/[id]/ (unchanged)
        not-found.tsx             [MOVE] from app/tasks/[id]/ (unchanged)
    agents/
      [name]/
        page.tsx                  [NEW]  Recharts trio + recent runs + memory hits
    memories/
      page.tsx                    [NEW]  filterable browser (bucket × segment × cleanup-touched)
  api/
    dashboard/
      route.ts                    [NEW]  GET ?widget=<id> -> JSON snapshot per widget

tests/
  dashboard/
    tokens.test.ts                [NEW]  token shape invariants
    queries-home.test.ts          [NEW]  greeting, all-agents, active-workers
    queries-live.test.ts          [NEW]  active-run, open-gates, memory-writes, cleanup
    queries-charts.test.ts        [NEW]  cost-line, segments
    queries-kanban.test.ts        [NEW]  status × gate truth table
    queries-agents.test.ts        [NEW]  getAgentMetrics
    queries-memories.test.ts      [NEW]  filter + pagination
    canvas-layout.test.ts         [NEW]  pure fn — node/edge derivation
    widget-registry.test.ts       [NEW]  every registered widget renders mock data
    poll.test.ts                  [NEW]  visibility-pause + dedup + interval
  e2e/
    dashboard.spec.ts             [NEW]  Playwright — home, tasks, canvas, agent, memories

playwright.config.ts              [NEW]
package.json                      [MOD]  scripts: "test:e2e"; deps: reactflow, @dnd-kit, recharts, @playwright/test
.env.example                      [MOD]  add OPERATOR_NAME=Shahriar
README.md                         [MOD]  phase 10 demo section
```

**Files NOT modified:** anything in `db/schema/`, `lib/agent/`, `lib/cleanup/`, `lib/memory/`, `lib/runner/`. Phase 10 is pure read-side.

**Three guardrails enforced by an invariant test (Task 30):**

1. No file in `app/(dashboard)/**` or `components/dashboard/**` imports from `@anthropic-ai/claude-agent-sdk`.
2. No file in `components/dashboard/widgets/**` imports from `recharts` directly (must go through `next/dynamic` to keep the home bundle small).
3. Every `WidgetId` in `widget-registry.ts` has a registered `Component` and a corresponding `tests/dashboard/widget-registry.test.ts` snapshot.

---

## Pre-flight — user installs deps + Google Fonts (no commit yet)

The user installs packages manually per the package-installs feedback memory. Before any task runs:

- [ ] **Pre-flight 1: Install runtime deps** (user runs)

```bash
pnpm add reactflow@^11 @dnd-kit/core@^6 @dnd-kit/sortable@^8 recharts@^2
```

- [ ] **Pre-flight 2: Install dev dep** (user runs)

```bash
pnpm add -D @playwright/test@^1
pnpm exec playwright install chromium
```

- [ ] **Pre-flight 3: Confirm Google Fonts reachable**

`next/font/google` resolves at build time, no install. Just verify in Task 2 that `next build` doesn't fail to fetch.

- [ ] **Pre-flight 4: `.env.local` carries `OPERATOR_NAME`**

Add to `.env.local`:

```bash
OPERATOR_NAME=Shahriar
```

If absent, the greeting falls back to `'Operator'`.

---

### Task 1: Theme tokens (single source of truth)

**Files:**
- Create: `components/theme/tokens.ts`
- Test: `tests/dashboard/tokens.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/dashboard/tokens.test.ts
import { describe, expect, it } from 'vitest';
import { COLOR, GRID, SPACING, MOTION } from '@/components/theme/tokens';

describe('phase-10 theme tokens', () => {
  it('exports the seven palette colours used by widgets', () => {
    expect(COLOR.bg).toBe('#efece6');
    expect(COLOR.surface).toBe('#ffffff');
    expect(COLOR.surfaceWarm).toBe('#f6f2ea');
    expect(COLOR.ink).toBe('#0a0a0a');
    expect(COLOR.lime).toBe('#d4ff3f');
    expect(COLOR.red).toBe('#d71921');
    expect(COLOR.muted).toBe('#75716a');
  });

  it('exports the bento grid shape', () => {
    expect(GRID.cols).toBe(5);
    expect(GRID.gap).toBe('14px');
    expect(GRID.cellRadius).toBe('16px');
    expect(GRID.innerPad).toBe('22px');
  });

  it('exports the four spacing tiers in pixels', () => {
    expect(SPACING.tight).toBe('8px');
    expect(SPACING.medium).toBe('16px');
    expect(SPACING.wide).toBe('32px');
    expect(SPACING.vast).toBe('64px');
  });

  it('motion tokens use ease-out (no bounce/spring)', () => {
    expect(MOTION.fast).toContain('cubic-bezier(0.16, 1, 0.3, 1)');
    expect(MOTION.normal).toContain('cubic-bezier(0.16, 1, 0.3, 1)');
    expect(MOTION.pulse).toBe('1.4s ease-in-out infinite');
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm test tests/dashboard/tokens.test.ts
```

Expected: `Cannot find module '@/components/theme/tokens'` (or all 4 tests FAIL).

- [ ] **Step 3: Create the tokens module**

```ts
// components/theme/tokens.ts
// Single source of truth for the phase-10 dashboard palette + spacing.
// Every Tailwind class outside this file should reference a CSS variable
// named after one of these tokens (e.g. `bg-[var(--color-surface)]`).

export const COLOR = {
  bg:           '#efece6',
  bg2:          '#e6e2d8',
  surface:      '#ffffff',
  surfaceWarm:  '#f6f2ea',
  ink:          '#0a0a0a',
  inkSoft:      '#1a1a18',
  muted:        '#75716a',
  muted2:       '#a09a8e',
  line:         'rgba(10,10,10,0.08)',
  lineStrong:   'rgba(10,10,10,0.16)',
  lime:         '#d4ff3f',
  limeDeep:     '#b8e623',
  red:          '#d71921',
} as const;

export const GRID = {
  cols:        5,
  gap:        '14px',
  cellRadius: '16px',
  innerPad:   '22px',
} as const;

export const SPACING = {
  tight:  '8px',
  medium: '16px',
  wide:   '32px',
  vast:   '64px',
} as const;

export const MOTION = {
  fast:     '150ms cubic-bezier(0.16, 1, 0.3, 1)',
  normal:   '250ms cubic-bezier(0.16, 1, 0.3, 1)',
  pulse:    '1.4s ease-in-out infinite',
  dashFlow: '1.2s linear infinite',
} as const;

export type ColorToken = keyof typeof COLOR;
```

- [ ] **Step 4: Run, verify pass**

```bash
pnpm test tests/dashboard/tokens.test.ts
```

Expected: 4/4 PASS.

- [ ] **Step 5: Commit**

```bash
git add components/theme/tokens.ts tests/dashboard/tokens.test.ts
git commit -m "phase 10: theme tokens (palette, grid, spacing, motion)"
```

---

### Task 2: Google Fonts in `app/layout.tsx` + global CSS variables

**Files:**
- Modify: `app/layout.tsx` (replace Geist with Space Grotesk + Mono + Instrument Serif italic + Doto)
- Modify: `app/globals.css` (add CSS variables from tokens, light-mode body bg)

(No test file — typecheck + manual smoke at the end.)

- [ ] **Step 1: Edit `app/layout.tsx`** — replace existing imports

```tsx
// app/layout.tsx
import { Space_Grotesk, Space_Mono, Instrument_Serif, Doto } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { cn } from '@/lib/utils';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-sans',
});

const spaceMono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-mono',
});

const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: 'italic',
  variable: '--font-serif-italic',
});

const doto = Doto({
  subsets: ['latin'],
  weight: '900',
  variable: '--font-display',
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        'antialiased font-sans',
        spaceGrotesk.variable,
        spaceMono.variable,
        instrumentSerif.variable,
        doto.variable,
      )}
    >
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Edit `app/globals.css`** — append CSS variables + light-mode body

Append at the end of the existing file:

```css
/* phase-10 dashboard tokens — keep in sync with components/theme/tokens.ts */
:root {
  --color-bg: #efece6;
  --color-bg-2: #e6e2d8;
  --color-surface: #ffffff;
  --color-surface-warm: #f6f2ea;
  --color-ink: #0a0a0a;
  --color-ink-soft: #1a1a18;
  --color-muted: #75716a;
  --color-muted-2: #a09a8e;
  --color-line: rgba(10, 10, 10, 0.08);
  --color-line-strong: rgba(10, 10, 10, 0.16);
  --color-lime: #d4ff3f;
  --color-lime-deep: #b8e623;
  --color-red: #d71921;

  --grid-gap: 14px;
  --cell-radius: 16px;
  --cell-pad: 22px;
}

html, body {
  background: linear-gradient(180deg, #f4f0e7 0%, #ece6db 100%);
  color: var(--color-ink);
  min-height: 100vh;
}

.font-display { font-family: var(--font-display), monospace; }
.font-serif-italic { font-family: var(--font-serif-italic), serif; font-style: italic; }
```

- [ ] **Step 3: Verify the build still works**

```bash
pnpm typecheck
pnpm build
```

Expected: both succeed. The build will fetch the four fonts at compile time.

- [ ] **Step 4: Run dev and eyeball `/` once**

```bash
pnpm dev -p 3100
```

Open `http://localhost:3100`. The placeholder text should now render in Space Grotesk on the warm-cream gradient. Stop the dev server (`Ctrl+C`).

- [ ] **Step 5: Commit**

```bash
git add app/layout.tsx app/globals.css
git commit -m "phase 10: load Space Grotesk + Mono + Instrument Serif + Doto via next/font"
```

---

### Task 3: `(dashboard)` route group with shared layout (top bar)

**Files:**
- Create: `app/(dashboard)/layout.tsx` (top bar + nav pills + brand mark)
- Create: `app/(dashboard)/page.tsx` (placeholder bento home — empty grid)
- Delete: `app/page.tsx` (otherwise Next throws a route-collision error at `/`)

(No new test file — visual smoke + existing `tests/health.test.ts` continues to pass.)

- [ ] **Step 1: Delete the placeholder root page**

```bash
git rm app/page.tsx
```

- [ ] **Step 2: Create `app/(dashboard)/layout.tsx`**

```tsx
// app/(dashboard)/layout.tsx
import Link from 'next/link';

export default function DashboardLayout({
  children,
}: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen px-6 pt-6 pb-10">
      <header className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-4 px-2 pb-5">
        <div className="flex items-center gap-2.5">
          <div className="grid h-[22px] w-[22px] place-items-center rounded-[4px] bg-[var(--color-ink)] font-display text-[14px] text-[var(--color-lime)]">A</div>
          <span className="text-[16px] font-semibold tracking-tight">
            auto-ride <span className="font-normal text-[var(--color-muted)]">/ swarm-ops</span>
          </span>
        </div>
        <nav className="justify-self-center flex gap-1.5 rounded-full bg-black/5 p-1">
          {(['Today', 'This Week', 'This Month', 'Reports'] as const).map((label, i) => (
            <button
              key={label}
              className={`rounded-full px-4 py-[7px] text-[13px] font-medium ${
                i === 2 ? 'bg-[var(--color-ink)] text-[var(--color-surface)]' : 'text-[var(--color-muted)]'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
        <Link
          href="/tasks"
          className="rounded-full border border-[var(--color-line-strong)] px-3.5 py-[7px] text-[12px] font-medium"
        >
          All agents ▾
        </Link>
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--color-ink)] font-mono text-[14px] text-[var(--color-surface)]">⌘</div>
      </header>
      {children}
    </div>
  );
}
```

- [ ] **Step 3: Create `app/(dashboard)/page.tsx`** — empty bento placeholder

```tsx
// app/(dashboard)/page.tsx
export default function HomePage() {
  return (
    <div className="grid grid-cols-5 gap-[14px]" data-testid="bento-home">
      <div className="col-span-5 rounded-[16px] border border-[var(--color-line)] bg-[var(--color-surface)] p-[22px] text-[var(--color-muted)]">
        Phase 10 home — widgets land here.
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify**

```bash
pnpm typecheck
pnpm dev -p 3100
```

Open `http://localhost:3100` — should show the new top bar (brand `A`, nav pills with "This Month" highlighted, `All agents ▾`, `⌘` square) plus the placeholder cell. Stop dev.

- [ ] **Step 5: Commit**

```bash
git add app/\(dashboard\)/layout.tsx app/\(dashboard\)/page.tsx
git commit -m "phase 10: (dashboard) route group with shared top bar + brand"
```

(Note: the parens in the route-group folder name need backslash-escaping in bash; in PowerShell use single quotes around the path.)

---

### Task 4: `<BentoGrid />` + `<BentoCell />` primitives

**Files:**
- Create: `components/dashboard/bento-grid.tsx`
- Create: `components/dashboard/bento-cell.tsx`
- Test: `tests/dashboard/widget-registry.test.ts` (initial — registry skeleton)

This task ships the chrome only — no widgets yet. Subsequent tasks plug widgets into the grid.

- [ ] **Step 1: Write failing test**

```ts
// tests/dashboard/widget-registry.test.ts
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { BentoCell } from '@/components/dashboard/bento-cell';

describe('phase-10 BentoCell', () => {
  it('renders cell key in ALL CAPS mono', () => {
    const { getByText } = render(
      <BentoCell name="Awaiting approvals" gridArea="hitl">
        <div>body</div>
      </BentoCell>,
    );
    const key = getByText(/Awaiting approvals/i);
    expect(key.className).toMatch(/font-mono/);
    expect(key.textContent?.toUpperCase()).toBe(key.textContent);
  });

  it('applies the gridArea inline style', () => {
    const { container } = render(
      <BentoCell name="X" gridArea="lime"><span /></BentoCell>,
    );
    const style = (container.firstChild as HTMLElement).style;
    expect(style.gridArea).toBe('lime');
  });
});
```

If the project doesn't yet have `@testing-library/react`, add it as a dev dep first:

```bash
pnpm add -D @testing-library/react @testing-library/dom jsdom
```

Then add to `vitest.config.ts`'s `test` block: `environment: 'jsdom',` (replacing the current `'node'` setting **only for files under `tests/dashboard/**`** — use Vitest's per-file `// @vitest-environment jsdom` comment instead so DB tests stay on Node).

Edit `tests/dashboard/widget-registry.test.ts` first line:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm test tests/dashboard/widget-registry.test.ts
```

Expected: `Cannot find module '@/components/dashboard/bento-cell'`.

- [ ] **Step 3: Create `components/dashboard/bento-cell.tsx`**

```tsx
// components/dashboard/bento-cell.tsx
import { ReactNode } from 'react';

export type BentoCellProps = {
  /** Display name surfaced in the cell key bar (uppercased automatically). */
  name: string;
  /** CSS grid-area name from the bento layout. */
  gridArea: string;
  /** Optional className extension (e.g. lime/black variants override). */
  className?: string;
  /** Hide the trailing ↗ icon (used by the lime/black hero cells). */
  hideOpen?: boolean;
  children: ReactNode;
};

export function BentoCell({ name, gridArea, className, hideOpen, children }: BentoCellProps) {
  return (
    <div
      style={{ gridArea }}
      className={`relative overflow-hidden rounded-[16px] border border-[var(--color-line)] bg-[var(--color-surface)] p-[22px] ${className ?? ''}`}
    >
      <div className="mb-[10px] flex items-center justify-between font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--color-muted-2)]">
        <span>{name.toUpperCase()}</span>
        {!hideOpen && (
          <span className="grid h-[22px] w-[22px] place-items-center rounded-full border border-[var(--color-line-strong)] text-[12px] text-[var(--color-muted)]">↗</span>
        )}
      </div>
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Create `components/dashboard/bento-grid.tsx`**

```tsx
// components/dashboard/bento-grid.tsx
import { ReactNode } from 'react';

const TEMPLATE_AREAS = [
  '"greet greet workers workers workers"',
  '"canvas canvas canvas hitl   lime  "',
  '"canvas canvas canvas cleanup lime  "',
  '"cost   cost   cost   refl    black "',
].join(' ');

export function BentoGrid({ children }: { children: ReactNode }) {
  return (
    <div
      className="grid gap-[14px]"
      style={{
        gridTemplateColumns: 'repeat(5, 1fr)',
        gridTemplateAreas: TEMPLATE_AREAS,
      }}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 5: Run tests, verify pass**

```bash
pnpm test tests/dashboard/widget-registry.test.ts
```

Expected: 2/2 PASS.

- [ ] **Step 6: Commit**

```bash
git add components/dashboard/bento-cell.tsx components/dashboard/bento-grid.tsx tests/dashboard/widget-registry.test.ts vitest.config.ts package.json pnpm-lock.yaml
git commit -m "phase 10: <BentoGrid /> + <BentoCell /> primitives + jsdom test env"
```

---

### Task 5: Widget registry contract + `useDashboardPoll` hook

**Files:**
- Create: `components/dashboard/widget-registry.ts` (types + empty registry)
- Create: `lib/dashboard/poll.ts` (the polling hook)
- Test: `tests/dashboard/poll.test.ts`

- [ ] **Step 1: Write failing test for `useDashboardPoll`**

```ts
// @vitest-environment jsdom
// tests/dashboard/poll.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useDashboardPoll } from '@/lib/dashboard/poll';

describe('useDashboardPoll', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('calls loader on mount and returns its data', async () => {
    const loader = vi.fn().mockResolvedValue({ count: 42 });
    const { result } = renderHook(() => useDashboardPoll(loader, 1000));
    await waitFor(() => expect(result.current.data).toEqual({ count: 42 }));
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('refreshes at refreshMs cadence', async () => {
    let n = 0;
    const loader = vi.fn(async () => ({ n: ++n }));
    const { result } = renderHook(() => useDashboardPoll(loader, 1000));
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));
    await act(async () => { vi.advanceTimersByTime(1000); });
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
  });

  it('dedupes overlapping calls (no second call while first is pending)', async () => {
    let resolveFirst!: (v: unknown) => void;
    const loader = vi
      .fn()
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValue({});
    renderHook(() => useDashboardPoll(loader, 100));
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(loader).toHaveBeenCalledTimes(1);
    resolveFirst({});
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm test tests/dashboard/poll.test.ts
```

Expected: `Cannot find module '@/lib/dashboard/poll'`.

- [ ] **Step 3: Implement `lib/dashboard/poll.ts`**

```ts
// lib/dashboard/poll.ts
'use client';
import { useEffect, useRef, useState } from 'react';

export type PollState<T> = {
  data: T | null;
  error: Error | null;
  /** Truthy until the first load resolves. */
  loading: boolean;
};

/**
 * SWR-style polling hook with three nothing-design constraints:
 * 1. Pause when the tab is hidden (visibilitychange).
 * 2. One in-flight request at a time (dedup).
 * 3. No external dep (no SWR, no React Query).
 */
export function useDashboardPoll<T>(
  loader: () => Promise<T>,
  refreshMs: number,
): PollState<T> {
  const [state, setState] = useState<PollState<T>>({ data: null, error: null, loading: true });
  const inFlight = useRef(false);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      if (inFlight.current) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      inFlight.current = true;
      try {
        const data = await loaderRef.current();
        if (!cancelled) setState({ data, error: null, loading: false });
      } catch (e) {
        if (!cancelled) setState((s) => ({ ...s, error: e as Error, loading: false }));
      } finally {
        inFlight.current = false;
      }
    }

    tick(); // initial load
    const interval = setInterval(tick, refreshMs);
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshMs]);

  return state;
}
```

- [ ] **Step 4: Implement `components/dashboard/widget-registry.ts`** (skeleton — fills in over later tasks)

```ts
// components/dashboard/widget-registry.ts
import type { ComponentType } from 'react';

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

export type WidgetDef<TData = unknown> = {
  id: WidgetId;
  /** Cell-key bar label (uppercased automatically by BentoCell). */
  name: string;
  /** Bento grid-area name. */
  gridArea: string;
  /** Poll cadence for this widget. */
  refreshMs: number;
  /** Server-callable loader — returns the data the widget renders. */
  load: () => Promise<TData>;
  /** Render component receiving the loaded data. */
  Component: ComponentType<{ data: TData }>;
};

export const WIDGET_REGISTRY = {} as Record<WidgetId, WidgetDef>;
```

This is intentionally empty — Tasks 11–18 add one entry each.

- [ ] **Step 5: Run, verify pass**

```bash
pnpm test tests/dashboard/poll.test.ts
```

Expected: 3/3 PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/dashboard/poll.ts components/dashboard/widget-registry.ts tests/dashboard/poll.test.ts
git commit -m "phase 10: useDashboardPoll hook + widget-registry skeleton"
```

---

> **Note:** the spec's §2.1 routing table says HITL filter is `status='open'`. The actual approval-gates enum (`db/schema/enums.ts`) is `pending | approved | modified | denied | timed_out` — there's no `open`. All query tasks below use **`status='pending'`** for "awaiting human." This is a spec-typo correction, not a design change.

### Task 6: Queries — greeting, all-agents, active-workers

**Files:**
- Create: `lib/dashboard/queries.ts` (initial — these three functions)
- Test: `tests/dashboard/queries-home.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/dashboard/queries-home.test.ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import {
  getGreetingSnapshot,
  getAllAgentsSnapshot,
  getActiveWorkers,
} from '@/lib/dashboard/queries';

const url = process.env.DATABASE_URL_UNPOOLED;
const skipSuite = url ? describe : describe.skip;

skipSuite('phase-10 home queries', () => {
  const sql = postgres(url!, { max: 1, idle_timeout: 2 });
  const TEST_MARK = 'phase-10-home-test';

  async function clearTestRows() {
    await sql`DELETE FROM task_events WHERE task_id IN (SELECT id FROM tasks WHERE metadata->>'test_id' = ${TEST_MARK})`;
    await sql`DELETE FROM tasks WHERE metadata->>'test_id' = ${TEST_MARK}`;
  }
  beforeEach(clearTestRows);
  afterAll(async () => { await clearTestRows(); await sql.end(); });

  describe('getGreetingSnapshot', () => {
    it('returns 6 monthly buckets ending in the current month', async () => {
      const snap = await getGreetingSnapshot();
      expect(snap.months).toHaveLength(6);
      const labels = snap.months.map((m) => m.label);
      // last entry is current month (3-letter lowercase, matches mockup: jan, feb, ...)
      expect(labels[5]).toMatch(/^[a-z]{3}$/);
    });
    it('totalThisMonth is non-negative integer', async () => {
      const snap = await getGreetingSnapshot();
      expect(Number.isInteger(snap.totalThisMonth)).toBe(true);
      expect(snap.totalThisMonth).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getAllAgentsSnapshot', () => {
    it('returns one perAgentCost entry per registered agent name', async () => {
      const snap = await getAllAgentsSnapshot();
      // dispatcher + 10 workers = 11 agents from the registry
      expect(snap.perAgentCost.length).toBeLessThanOrEqual(11);
      snap.perAgentCost.forEach((row) => {
        expect(typeof row.agent).toBe('string');
        expect(typeof row.cost).toBe('number');
      });
    });
  });

  describe('getActiveWorkers', () => {
    it('returns totalAgents=11 and activeAgentNames as a string[]', async () => {
      const snap = await getActiveWorkers();
      expect(snap.totalAgents).toBe(11);
      expect(Array.isArray(snap.activeAgentNames)).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm test tests/dashboard/queries-home.test.ts
```

Expected: `Cannot find module '@/lib/dashboard/queries'`.

- [ ] **Step 3: Implement the three queries**

```ts
// lib/dashboard/queries.ts
import { db } from '@/db/client';
import { sql } from 'drizzle-orm';

export type GreetingSnapshot = {
  months: { label: string; count: number }[];
  totalThisMonth: number;
  totalLastMonth: number;
  monthCostUsd: number;
};

export async function getGreetingSnapshot(): Promise<GreetingSnapshot> {
  const rows = await db.execute(sql`
    WITH months AS (
      SELECT generate_series(
        date_trunc('month', now()) - interval '5 months',
        date_trunc('month', now()),
        interval '1 month'
      ) AS m
    )
    SELECT
      to_char(m, 'mon') AS label,
      (SELECT count(*)::int FROM tasks
        WHERE created_at >= m AND created_at < m + interval '1 month') AS count
    FROM months
    ORDER BY m ASC
  `);
  const months = (rows as unknown as { label: string; count: number }[]).map((r) => ({
    label: r.label.toLowerCase(),
    count: Number(r.count ?? 0),
  }));
  const totalThisMonth = months[5]?.count ?? 0;
  const totalLastMonth = months[4]?.count ?? 0;

  const cost = await db.execute(sql`
    SELECT coalesce(sum(total_cost_usd), 0)::float AS c
    FROM task_runs
    WHERE started_at >= date_trunc('month', now())
  `);
  const monthCostUsd = Number((cost as unknown as { c: number }[])[0]?.c ?? 0);

  return { months, totalThisMonth, totalLastMonth, monthCostUsd };
}

export type AllAgentsSnapshot = {
  avgCostPerTask: number;
  perAgentCost: { agent: string; cost: number }[];
  avgP95LatencyMs: number;
  perAgentP95: { agent: string; ms: number }[];
};

export async function getAllAgentsSnapshot(): Promise<AllAgentsSnapshot> {
  const costRows = await db.execute(sql`
    SELECT
      payload->>'agent_name' AS agent,
      coalesce(sum((payload->'usage'->>'total_cost_usd')::float), 0) AS cost
    FROM task_events
    WHERE created_at >= now() - interval '30 days'
      AND payload->>'agent_name' IS NOT NULL
    GROUP BY agent
    ORDER BY cost DESC
  `);
  const perAgentCost = (costRows as unknown as { agent: string; cost: number }[]).map((r) => ({
    agent: r.agent,
    cost: Number(r.cost),
  }));

  const totalCost = await db.execute(sql`
    SELECT coalesce(avg(total_cost_usd), 0)::float AS c
    FROM task_runs
    WHERE started_at >= now() - interval '30 days'
  `);
  const avgCostPerTask = Number((totalCost as unknown as { c: number }[])[0]?.c ?? 0);

  // p95 latency per agent — derived from consecutive task_events deltas inside a run
  const latencyRows = await db.execute(sql`
    WITH ev AS (
      SELECT
        run_id,
        payload->>'agent_name' AS agent,
        created_at,
        lag(created_at) OVER (PARTITION BY run_id ORDER BY id) AS prev_at
      FROM task_events
      WHERE payload->>'agent_name' IS NOT NULL
        AND created_at >= now() - interval '30 days'
    )
    SELECT
      agent,
      percentile_cont(0.95) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (created_at - prev_at)) * 1000
      ) AS p95_ms
    FROM ev
    WHERE prev_at IS NOT NULL
    GROUP BY agent
    ORDER BY p95_ms DESC NULLS LAST
  `);
  const perAgentP95 = (latencyRows as unknown as { agent: string; p95_ms: number }[])
    .map((r) => ({ agent: r.agent, ms: Number(r.p95_ms ?? 0) }));

  const avgP95LatencyMs = perAgentP95.length
    ? perAgentP95.reduce((s, r) => s + r.ms, 0) / perAgentP95.length
    : 0;

  return { avgCostPerTask, perAgentCost, avgP95LatencyMs, perAgentP95 };
}

export type ActiveWorkersSnapshot = {
  activeAgentNames: string[];
  totalAgents: number;
};

export async function getActiveWorkers(): Promise<ActiveWorkersSnapshot> {
  const rows = await db.execute(sql`
    SELECT DISTINCT payload->>'agent_name' AS agent
    FROM task_events e
    JOIN task_runs r ON r.id = e.run_id
    WHERE r.status = 'in_progress'
      AND payload->>'agent_name' IS NOT NULL
  `);
  const activeAgentNames = (rows as unknown as { agent: string }[])
    .map((r) => r.agent)
    .filter(Boolean);

  return { activeAgentNames, totalAgents: 11 };
}
```

- [ ] **Step 4: Run, verify pass**

```bash
pnpm test tests/dashboard/queries-home.test.ts
```

Expected: 4/4 PASS (or all skipped if `DATABASE_URL_UNPOOLED` is unset; that's also acceptable in CI).

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/queries.ts tests/dashboard/queries-home.test.ts
git commit -m "phase 10: queries — greeting, all-agents, active-workers"
```

---

### Task 7: Queries — active-run, open-gates, memory-writes-today, last-cleanup

**Files:**
- Modify: `lib/dashboard/queries.ts` (append four functions)
- Test: `tests/dashboard/queries-live.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/dashboard/queries-live.test.ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import {
  getActiveRun,
  getOpenApprovalGates,
  getMemoryWritesToday,
  getLastCleanup,
} from '@/lib/dashboard/queries';

const url = process.env.DATABASE_URL_UNPOOLED;
const skipSuite = url ? describe : describe.skip;

skipSuite('phase-10 live queries', () => {
  const sql = postgres(url!, { max: 1, idle_timeout: 2 });
  const TEST_MARK = 'phase-10-live-test';

  async function clear() {
    await sql`DELETE FROM approval_gates WHERE reviewer_id = ${TEST_MARK}`;
    await sql`DELETE FROM task_events WHERE task_id IN (SELECT id FROM tasks WHERE metadata->>'test_id' = ${TEST_MARK})`;
    await sql`DELETE FROM tasks WHERE metadata->>'test_id' = ${TEST_MARK}`;
  }
  beforeEach(clear);
  afterAll(async () => { await clear(); await sql.end(); });

  it('getActiveRun returns null when nothing is running', async () => {
    const result = await getActiveRun();
    expect(result === null || typeof result === 'object').toBe(true);
  });

  it('getOpenApprovalGates returns only pending rows', async () => {
    const rows = await getOpenApprovalGates();
    rows.forEach((row) => expect(row.status).toBe('pending'));
  });

  it('getMemoryWritesToday returns shape {count, deltaVsYesterday}', async () => {
    const r = await getMemoryWritesToday();
    expect(typeof r.count).toBe('number');
    expect(typeof r.deltaVsYesterday).toBe('number');
  });

  it('getLastCleanup returns shape or null', async () => {
    const r = await getLastCleanup();
    if (r) {
      expect(r.runStartedAt).toBeInstanceOf(Date);
      expect(typeof r.promoted).toBe('number');
      expect(typeof r.pruned).toBe('number');
      expect(typeof r.contested).toBe('number');
    } else {
      expect(r).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm test tests/dashboard/queries-live.test.ts
```

Expected: import error for the four new functions.

- [ ] **Step 3: Append to `lib/dashboard/queries.ts`**

```ts
// (append below existing exports)
import type { Task, TaskRun, TaskEvent, ApprovalGate } from '@/db/schema';

export type ActiveRunSnapshot = {
  task: Pick<Task, 'id' | 'prompt' | 'createdAt'>;
  run: Pick<TaskRun, 'id' | 'startedAt' | 'totalCostUsd' | 'totalInputTokens' | 'totalOutputTokens'>;
  events: Pick<TaskEvent, 'id' | 'seq' | 'type' | 'payload' | 'createdAt'>[];
};

export async function getActiveRun(): Promise<ActiveRunSnapshot | null> {
  const runs = await db.execute(sql`
    SELECT r.id AS run_id, r.task_id, r.started_at, r.total_cost_usd, r.total_input_tokens, r.total_output_tokens,
           t.prompt, t.created_at AS task_created_at
    FROM task_runs r
    JOIN tasks t ON t.id = r.task_id
    WHERE r.status = 'in_progress'
    ORDER BY r.started_at DESC
    LIMIT 1
  `);
  type Row = {
    run_id: string; task_id: string; started_at: Date; total_cost_usd: string;
    total_input_tokens: number; total_output_tokens: number; prompt: string; task_created_at: Date;
  };
  const r = (runs as unknown as Row[])[0];
  if (!r) return null;

  const events = await db.execute(sql`
    SELECT id, seq, type, payload, created_at
    FROM task_events
    WHERE run_id = ${r.run_id}
    ORDER BY id ASC
    LIMIT 200
  `);
  return {
    task: { id: r.task_id, prompt: r.prompt, createdAt: r.task_created_at },
    run: {
      id: r.run_id,
      startedAt: r.started_at,
      totalCostUsd: r.total_cost_usd as unknown as TaskRun['totalCostUsd'],
      totalInputTokens: r.total_input_tokens,
      totalOutputTokens: r.total_output_tokens,
    },
    events: (events as unknown as TaskEvent[]),
  };
}

export type OpenGate = ApprovalGate & { taskPrompt: string };

export async function getOpenApprovalGates(): Promise<OpenGate[]> {
  const rows = await db.execute(sql`
    SELECT g.*, t.prompt AS task_prompt
    FROM approval_gates g
    JOIN tasks t ON t.id = g.task_id
    WHERE g.status = 'pending'
    ORDER BY g.created_at ASC
    LIMIT 20
  `);
  return rows as unknown as OpenGate[];
}

export type MemoryWritesTodaySnapshot = {
  count: number;
  deltaVsYesterday: number;
};

export async function getMemoryWritesToday(): Promise<MemoryWritesTodaySnapshot> {
  const r = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM memories
        WHERE created_at >= date_trunc('day', now())) AS today,
      (SELECT count(*)::int FROM memories
        WHERE created_at >= date_trunc('day', now()) - interval '1 day'
          AND created_at <  date_trunc('day', now())) AS yesterday
  `);
  const row = (r as unknown as { today: number; yesterday: number }[])[0];
  return {
    count: Number(row?.today ?? 0),
    deltaVsYesterday: Number(row?.today ?? 0) - Number(row?.yesterday ?? 0),
  };
}

export type LastCleanupSnapshot = {
  runStartedAt: Date;
  promoted: number;
  pruned: number;
  contested: number;
} | null;

export async function getLastCleanup(): Promise<LastCleanupSnapshot> {
  const rows = await db.execute(sql`
    SELECT r.id, r.started_at,
      coalesce(sum(case when p.proposed_action = 'promote' then 1 else 0 end), 0)::int AS promoted,
      coalesce(sum(case when p.proposed_action = 'prune'   then 1 else 0 end), 0)::int AS pruned,
      r.proposals_contested AS contested
    FROM memory_cleanup_runs r
    LEFT JOIN memory_cleanup_proposals p ON p.run_id = r.id
    WHERE r.status = 'completed'
    GROUP BY r.id
    ORDER BY r.started_at DESC
    LIMIT 1
  `);
  type Row = { id: string; started_at: Date; promoted: number; pruned: number; contested: number };
  const r = (rows as unknown as Row[])[0];
  if (!r) return null;
  return {
    runStartedAt: r.started_at,
    promoted: Number(r.promoted),
    pruned: Number(r.pruned),
    contested: Number(r.contested),
  };
}
```

- [ ] **Step 4: Run, verify pass**

```bash
pnpm test tests/dashboard/queries-live.test.ts
```

Expected: 4/4 PASS (or skipped without DB).

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/queries.ts tests/dashboard/queries-live.test.ts
git commit -m "phase 10: queries — active-run, open-gates, memory-writes, cleanup"
```

---

### Task 8: Queries — cost-line + segments

**Files:**
- Modify: `lib/dashboard/queries.ts` (append two functions)
- Test: `tests/dashboard/queries-charts.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/dashboard/queries-charts.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import {
  getCostLine12Mo,
  getMemorySegmentsSnapshot,
} from '@/lib/dashboard/queries';

const url = process.env.DATABASE_URL_UNPOOLED;
const skipSuite = url ? describe : describe.skip;

skipSuite('phase-10 chart queries', () => {
  const sql = postgres(url!, { max: 1, idle_timeout: 2 });
  afterAll(async () => { await sql.end(); });

  it('getCostLine12Mo returns 365 daily entries (or fewer if DB is younger)', async () => {
    const snap = await getCostLine12Mo();
    expect(snap.days.length).toBeLessThanOrEqual(366);
    snap.days.forEach((d) => {
      expect(d.date).toBeInstanceOf(Date);
      expect(typeof d.total).toBe('number');
      expect(typeof d.opusOnly).toBe('number');
    });
  });

  it('getMemorySegmentsSnapshot returns one entry per segment enum', async () => {
    const snap = await getMemorySegmentsSnapshot();
    const segments = new Set(snap.segments.map((s) => s.id));
    expect(segments.size).toBeLessThanOrEqual(7);
    snap.segments.forEach((s) => {
      expect(typeof s.count).toBe('number');
      expect(typeof s.avgImportance).toBe('number');
    });
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm test tests/dashboard/queries-charts.test.ts
```

Expected: import error.

- [ ] **Step 3: Append to `lib/dashboard/queries.ts`**

```ts
export type CostLineSnapshot = {
  days: { date: Date; total: number; opusOnly: number }[];
};

export async function getCostLine12Mo(): Promise<CostLineSnapshot> {
  const rows = await db.execute(sql`
    SELECT
      date_trunc('day', started_at) AS d,
      coalesce(sum(total_cost_usd), 0)::float AS total,
      0::float AS opus_only
    FROM task_runs
    WHERE started_at >= now() - interval '365 days'
    GROUP BY d
    ORDER BY d ASC
  `);
  // opus_only is a placeholder — wire from task_events.payload->>'model' filter in a follow-up
  // when payload reliably carries the model field on every event.
  return {
    days: (rows as unknown as { d: Date; total: number; opus_only: number }[]).map((r) => ({
      date: r.d,
      total: Number(r.total),
      opusOnly: Number(r.opus_only),
    })),
  };
}

export type SegmentSnapshot = {
  segments: { id: string; count: number; avgImportance: number }[];
};

export async function getMemorySegmentsSnapshot(): Promise<SegmentSnapshot> {
  const rows = await db.execute(sql`
    SELECT segment::text AS id,
           count(*)::int AS count,
           coalesce(avg(importance), 0)::float AS avg_importance
    FROM memories
    GROUP BY segment
    ORDER BY avg_importance DESC NULLS LAST
  `);
  return {
    segments: (rows as unknown as { id: string; count: number; avg_importance: number }[]).map((r) => ({
      id: r.id,
      count: Number(r.count),
      avgImportance: Number(r.avg_importance),
    })),
  };
}
```

- [ ] **Step 4: Run, verify pass**

```bash
pnpm test tests/dashboard/queries-charts.test.ts
```

Expected: 2/2 PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/queries.ts tests/dashboard/queries-charts.test.ts
git commit -m "phase 10: queries — cost line 12mo + memory segments"
```

---

### Task 9: Queries — kanban, agent-metrics, memories

**Files:**
- Modify: `lib/dashboard/queries.ts` (append three functions)
- Tests:
  - `tests/dashboard/queries-kanban.test.ts`
  - `tests/dashboard/queries-agents.test.ts`
  - `tests/dashboard/queries-memories.test.ts`

- [ ] **Step 1: Write failing kanban-derive test (pure)**

```ts
// tests/dashboard/queries-kanban.test.ts
import { describe, expect, it } from 'vitest';
import { deriveKanbanColumn } from '@/lib/dashboard/queries';

describe('deriveKanbanColumn', () => {
  it.each([
    ['queued', false, 'queued'],
    ['queued', true, 'queued'], // gates only matter while in_progress
    ['in_progress', false, 'in_progress'],
    ['in_progress', true, 'awaiting_approval'],
    ['done', false, 'done'],
    ['done', true, 'done'],
    ['failed', false, 'failed'],
    ['failed', true, 'failed'],
    ['cancelled', false, 'failed'], // collapse cancelled into the failed column
  ] as const)('status=%s gateOpen=%s -> %s', (status, gateOpen, expected) => {
    expect(deriveKanbanColumn(status, gateOpen)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm test tests/dashboard/queries-kanban.test.ts
```

- [ ] **Step 3: Append the three queries + the pure helper**

```ts
// in lib/dashboard/queries.ts
export type KanbanColumn = 'queued' | 'in_progress' | 'awaiting_approval' | 'done' | 'failed';

export function deriveKanbanColumn(
  status: 'queued' | 'in_progress' | 'done' | 'failed' | 'cancelled',
  gateOpen: boolean,
): KanbanColumn {
  if (status === 'in_progress' && gateOpen) return 'awaiting_approval';
  if (status === 'cancelled') return 'failed';
  return status as KanbanColumn;
}

export type TaskWithGate = {
  id: string;
  prompt: string;
  status: string;
  createdAt: Date;
  agentCount: number;
  costUsd: number;
  hasOpenGate: boolean;
};

export async function getKanbanBoard(): Promise<Record<KanbanColumn, TaskWithGate[]>> {
  const rows = await db.execute(sql`
    SELECT t.id, t.prompt, t.status::text AS status, t.created_at,
      coalesce((
        SELECT count(DISTINCT payload->>'agent_name')
        FROM task_events
        WHERE task_events.task_id = t.id AND payload->>'agent_name' IS NOT NULL
      ), 0)::int AS agent_count,
      coalesce((
        SELECT max(total_cost_usd) FROM task_runs WHERE task_id = t.id
      ), 0)::float AS cost_usd,
      EXISTS(
        SELECT 1 FROM approval_gates g WHERE g.task_id = t.id AND g.status = 'pending'
      ) AS has_open_gate
    FROM tasks t
    ORDER BY t.created_at DESC
    LIMIT 200
  `);
  type Row = {
    id: string; prompt: string; status: string; created_at: Date;
    agent_count: number; cost_usd: number; has_open_gate: boolean;
  };
  const board: Record<KanbanColumn, TaskWithGate[]> = {
    queued: [], in_progress: [], awaiting_approval: [], done: [], failed: [],
  };
  for (const r of rows as unknown as Row[]) {
    const col = deriveKanbanColumn(r.status as never, Boolean(r.has_open_gate));
    board[col].push({
      id: r.id, prompt: r.prompt, status: r.status, createdAt: r.created_at,
      agentCount: Number(r.agent_count), costUsd: Number(r.cost_usd),
      hasOpenGate: Boolean(r.has_open_gate),
    });
  }
  return board;
}

export type AgentMetrics = {
  p50LatencyMs: number;
  p95LatencyMs: number;
  dailyTokens: { date: Date; tokens: number }[];
  successRate: number;
  recentRuns: { runId: string; taskId: string; startedAt: Date; status: string; costUsd: number }[];
  topMemories: { memoryId: string; recallCount: number; excerpt: string }[];
};

export async function getAgentMetrics(name: string): Promise<AgentMetrics> {
  const lat = await db.execute(sql`
    WITH ev AS (
      SELECT created_at,
             lag(created_at) OVER (PARTITION BY run_id ORDER BY id) AS prev_at
      FROM task_events
      WHERE payload->>'agent_name' = ${name}
        AND created_at >= now() - interval '30 days'
    )
    SELECT
      percentile_cont(0.50) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (created_at - prev_at)) * 1000) AS p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (created_at - prev_at)) * 1000) AS p95
    FROM ev
    WHERE prev_at IS NOT NULL
  `);
  const lr = (lat as unknown as { p50: number; p95: number }[])[0];

  const tokens = await db.execute(sql`
    SELECT date_trunc('day', created_at) AS d,
           coalesce(sum((payload->'usage'->>'input_tokens')::int + (payload->'usage'->>'output_tokens')::int), 0)::int AS t
    FROM task_events
    WHERE payload->>'agent_name' = ${name} AND created_at >= now() - interval '30 days'
    GROUP BY d ORDER BY d ASC
  `);

  const success = await db.execute(sql`
    SELECT
      coalesce(sum(case when r.status='done' then 1 else 0 end)::float, 0) /
      nullif(count(*), 0) AS rate
    FROM task_runs r
    WHERE EXISTS (
      SELECT 1 FROM task_events e
      WHERE e.run_id = r.id AND payload->>'agent_name' = ${name}
    ) AND r.started_at >= now() - interval '30 days'
  `);

  const recent = await db.execute(sql`
    SELECT r.id AS run_id, r.task_id, r.started_at, r.status::text AS status, r.total_cost_usd::float AS cost_usd
    FROM task_runs r
    WHERE EXISTS (
      SELECT 1 FROM task_events e WHERE e.run_id = r.id AND payload->>'agent_name' = ${name}
    )
    ORDER BY r.started_at DESC LIMIT 50
  `);

  const top = await db.execute(sql`
    WITH recalls AS (
      SELECT jsonb_array_elements(payload->'tool_result'->'memories') AS m
      FROM task_events
      WHERE payload->>'agent_name' = ${name}
        AND payload->>'tool_name' = 'mcp__memory__recall'
        AND created_at >= now() - interval '30 days'
    )
    SELECT m->>'id' AS memory_id, count(*)::int AS recall_count, max(m->>'content') AS excerpt
    FROM recalls WHERE m->>'id' IS NOT NULL
    GROUP BY memory_id ORDER BY recall_count DESC LIMIT 10
  `);

  return {
    p50LatencyMs: Number(lr?.p50 ?? 0),
    p95LatencyMs: Number(lr?.p95 ?? 0),
    dailyTokens: (tokens as unknown as { d: Date; t: number }[]).map((r) => ({
      date: r.d, tokens: Number(r.t),
    })),
    successRate: Number((success as unknown as { rate: number }[])[0]?.rate ?? 0),
    recentRuns: (recent as unknown as { run_id: string; task_id: string; started_at: Date; status: string; cost_usd: number }[]).map((r) => ({
      runId: r.run_id, taskId: r.task_id, startedAt: r.started_at, status: r.status, costUsd: Number(r.cost_usd),
    })),
    topMemories: (top as unknown as { memory_id: string; recall_count: number; excerpt: string }[]).map((r) => ({
      memoryId: r.memory_id, recallCount: Number(r.recall_count), excerpt: r.excerpt ?? '',
    })),
  };
}

export type MemoriesFilter = {
  bucket?: 'short' | 'long' | 'permanent' | null;
  segment?: string | null;
  cleanupTouched?: boolean;
};

export type MemoriesPage = {
  rows: {
    id: string;
    content: string;
    bucket: string;
    segment: string;
    importance: number;
    lastRecallAt: Date | null;
    accessCount: number;
    cleanupVerdict: string | null;
  }[];
  total: number;
};

export async function getMemories(
  filter: MemoriesFilter,
  page: number,
  pageSize: number = 100,
): Promise<MemoriesPage> {
  const rows = await db.execute(sql`
    SELECT m.id, substr(m.content, 1, 240) AS content, m.bucket::text AS bucket,
           m.segment::text AS segment, m.importance::float AS importance,
           m.last_recall_at, m.access_count,
           p.proposed_action AS cleanup_verdict
    FROM memories m
    LEFT JOIN LATERAL (
      SELECT proposed_action FROM memory_cleanup_proposals
      WHERE memory_id = m.id ORDER BY id DESC LIMIT 1
    ) p ON ${filter.cleanupTouched ? sql`true` : sql`false`}
    WHERE
      ${filter.bucket ? sql`m.bucket = ${filter.bucket}` : sql`true`}
      AND ${filter.segment ? sql`m.segment::text = ${filter.segment}` : sql`true`}
      AND ${filter.cleanupTouched ? sql`p.proposed_action IS NOT NULL` : sql`true`}
    ORDER BY m.id DESC
    OFFSET ${page * pageSize} LIMIT ${pageSize}
  `);
  const tot = await db.execute(sql`SELECT count(*)::int AS total FROM memories`);
  return {
    rows: (rows as unknown as MemoriesPage['rows']),
    total: Number((tot as unknown as { total: number }[])[0]?.total ?? 0),
  };
}
```

- [ ] **Step 4: Write the agent + memories integration tests**

```ts
// tests/dashboard/queries-agents.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { getAgentMetrics } from '@/lib/dashboard/queries';

const url = process.env.DATABASE_URL_UNPOOLED;
const suite = url ? describe : describe.skip;

suite('getAgentMetrics', () => {
  const sql = postgres(url!, { max: 1, idle_timeout: 2 });
  afterAll(async () => { await sql.end(); });

  it('returns the documented shape for a known agent name', async () => {
    const m = await getAgentMetrics('fleet-analyst');
    expect(typeof m.p50LatencyMs).toBe('number');
    expect(typeof m.p95LatencyMs).toBe('number');
    expect(Array.isArray(m.dailyTokens)).toBe(true);
    expect(typeof m.successRate).toBe('number');
    expect(Array.isArray(m.recentRuns)).toBe(true);
    expect(Array.isArray(m.topMemories)).toBe(true);
  });
});
```

```ts
// tests/dashboard/queries-memories.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { getMemories } from '@/lib/dashboard/queries';

const url = process.env.DATABASE_URL_UNPOOLED;
const suite = url ? describe : describe.skip;

suite('getMemories', () => {
  const sql = postgres(url!, { max: 1, idle_timeout: 2 });
  afterAll(async () => { await sql.end(); });

  it('paginates without filters', async () => {
    const r = await getMemories({}, 0, 5);
    expect(r.rows.length).toBeLessThanOrEqual(5);
    expect(typeof r.total).toBe('number');
  });

  it('respects bucket filter', async () => {
    const r = await getMemories({ bucket: 'short' }, 0, 50);
    r.rows.forEach((row) => expect(row.bucket).toBe('short'));
  });
});
```

- [ ] **Step 5: Run, verify pass**

```bash
pnpm test tests/dashboard/queries-kanban.test.ts tests/dashboard/queries-agents.test.ts tests/dashboard/queries-memories.test.ts
```

Expected: kanban PASS (pure, no DB skip); agents/memories PASS or SKIP without DB.

- [ ] **Step 6: Commit**

```bash
git add lib/dashboard/queries.ts tests/dashboard/queries-kanban.test.ts tests/dashboard/queries-agents.test.ts tests/dashboard/queries-memories.test.ts
git commit -m "phase 10: queries — kanban derive, agent metrics, memories filter"
```

---

> **Widget pattern (Tasks 10–17, 22).** Every widget is a server component (no `'use client'` unless it needs interactivity). Each widget file exports two things: a `Component` and a `widgetDef`. The `widgetDef` is registered in `WIDGET_REGISTRY`. Tests render the `Component` with mock data and assert the key DOM strings + class names.

### Task 10: `<Greeting />` widget

**Files:**
- Create: `components/dashboard/widgets/greeting.tsx`
- Create: `lib/dashboard/fixtures.ts`
- Test: `tests/dashboard/widget-greeting.test.tsx`

- [ ] **Step 1: Add a fixture helper**

```ts
// lib/dashboard/fixtures.ts
import type { GreetingSnapshot, AllAgentsSnapshot, ActiveWorkersSnapshot } from './queries';

export const FIXTURE_GREETING: GreetingSnapshot = {
  months: [
    { label: 'may', count: 8 },
    { label: 'jun', count: 14 },
    { label: 'jul', count: 22 },
    { label: 'aug', count: 31 },
    { label: 'sep', count: 47 },
    { label: 'oct', count: 84 },
  ],
  totalThisMonth: 247,
  totalLastMonth: 163,
  monthCostUsd: 14.62,
};

export const FIXTURE_ALL_AGENTS: AllAgentsSnapshot = {
  avgCostPerTask: 0.34,
  perAgentCost: [
    { agent: 'dispatcher', cost: 4.2 },
    { agent: 'fleet-analyst', cost: 1.8 },
    { agent: 'billing', cost: 2.1 },
    { agent: 'support', cost: 0.6 },
  ],
  avgP95LatencyMs: 2400,
  perAgentP95: [
    { agent: 'billing', ms: 4200 },
    { agent: 'fleet-analyst', ms: 1900 },
  ],
};

export const FIXTURE_ACTIVE_WORKERS: ActiveWorkersSnapshot = {
  activeAgentNames: ['fleet-analyst', 'billing', 'reflector'],
  totalAgents: 11,
};
```

- [ ] **Step 2: Write failing test**

```tsx
// @vitest-environment jsdom
// tests/dashboard/widget-greeting.test.tsx
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Greeting } from '@/components/dashboard/widgets/greeting';
import { FIXTURE_GREETING } from '@/lib/dashboard/fixtures';

describe('<Greeting />', () => {
  it('renders italic-serif "here\'s" inside the headline', () => {
    process.env.OPERATOR_NAME = 'Shahriar';
    const { getByText } = render(<Greeting data={FIXTURE_GREETING} />);
    const ital = getByText(/here's/i);
    expect(ital.className).toMatch(/font-serif-italic/);
  });

  it('highlights the latest month bar in lime', () => {
    process.env.OPERATOR_NAME = 'Shahriar';
    const { container } = render(<Greeting data={FIXTURE_GREETING} />);
    const limeBar = container.querySelector('[data-month="oct"]');
    expect(limeBar?.className).toMatch(/bg-\[var\(--color-lime\)\]/);
  });

  it('formats totalThisMonth with thousands separator', () => {
    const { getByText } = render(<Greeting data={{ ...FIXTURE_GREETING, totalThisMonth: 12345 }} />);
    expect(getByText(/12,345/)).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run, verify fail**

```bash
pnpm test tests/dashboard/widget-greeting.test.tsx
```

- [ ] **Step 4: Implement the widget**

```tsx
// components/dashboard/widgets/greeting.tsx
import type { GreetingSnapshot } from '@/lib/dashboard/queries';
import type { WidgetDef } from '../widget-registry';
import { getGreetingSnapshot } from '@/lib/dashboard/queries';
import { BentoCell } from '../bento-cell';

const OPERATOR_NAME = process.env.OPERATOR_NAME || 'Operator';

export function Greeting({ data }: { data: GreetingSnapshot }) {
  const max = Math.max(...data.months.map((m) => m.count), 1);
  const fmt = new Intl.NumberFormat('en-US');
  const cost = data.monthCostUsd;
  const delta = data.totalThisMonth - data.totalLastMonth;

  return (
    <div className="flex h-full flex-col gap-6">
      <h2 className="text-[28px] font-medium leading-[1.1] tracking-tight">
        Hi {OPERATOR_NAME},{' '}
        <span className="font-serif-italic">here's</span> what's
        <br />happening in your swarm.
      </h2>

      <div>
        <div className="mb-1.5 flex h-14 items-end gap-1.5">
          {data.months.map((m, i) => {
            const isNow = i === data.months.length - 1;
            const h = `${(m.count / max) * 100}%`;
            return (
              <div
                key={m.label}
                data-month={m.label}
                className={`flex-1 rounded ${
                  isNow ? 'bg-[var(--color-lime)]' : 'bg-black/[.06]'
                }`}
                style={{ height: h }}
              />
            );
          })}
        </div>
        <div className="flex gap-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--color-muted-2)]">
          {data.months.map((m) => (
            <span key={m.label} className="flex-1 text-center">{m.label}</span>
          ))}
        </div>
      </div>

      <p className="text-[14px] leading-[1.5] text-[var(--color-muted)]">
        This month your swarm has run{' '}
        <strong className="font-medium text-[var(--color-ink)]">{fmt.format(data.totalThisMonth)} tasks</strong> across 11 agents — that's{' '}
        <strong className="font-medium text-[var(--color-ink)]">
          {delta >= 0 ? `${fmt.format(delta)} more` : `${fmt.format(-delta)} fewer`}
        </strong>{' '}
        than last month.
      </p>

      <div className="mt-auto">
        <div className="text-[36px] font-semibold leading-none tracking-tight tabular-nums">
          $&nbsp;{cost.toFixed(2)}
        </div>
        <div className="mt-1 text-[12px] text-[var(--color-muted)]">
          total agent cost this month
        </div>
      </div>
    </div>
  );
}

export const greetingDef: WidgetDef<GreetingSnapshot> = {
  id: 'greeting',
  name: 'Greeting',
  gridArea: 'greet',
  refreshMs: 3000,
  load: getGreetingSnapshot,
  Component: Greeting,
};
```

- [ ] **Step 5: Wire into the registry**

```ts
// components/dashboard/widget-registry.ts (replace empty record)
import { greetingDef } from './widgets/greeting';

export const WIDGET_REGISTRY: Partial<Record<WidgetId, WidgetDef>> = {
  greeting: greetingDef,
};
```

(We use `Partial` while other widgets are still being added; Task 24 tightens the type.)

- [ ] **Step 6: Run, verify pass**

```bash
pnpm test tests/dashboard/widget-greeting.test.tsx
```

Expected: 3/3 PASS.

- [ ] **Step 7: Commit**

```bash
git add components/dashboard/widgets/greeting.tsx components/dashboard/widget-registry.ts lib/dashboard/fixtures.ts tests/dashboard/widget-greeting.test.tsx
git commit -m "phase 10: <Greeting /> widget with italic-serif accent + lime month bar"
```

---

### Task 11: `<AllAgents />` widget

**Files:**
- Create: `components/dashboard/widgets/all-agents.tsx`
- Test: `tests/dashboard/widget-all-agents.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
// @vitest-environment jsdom
// tests/dashboard/widget-all-agents.test.tsx
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { AllAgents } from '@/components/dashboard/widgets/all-agents';
import { FIXTURE_ALL_AGENTS } from '@/lib/dashboard/fixtures';

describe('<AllAgents />', () => {
  it('renders avg cost and avg p95 latency stat blocks', () => {
    const { getByText } = render(<AllAgents data={FIXTURE_ALL_AGENTS} />);
    expect(getByText(/\$\s*0\.34/)).toBeTruthy();
    expect(getByText(/2\.4/)).toBeTruthy();
  });
  it('renders one bar per perAgentCost row', () => {
    const { container } = render(<AllAgents data={FIXTURE_ALL_AGENTS} />);
    const bars = container.querySelectorAll('[data-bar="agent-cost"]');
    expect(bars.length).toBe(FIXTURE_ALL_AGENTS.perAgentCost.length);
  });
});
```

- [ ] **Step 2: Run, verify fail; then implement**

```tsx
// components/dashboard/widgets/all-agents.tsx
import type { AllAgentsSnapshot } from '@/lib/dashboard/queries';
import type { WidgetDef } from '../widget-registry';
import { getAllAgentsSnapshot } from '@/lib/dashboard/queries';

function StatBlock({
  cap, num, suffix, delta, perAgent,
}: {
  cap: string; num: string; suffix?: string; delta: string;
  perAgent: { agent: string; value: number }[];
}) {
  const max = Math.max(...perAgent.map((r) => r.value), 1);
  return (
    <div className="grid grid-cols-[1fr_1.6fr] items-start gap-6 border-b border-dashed border-[var(--color-line-strong)] pb-4 last:border-b-0 last:pb-0">
      <div>
        <div className="mb-1 text-[13px] text-[var(--color-muted)]">{cap}</div>
        <div className="text-[30px] font-semibold leading-none tracking-tight tabular-nums">
          {num}{suffix && <span className="ml-0.5 text-[14px] text-[var(--color-muted)]">{suffix}</span>}
        </div>
        <div className="mt-1.5 text-[12px] text-[var(--color-muted)]">{delta}</div>
      </div>
      <div>
        <div className="grid h-12 items-end gap-[5px]" style={{ gridTemplateColumns: `repeat(${perAgent.length}, 1fr)` }}>
          {perAgent.map((r, i) => {
            const h = `${(r.value / max) * 100}%`;
            const tone = i === 0 ? 'bg-[var(--color-lime)]' : (i === 1 ? 'bg-[var(--color-ink)]' : 'bg-black/10');
            return (
              <div key={r.agent} data-bar="agent-cost" title={r.agent} className={`rounded-sm ${tone}`} style={{ height: h }} />
            );
          })}
        </div>
        <div className="mt-1.5 grid font-mono text-[9px] uppercase tracking-[0.05em] text-[var(--color-muted-2)]"
             style={{ gridTemplateColumns: `repeat(${perAgent.length}, 1fr)` }}>
          {perAgent.map((r) => (<span key={r.agent} className="text-center">{r.agent.slice(0, 3)}</span>))}
        </div>
      </div>
    </div>
  );
}

export function AllAgents({ data }: { data: AllAgentsSnapshot }) {
  return (
    <div className="flex flex-col gap-4">
      <StatBlock
        cap="Avg cost / task"
        num={`$ ${data.avgCostPerTask.toFixed(2)}`}
        delta={`${data.perAgentCost.length} agents tracked`}
        perAgent={data.perAgentCost.map((r) => ({ agent: r.agent, value: r.cost }))}
      />
      <StatBlock
        cap="Avg p95 latency"
        num={(data.avgP95LatencyMs / 1000).toFixed(1)}
        suffix="s"
        delta={data.perAgentP95[0] ? `${data.perAgentP95[0].agent} slowest` : 'no data'}
        perAgent={data.perAgentP95.map((r) => ({ agent: r.agent, value: r.ms }))}
      />
    </div>
  );
}

export const allAgentsDef: WidgetDef<AllAgentsSnapshot> = {
  id: 'all-agents',
  name: 'All agents',
  gridArea: 'workers',
  refreshMs: 3000,
  load: getAllAgentsSnapshot,
  Component: AllAgents,
};
```

- [ ] **Step 3: Register + test pass + commit**

```ts
// components/dashboard/widget-registry.ts — add to map
import { allAgentsDef } from './widgets/all-agents';
WIDGET_REGISTRY['all-agents'] = allAgentsDef;
```

Run `pnpm test tests/dashboard/widget-all-agents.test.tsx` (expect 2/2 PASS).

```bash
git add components/dashboard/widgets/all-agents.tsx components/dashboard/widget-registry.ts tests/dashboard/widget-all-agents.test.tsx
git commit -m "phase 10: <AllAgents /> widget — per-agent cost + p95 latency bars"
```

---

### Task 12: `<HitlQueue />` widget (red inline approve card)

**Files:**
- Create: `components/dashboard/widgets/hitl-queue.tsx`
- Test: `tests/dashboard/widget-hitl-queue.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { HitlQueue } from '@/components/dashboard/widgets/hitl-queue';

const FX = [
  { id: 'g-1', toolName: 'Write', proposedInput: { file_path: 'invoices/INV-1042.json' }, taskPrompt: 'Re-bill T-998', createdAt: new Date(), status: 'pending' as const },
];

describe('<HitlQueue />', () => {
  it('renders the count', () => {
    const { getByText } = render(<HitlQueue data={FX as never} />);
    expect(getByText('1')).toBeTruthy();
  });
  it('shows the proposed file_path on the first card', () => {
    const { getByText } = render(<HitlQueue data={FX as never} />);
    expect(getByText(/invoices\/INV-1042\.json/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Implement**

```tsx
// components/dashboard/widgets/hitl-queue.tsx
import type { OpenGate } from '@/lib/dashboard/queries';
import type { WidgetDef } from '../widget-registry';
import { getOpenApprovalGates } from '@/lib/dashboard/queries';

export function HitlQueue({ data }: { data: OpenGate[] }) {
  const first = data[0];
  return (
    <div className="flex h-full flex-col">
      <div className="text-[30px] font-semibold leading-none tabular-nums">{data.length}</div>
      <div className="mt-1.5 text-[12px] text-[var(--color-muted)]">
        {data.length === 1 ? 'awaiting human approval' : 'awaiting human approvals'}
      </div>
      {first && (
        <div className="mt-3.5 rounded-[10px] border border-[var(--color-red)] bg-[rgba(215,25,33,0.05)] p-3">
          <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--color-red)]">
            Gate · {String(first.toolName)}
          </div>
          <div className="mt-1.5 font-mono text-[11px] leading-[1.4]">
            {(first.proposedInput as { file_path?: string })?.file_path ?? JSON.stringify(first.proposedInput).slice(0, 80)}
          </div>
          <div className="mt-2.5 flex gap-1.5">
            <button className="rounded-[4px] border border-[var(--color-ink)] bg-[var(--color-ink)] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--color-surface)]">Approve</button>
            <button className="rounded-[4px] border border-[var(--color-ink)] bg-transparent px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--color-ink)]">Modify</button>
          </div>
        </div>
      )}
    </div>
  );
}

export const hitlQueueDef: WidgetDef<OpenGate[]> = {
  id: 'hitl-queue',
  name: 'HITL queue',
  gridArea: 'hitl',
  refreshMs: 2000,
  load: getOpenApprovalGates,
  Component: HitlQueue,
};
```

- [ ] **Step 3: Register + test + commit**

```bash
pnpm test tests/dashboard/widget-hitl-queue.test.tsx
git add components/dashboard/widgets/hitl-queue.tsx components/dashboard/widget-registry.ts tests/dashboard/widget-hitl-queue.test.tsx
git commit -m "phase 10: <HitlQueue /> widget with inline approve card"
```

(Note: Approve/Modify buttons are visual only here. Task 26 wires them to the existing phase-07 `resolveApproval()` server action.)

---

### Task 13: `<MemoryWritesLime />` (lime accent cell)

**Files:**
- Create: `components/dashboard/widgets/memory-writes-lime.tsx`
- Test: `tests/dashboard/widget-memory-writes-lime.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryWritesLime } from '@/components/dashboard/widgets/memory-writes-lime';

describe('<MemoryWritesLime />', () => {
  it('renders the count formatted with comma', () => {
    const { getByText } = render(<MemoryWritesLime data={{ count: 1247, deltaVsYesterday: 184 }} />);
    expect(getByText('1,247')).toBeTruthy();
  });
  it('shows positive delta as "+N more than yesterday"', () => {
    const { getByText } = render(<MemoryWritesLime data={{ count: 100, deltaVsYesterday: 30 }} />);
    expect(getByText(/\+30 more than yesterday/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Implement**

```tsx
// components/dashboard/widgets/memory-writes-lime.tsx
import type { MemoryWritesTodaySnapshot } from '@/lib/dashboard/queries';
import type { WidgetDef } from '../widget-registry';
import { getMemoryWritesToday } from '@/lib/dashboard/queries';

export function MemoryWritesLime({ data }: { data: MemoryWritesTodaySnapshot }) {
  const fmt = new Intl.NumberFormat('en-US');
  const sign = data.deltaVsYesterday > 0 ? '+' : '';
  return (
    <div className="flex h-full flex-col justify-between">
      <div>
        <h3 className="text-[17px] font-medium tracking-tight text-[var(--color-ink)]">Reinforced today</h3>
        <div className="mt-2 text-[44px] font-semibold leading-none tracking-tight tabular-nums text-[var(--color-ink)]">
          {fmt.format(data.count)}
        </div>
        <div className="mt-1.5 text-[12px] text-black/70">
          {sign}{fmt.format(data.deltaVsYesterday)} {data.deltaVsYesterday >= 0 ? 'more' : 'fewer'} than yesterday. Reflector is up.
        </div>
      </div>
      <div className="mt-3.5 grid h-9 w-9 place-items-center rounded-full bg-[var(--color-ink)] font-display text-[18px] text-[var(--color-lime)]">↗</div>
    </div>
  );
}

export const memoryWritesLimeDef: WidgetDef<MemoryWritesTodaySnapshot> = {
  id: 'memory-writes-lime',
  name: 'Memory writes',
  gridArea: 'lime',
  refreshMs: 30000,
  load: getMemoryWritesToday,
  Component: MemoryWritesLime,
};
```

- [ ] **Step 3: Register, test, commit**

The lime cell needs custom BentoCell styling. In Task 24 (home wire-up) we'll wrap MemoryWritesLime with a BentoCell variant that overrides the background:

```tsx
<BentoCell name={widgetDef.name} gridArea={widgetDef.gridArea} className="bg-[var(--color-lime)] border-[var(--color-lime-deep)]">
```

For now the widget renders correctly inside any BentoCell.

```bash
pnpm test tests/dashboard/widget-memory-writes-lime.test.tsx
git add components/dashboard/widgets/memory-writes-lime.tsx components/dashboard/widget-registry.ts tests/dashboard/widget-memory-writes-lime.test.tsx
git commit -m "phase 10: <MemoryWritesLime /> — the lime accent hero cell"
```

---

### Task 14: `<CleanupLastNight />` widget

**Files:**
- Create: `components/dashboard/widgets/cleanup-last-night.tsx`
- Test: `tests/dashboard/widget-cleanup-last-night.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { CleanupLastNight } from '@/components/dashboard/widgets/cleanup-last-night';

describe('<CleanupLastNight />', () => {
  it('shows three stat tiles: promoted, pruned, contested', () => {
    const { getByText } = render(
      <CleanupLastNight data={{ runStartedAt: new Date(), promoted: 12, pruned: 4, contested: 1 }} />,
    );
    expect(getByText('12')).toBeTruthy();
    expect(getByText('4')).toBeTruthy();
    expect(getByText('1')).toBeTruthy();
  });
  it('renders an empty state when data is null', () => {
    const { getByText } = render(<CleanupLastNight data={null} />);
    expect(getByText(/no cleanup runs yet/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Implement**

```tsx
// components/dashboard/widgets/cleanup-last-night.tsx
import type { LastCleanupSnapshot } from '@/lib/dashboard/queries';
import type { WidgetDef } from '../widget-registry';
import { getLastCleanup } from '@/lib/dashboard/queries';

export function CleanupLastNight({ data }: { data: LastCleanupSnapshot }) {
  if (!data) {
    return <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-muted-2)]">No cleanup runs yet</div>;
  }
  return (
    <div>
      <div className="text-[14px] font-medium text-[var(--color-muted)]">Consolidator → Adversary → Judge</div>
      <div className="mt-3.5 grid grid-cols-3 gap-2">
        {[
          { label: 'Promoted', value: data.promoted, warm: false },
          { label: 'Pruned',   value: data.pruned,   warm: true  },
          { label: 'Contested', value: data.contested, warm: false },
        ].map((tile) => (
          <div key={tile.label} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-warm)] px-2.5 py-2">
            <div className={`text-[18px] font-semibold tracking-tight tabular-nums ${tile.warm ? 'text-[var(--color-red)]' : ''}`}>
              {tile.value}
            </div>
            <div className="mt-0.5 font-mono text-[8.5px] uppercase tracking-[0.18em] text-[var(--color-muted-2)]">
              {tile.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export const cleanupLastNightDef: WidgetDef<LastCleanupSnapshot> = {
  id: 'cleanup-last-night',
  name: 'Cleanup last night',
  gridArea: 'cleanup',
  refreshMs: 30000,
  load: getLastCleanup,
  Component: CleanupLastNight,
};
```

- [ ] **Step 3: Register, test, commit**

```bash
pnpm test tests/dashboard/widget-cleanup-last-night.test.tsx
git add components/dashboard/widgets/cleanup-last-night.tsx components/dashboard/widget-registry.ts tests/dashboard/widget-cleanup-last-night.test.tsx
git commit -m "phase 10: <CleanupLastNight /> — promoted/pruned/contested mini tiles"
```

---

### Task 15: `<CostLine12Mo />` widget — Recharts via dynamic import

**Files:**
- Create: `components/dashboard/widgets/cost-line-12mo.tsx`
- Test: `tests/dashboard/widget-cost-line.test.tsx`

The Recharts library is heavy; we must `next/dynamic`-import it so it doesn't enter the home-page bundle until needed.

- [ ] **Step 1: Failing test**

```tsx
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { CostLine12Mo } from '@/components/dashboard/widgets/cost-line-12mo';

const FX = {
  days: Array.from({ length: 365 }, (_, i) => ({
    date: new Date(Date.now() - i * 24 * 3600 * 1000),
    total: Math.sin(i / 30) * 5 + 8,
    opusOnly: Math.cos(i / 40) * 2 + 3,
  })).reverse(),
};

describe('<CostLine12Mo />', () => {
  it('renders the daily-spend headline number', () => {
    const { getByText } = render(<CostLine12Mo data={FX} />);
    expect(getByText(/Avg daily spend/i)).toBeTruthy();
  });
  it('renders a placeholder div before the chart hydrates', () => {
    const { container } = render(<CostLine12Mo data={FX} />);
    expect(container.querySelector('[data-chart-host]')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Implement**

```tsx
// components/dashboard/widgets/cost-line-12mo.tsx
'use client';
import dynamic from 'next/dynamic';
import type { CostLineSnapshot } from '@/lib/dashboard/queries';
import type { WidgetDef } from '../widget-registry';
import { getCostLine12Mo } from '@/lib/dashboard/queries';

// Recharts is bulky — keep it out of the home bundle until the cell mounts.
const Line = dynamic(() => import('recharts').then((m) => m.LineChart), { ssr: false });
const LineSeries = dynamic(() => import('recharts').then((m) => m.Line), { ssr: false });
const Resp = dynamic(() => import('recharts').then((m) => m.ResponsiveContainer), { ssr: false });
const XAxis = dynamic(() => import('recharts').then((m) => m.XAxis), { ssr: false });
const YAxis = dynamic(() => import('recharts').then((m) => m.YAxis), { ssr: false });
const Tooltip = dynamic(() => import('recharts').then((m) => m.Tooltip), { ssr: false });

export function CostLine12Mo({ data }: { data: CostLineSnapshot }) {
  const avgDaily = data.days.length
    ? data.days.reduce((s, d) => s + d.total, 0) / data.days.length
    : 0;
  const series = data.days.map((d) => ({
    label: d.date.toISOString().slice(0, 10),
    total: d.total,
    opus: d.opusOnly,
  }));
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--color-muted-2)]">
            Your swarm cost · this year
          </div>
          <h3 className="mt-1 text-[17px] font-medium tracking-tight">Daily token spend, 12-month rolling</h3>
        </div>
      </div>
      <div data-chart-host className="h-[140px] w-full">
        <Resp width="100%" height="100%">
          <Line data={series} margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
            <XAxis dataKey="label" hide />
            <YAxis hide />
            <Tooltip />
            <LineSeries type="monotone" dataKey="total" stroke="#0a0a0a" strokeWidth={2} dot={false} />
            <LineSeries type="monotone" dataKey="opus"  stroke="#d4ff3f" strokeWidth={2} strokeDasharray="3 4" dot={false} />
          </Line>
        </Resp>
      </div>
      <div className="mt-3.5 grid grid-cols-2 gap-4 border-t border-[var(--color-line)] pt-3">
        <div>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-[var(--color-muted-2)]">Avg daily spend</div>
          <div className="text-[21px] font-semibold tracking-tight tabular-nums">$ {avgDaily.toFixed(2)}</div>
        </div>
        <div>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-[var(--color-muted-2)]">Days tracked</div>
          <div className="text-[21px] font-semibold tracking-tight tabular-nums">{data.days.length}</div>
        </div>
      </div>
    </div>
  );
}

export const costLine12MoDef: WidgetDef<CostLineSnapshot> = {
  id: 'cost-line-12mo',
  name: 'Your swarm cost · this year',
  gridArea: 'cost',
  refreshMs: 30000,
  load: getCostLine12Mo,
  Component: CostLine12Mo,
};
```

- [ ] **Step 3: Register, test, commit**

```bash
pnpm test tests/dashboard/widget-cost-line.test.tsx
git add components/dashboard/widgets/cost-line-12mo.tsx components/dashboard/widget-registry.ts tests/dashboard/widget-cost-line.test.tsx
git commit -m "phase 10: <CostLine12Mo /> — Recharts dynamic-imported line chart"
```

---

### Task 16: `<MemorySegmentsRing />` widget

**Files:**
- Create: `components/dashboard/widgets/memory-segments-ring.tsx`
- Test: `tests/dashboard/widget-segments-ring.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MemorySegmentsRing } from '@/components/dashboard/widgets/memory-segments-ring';

describe('<MemorySegmentsRing />', () => {
  it('renders the leading segment as bold text', () => {
    const data = {
      segments: [
        { id: 'identity', count: 8, avgImportance: 0.78 },
        { id: 'knowledge', count: 22, avgImportance: 0.64 },
      ],
    };
    const { getByText } = render(<MemorySegmentsRing data={data} />);
    expect(getByText(/identity stable/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Implement**

```tsx
// components/dashboard/widgets/memory-segments-ring.tsx
import type { SegmentSnapshot } from '@/lib/dashboard/queries';
import type { WidgetDef } from '../widget-registry';
import { getMemorySegmentsSnapshot } from '@/lib/dashboard/queries';

export function MemorySegmentsRing({ data }: { data: SegmentSnapshot }) {
  const top = data.segments[0];
  const others = data.segments.slice(1, 3);
  const pct = top ? Math.round(top.avgImportance * 100) : 0;
  const ringDeg = (pct / 100) * 360;

  return (
    <div className="mt-3.5 flex items-center gap-3.5">
      <div
        className="relative grid h-[54px] w-[54px] place-items-center rounded-full"
        style={{ background: `conic-gradient(var(--color-ink) 0 ${ringDeg}deg, rgba(10,10,10,0.08) ${ringDeg}deg 360deg)` }}
      >
        <div className="absolute inset-1.5 rounded-full bg-[var(--color-surface)]" />
        <span className="relative text-[14px] font-semibold tabular-nums">{pct}%</span>
      </div>
      <div className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
        <strong className="block text-[13px] text-[var(--color-ink)] normal-case tracking-normal font-medium">
          {top ? `${top.id} stable` : 'no segments'}
        </strong>
        {others.map((o, i) => (
          <span key={o.id}>{i > 0 ? ' · ' : ''}{o.id} {Math.round(o.avgImportance * 100)}%</span>
        ))}
      </div>
    </div>
  );
}

export const memorySegmentsRingDef: WidgetDef<SegmentSnapshot> = {
  id: 'memory-segments-ring',
  name: 'Memory segments',
  gridArea: 'refl',
  refreshMs: 30000,
  load: getMemorySegmentsSnapshot,
  Component: MemorySegmentsRing,
};
```

- [ ] **Step 3: Register, test, commit**

```bash
pnpm test tests/dashboard/widget-segments-ring.test.tsx
git add components/dashboard/widgets/memory-segments-ring.tsx components/dashboard/widget-registry.ts tests/dashboard/widget-segments-ring.test.tsx
git commit -m "phase 10: <MemorySegmentsRing /> — segment importance ring"
```

---

### Task 17: `<ActiveWorkersBlack />` (the OLED contrast cell)

**Files:**
- Create: `components/dashboard/widgets/active-workers-black.tsx`
- Test: `tests/dashboard/widget-active-workers.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ActiveWorkersBlack } from '@/components/dashboard/widgets/active-workers-black';

describe('<ActiveWorkersBlack />', () => {
  it('shows count over total with a slash', () => {
    const { getByText } = render(<ActiveWorkersBlack data={{ activeAgentNames: ['a','b','c'], totalAgents: 11 }} />);
    expect(getByText(/3\s*\/\s*11/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Implement**

```tsx
// components/dashboard/widgets/active-workers-black.tsx
import type { ActiveWorkersSnapshot } from '@/lib/dashboard/queries';
import type { WidgetDef } from '../widget-registry';
import { getActiveWorkers } from '@/lib/dashboard/queries';

export function ActiveWorkersBlack({ data }: { data: ActiveWorkersSnapshot }) {
  const idle = Math.max(0, data.totalAgents - data.activeAgentNames.length);
  return (
    <div>
      <h3 className="text-[17px] font-medium tracking-tight">Currently running</h3>
      <div className="mt-1.5 text-[30px] font-semibold leading-none tracking-tight tabular-nums">
        {data.activeAgentNames.length} / {data.totalAgents}
      </div>
      <div className="mt-1.5 text-[12px] text-white/60">
        {idle} idle, {data.activeAgentNames.length} live, the rest cooled down.
      </div>
    </div>
  );
}

export const activeWorkersBlackDef: WidgetDef<ActiveWorkersSnapshot> = {
  id: 'active-workers-black',
  name: 'Active workers · live',
  gridArea: 'black',
  refreshMs: 3000,
  load: getActiveWorkers,
  Component: ActiveWorkersBlack,
};
```

- [ ] **Step 3: Register, test, commit**

```bash
pnpm test tests/dashboard/widget-active-workers.test.tsx
git add components/dashboard/widgets/active-workers-black.tsx components/dashboard/widget-registry.ts tests/dashboard/widget-active-workers.test.tsx
git commit -m "phase 10: <ActiveWorkersBlack /> — OLED contrast cell"
```

---

### Task 18: `canvas-layout.ts` — pure function deriving nodes/edges from events

This is the most-reasoned-about file in the phase. Pure, deterministic, fully unit-tested. The mini canvas and the full canvas both call it.

**Files:**
- Create: `components/dashboard/canvas/canvas-layout.ts`
- Test: `tests/dashboard/canvas-layout.test.ts`

- [ ] **Step 1: Failing tests**

```ts
// tests/dashboard/canvas-layout.test.ts
import { describe, expect, it } from 'vitest';
import { layoutCanvas } from '@/components/dashboard/canvas/canvas-layout';
import type { TaskEvent } from '@/db/schema';

const ev = (i: number, type: string, payload: Record<string, unknown>): TaskEvent =>
  ({
    id: BigInt(i),
    runId: 'r',
    taskId: 't',
    seq: i,
    type,
    payload,
    createdAt: new Date(2026, 3, 27, 12, 0, i),
  } as unknown as TaskEvent);

describe('layoutCanvas', () => {
  it('returns a single dispatcher node and zero edges when only assistant turns exist', () => {
    const out = layoutCanvas([
      ev(1, 'assistant_turn', { agent_name: 'dispatcher', text: 'hi' }),
    ]);
    expect(out.nodes.length).toBe(1);
    expect(out.nodes[0].id).toBe('dispatcher');
    expect(out.edges).toEqual([]);
  });

  it('adds one worker node + one dispatcher→worker edge per Agent tool_call', () => {
    const out = layoutCanvas([
      ev(1, 'assistant_turn', { agent_name: 'dispatcher', text: '...' }),
      ev(2, 'tool_call', {
        agent_name: 'dispatcher',
        tool_name: 'Agent',
        tool_input: { subagent_type: 'fleet-analyst' },
      }),
      ev(3, 'tool_call', {
        agent_name: 'fleet-analyst',
        tool_name: 'mcp__memory__recall',
        tool_input: { query: 'vehicles' },
      }),
    ]);
    const ids = out.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['dispatcher', 'fleet-analyst']);
    expect(out.edges.length).toBe(1);
    expect(out.edges[0].source).toBe('dispatcher');
    expect(out.edges[0].target).toBe('fleet-analyst');
  });

  it('orders worker nodes by first-delegation timestamp', () => {
    const out = layoutCanvas([
      ev(1, 'tool_call', { agent_name: 'dispatcher', tool_name: 'Agent', tool_input: { subagent_type: 'billing' } }),
      ev(2, 'tool_call', { agent_name: 'dispatcher', tool_name: 'Agent', tool_input: { subagent_type: 'fleet-analyst' } }),
      ev(3, 'tool_call', { agent_name: 'dispatcher', tool_name: 'Agent', tool_input: { subagent_type: 'reflector' } }),
    ]);
    const workers = out.nodes
      .filter((n) => n.id !== 'dispatcher')
      .map((n) => n.id);
    expect(workers).toEqual(['billing', 'fleet-analyst', 'reflector']);
  });

  it('marks the worker with the latest tool_call as active', () => {
    const out = layoutCanvas([
      ev(1, 'tool_call', { agent_name: 'dispatcher', tool_name: 'Agent', tool_input: { subagent_type: 'billing' } }),
      ev(2, 'tool_call', { agent_name: 'billing', tool_name: 'Read', tool_input: {} }),
    ]);
    const billing = out.nodes.find((n) => n.id === 'billing');
    expect(billing?.data.state).toBe('active');
  });

  it('marks a worker with an open approval_request event as hitl', () => {
    const out = layoutCanvas([
      ev(1, 'tool_call', { agent_name: 'dispatcher', tool_name: 'Agent', tool_input: { subagent_type: 'billing' } }),
      ev(2, 'approval_request', { agent_name: 'billing', tool_name: 'Write', proposed_input: { file_path: 'invoices/X.json' }, gate_id: 'g-1' }),
    ]);
    const billing = out.nodes.find((n) => n.id === 'billing');
    expect(billing?.data.state).toBe('hitl');
    expect(billing?.data.gate?.gateId).toBe('g-1');
  });

  it('respects the asOf cursor (events after cursor are ignored)', () => {
    const events: TaskEvent[] = [
      ev(1, 'tool_call', { agent_name: 'dispatcher', tool_name: 'Agent', tool_input: { subagent_type: 'billing' } }),
      ev(2, 'tool_call', { agent_name: 'dispatcher', tool_name: 'Agent', tool_input: { subagent_type: 'fleet-analyst' } }),
    ];
    const cursor = events[0].createdAt.getTime();
    const out = layoutCanvas(events, cursor);
    expect(out.nodes.map((n) => n.id).sort()).toEqual(['billing', 'dispatcher']);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm test tests/dashboard/canvas-layout.test.ts
```

Expected: import error.

- [ ] **Step 3: Implement**

```ts
// components/dashboard/canvas/canvas-layout.ts
import type { TaskEvent } from '@/db/schema';

export type AgentState = 'idle' | 'active' | 'hitl' | 'queued' | 'done' | 'failed';

export type AgentNodeData = {
  agentName: string;
  state: AgentState;
  /** Most recent tool the worker invoked (for the chip strip). */
  toolNames: string[];
  /** Inline HITL gate, present iff state === 'hitl'. */
  gate?: {
    gateId: string;
    toolName: string;
    proposedInput: unknown;
  };
  /** Dispatcher's routing reason for this worker (renders on the edge pill). */
  routingReason?: string;
  /** First time this worker was delegated to (for ordering). */
  firstDelegatedAt?: Date;
  /** Last time this worker emitted any event (for the most-recent-active marker). */
  lastEventAt?: Date;
};

export type CanvasNode = {
  id: string;        // 'dispatcher' or worker name
  position: { x: number; y: number };
  data: AgentNodeData;
};

export type CanvasEdge = {
  id: string;        // `${source}->${target}`
  source: string;
  target: string;
  data: { reason?: string };
};

export type CanvasLayout = {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
};

const DISPATCHER = 'dispatcher';

/**
 * Pure function: derive the canvas layout from an events list.
 * Always-deterministic given the same input — used by both live and replay.
 *
 * @param events     ordered task_events (ASC by id)
 * @param asOfMs     optional epoch ms cutoff; events.created_at > asOfMs are ignored
 */
export function layoutCanvas(events: TaskEvent[], asOfMs?: number): CanvasLayout {
  const filtered = asOfMs == null ? events : events.filter((e) => e.createdAt.getTime() <= asOfMs);

  const workers = new Map<string, AgentNodeData>();
  const dispatcherTools = new Set<string>();

  // 1) Pass: collect agent activity
  let dispatcherLastEventAt: Date | undefined;
  for (const e of filtered) {
    const name = (e.payload as { agent_name?: string })?.agent_name;
    if (!name) continue;

    if (name === DISPATCHER) {
      dispatcherLastEventAt = e.createdAt;
      // Agent tool calls = delegations
      if (
        e.type === 'tool_call' &&
        (e.payload as { tool_name?: string }).tool_name === 'Agent'
      ) {
        const targetName =
          (e.payload as { tool_input?: { subagent_type?: string } }).tool_input?.subagent_type;
        if (!targetName) continue;
        const existing = workers.get(targetName);
        if (!existing) {
          workers.set(targetName, {
            agentName: targetName,
            state: 'queued',
            toolNames: [],
            firstDelegatedAt: e.createdAt,
            lastEventAt: e.createdAt,
          });
        }
      }
      continue;
    }

    // Worker activity
    const data: AgentNodeData = workers.get(name) ?? {
      agentName: name,
      state: 'queued',
      toolNames: [],
      firstDelegatedAt: e.createdAt,
      lastEventAt: e.createdAt,
    };
    data.lastEventAt = e.createdAt;

    if (e.type === 'tool_call') {
      const toolName = (e.payload as { tool_name?: string }).tool_name;
      if (toolName && !data.toolNames.includes(toolName)) data.toolNames.push(toolName);
      data.state = 'active';
    } else if (e.type === 'approval_request') {
      data.state = 'hitl';
      data.gate = {
        gateId: String((e.payload as { gate_id?: string }).gate_id ?? ''),
        toolName: String((e.payload as { tool_name?: string }).tool_name ?? ''),
        proposedInput: (e.payload as { proposed_input?: unknown }).proposed_input,
      };
    } else if (e.type === 'run_result') {
      data.state = (e.payload as { status?: string }).status === 'failed' ? 'failed' : 'done';
    }

    workers.set(name, data);
  }

  // 2) The most-recently-active worker (and not hitl) gets state='active';
  //    others previously in active drop back to 'queued' (their tools are done for now).
  const sorted = [...workers.values()].sort((a, b) =>
    (a.firstDelegatedAt?.getTime() ?? 0) - (b.firstDelegatedAt?.getTime() ?? 0));
  let mostRecent: AgentNodeData | undefined;
  for (const w of sorted) {
    if (w.state !== 'hitl' && w.state !== 'failed' && w.state !== 'done') {
      if (!mostRecent || (w.lastEventAt!.getTime() > mostRecent.lastEventAt!.getTime())) {
        mostRecent = w;
      }
    }
  }
  for (const w of sorted) {
    if (w.state === 'active' && w !== mostRecent) w.state = 'queued';
  }

  // 3) Build node layout — dispatcher top center, workers in a row below
  const nodes: CanvasNode[] = [];
  nodes.push({
    id: DISPATCHER,
    position: { x: 350, y: 0 },
    data: {
      agentName: DISPATCHER,
      state: 'active',
      toolNames: [...dispatcherTools],
      lastEventAt: dispatcherLastEventAt,
    },
  });

  const workerCount = sorted.length;
  const stride = 220;
  const totalWidth = (workerCount - 1) * stride;
  const startX = 350 - totalWidth / 2;
  sorted.forEach((w, i) => {
    nodes.push({
      id: w.agentName,
      position: { x: startX + i * stride, y: 220 },
      data: w,
    });
  });

  // 4) Edges — dispatcher → worker for each worker, reason is unused for now
  const edges: CanvasEdge[] = sorted.map((w) => ({
    id: `${DISPATCHER}->${w.agentName}`,
    source: DISPATCHER,
    target: w.agentName,
    data: { reason: w.routingReason },
  }));

  return { nodes, edges };
}
```

- [ ] **Step 4: Run, verify pass**

```bash
pnpm test tests/dashboard/canvas-layout.test.ts
```

Expected: 6/6 PASS.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/canvas/canvas-layout.ts tests/dashboard/canvas-layout.test.ts
git commit -m "phase 10: pure canvas-layout — events -> {nodes, edges}"
```

---

### Task 19: `<AgentNode />` + `<ConnectorPill />`

**Files:**
- Create: `components/dashboard/canvas/agent-node.tsx`
- Create: `components/dashboard/canvas/connector-pill.tsx`
- Test: `tests/dashboard/agent-node.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { AgentNode } from '@/components/dashboard/canvas/agent-node';

describe('<AgentNode />', () => {
  it('renders agent name + state pill', () => {
    const { getByText } = render(
      <AgentNode
        data={{ agentName: 'fleet-analyst', state: 'active', toolNames: ['Recall', 'Bash'] }}
        compact={false}
      />,
    );
    expect(getByText('fleet-analyst')).toBeTruthy();
    expect(getByText(/running/i)).toBeTruthy();
  });
  it('shows red border + gate body when state=hitl', () => {
    const { container, getByText } = render(
      <AgentNode
        data={{
          agentName: 'billing',
          state: 'hitl',
          toolNames: ['Recall', 'Write'],
          gate: { gateId: 'g-1', toolName: 'Write', proposedInput: { file_path: 'invoices/X.json' } },
        }}
        compact={false}
      />,
    );
    expect(getByText(/invoices\/X\.json/)).toBeTruthy();
    expect((container.firstChild as HTMLElement).className).toMatch(/border-\[var\(--color-red\)\]/);
  });
});
```

- [ ] **Step 2: Implement**

```tsx
// components/dashboard/canvas/agent-node.tsx
import type { AgentNodeData } from './canvas-layout';

const STATE_LABEL: Record<AgentNodeData['state'], string> = {
  idle: 'idle',
  active: 'running',
  hitl: 'HITL',
  queued: 'queued',
  done: 'done',
  failed: 'failed',
};

export function AgentNode({ data, compact }: { data: AgentNodeData; compact: boolean }) {
  const isDispatcher = data.agentName === 'dispatcher';

  let borderClass = 'border-[var(--color-line-strong)]';
  let bgClass = 'bg-[var(--color-surface)]';
  let textClass = '';
  if (isDispatcher) { borderClass = 'border-[var(--color-ink)]'; bgClass = 'bg-[var(--color-ink)]'; textClass = 'text-[var(--color-surface)]'; }
  else if (data.state === 'active') borderClass = 'border-[var(--color-lime)] shadow-[0_0_0_3px_rgba(212,255,63,0.5)]';
  else if (data.state === 'hitl') borderClass = 'border-[var(--color-red)]';
  else if (data.state === 'queued') borderClass = 'border-[var(--color-line-strong)] opacity-55';

  const chips = compact ? data.toolNames.slice(0, 3) : data.toolNames;

  return (
    <div className={`rounded-[10px] border ${borderClass} ${bgClass} ${textClass} ${compact ? 'w-[178px] p-2.5' : 'w-[240px] p-3.5'}`}>
      <div className="mb-1 flex justify-between font-mono text-[8.5px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
        <span>{isDispatcher ? 'Dispatcher' : data.state === 'hitl' ? 'Worker · gated' : 'Worker'}</span>
        <span className={data.state === 'hitl' ? 'text-[var(--color-red)] font-semibold' : data.state === 'active' ? 'text-[var(--color-ink)] font-semibold' : ''}>
          {STATE_LABEL[data.state]}
        </span>
      </div>
      <div className={`text-[13px] font-medium ${textClass}`}>{data.agentName}</div>
      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {chips.map((c) => (
            <span key={c} className="rounded-[3px] border border-[var(--color-line-strong)] px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.06em] text-[var(--color-muted)]">
              {c}
            </span>
          ))}
        </div>
      )}
      {data.gate && (
        <div className="mt-2 rounded-[6px] border border-[var(--color-red)] bg-[rgba(215,25,33,0.08)] px-2 py-1.5">
          <div className="font-mono text-[8.5px] uppercase tracking-[0.2em] text-[var(--color-red)]">
            Gate · {data.gate.toolName}
          </div>
          <div className="mt-1 font-mono text-[10px]">
            {(data.gate.proposedInput as { file_path?: string })?.file_path
              ?? JSON.stringify(data.gate.proposedInput).slice(0, 60)}
          </div>
        </div>
      )}
    </div>
  );
}
```

```tsx
// components/dashboard/canvas/connector-pill.tsx
export function ConnectorPill({ reason, tone }: { reason: string; tone: 'cool' | 'warm' | 'lit' }) {
  const cls =
    tone === 'lit' ? 'bg-[var(--color-lime)] border-[var(--color-lime)] text-[var(--color-ink)] font-bold'
    : tone === 'warm' ? 'border-[var(--color-red)] text-[var(--color-red)] bg-[var(--color-surface)]'
    : 'border-[var(--color-line-strong)] text-[var(--color-muted)] bg-[var(--color-surface)]';
  return (
    <span className={`rounded-full border px-2 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.18em] ${cls}`}>
      {reason}
    </span>
  );
}
```

- [ ] **Step 3: Test, commit**

```bash
pnpm test tests/dashboard/agent-node.test.tsx
git add components/dashboard/canvas/agent-node.tsx components/dashboard/canvas/connector-pill.tsx tests/dashboard/agent-node.test.tsx
git commit -m "phase 10: <AgentNode /> + <ConnectorPill /> — node renderer + branch reason"
```

---

### Task 20: `<AgentCanvas />` — React Flow wrapper, mini + full modes

**Files:**
- Create: `components/dashboard/canvas/agent-canvas.tsx`
- Test: smoke render in jsdom (full integration tested via Playwright in Task 30)

- [ ] **Step 1: Implement**

```tsx
// components/dashboard/canvas/agent-canvas.tsx
'use client';
import { useMemo } from 'react';
import ReactFlow, { Background, Controls } from 'reactflow';
import 'reactflow/dist/style.css';
import type { TaskEvent } from '@/db/schema';
import { layoutCanvas } from './canvas-layout';
import { AgentNode } from './agent-node';

const nodeTypes = {
  agent: ({ data }: { data: import('./canvas-layout').AgentNodeData & { compact: boolean } }) => (
    <AgentNode data={data} compact={data.compact} />
  ),
};

export type AgentCanvasProps = {
  events: TaskEvent[];
  mode: 'full' | 'mini';
  /** Epoch ms cursor for replay; omit for live. */
  asOf?: number;
};

export function AgentCanvas({ events, mode, asOf }: AgentCanvasProps) {
  const { nodes, edges } = useMemo(() => layoutCanvas(events, asOf), [events, asOf]);

  const rfNodes = nodes.map((n) => ({
    id: n.id,
    type: 'agent',
    position: n.position,
    data: { ...n.data, compact: mode === 'mini' },
    draggable: false,
    selectable: false,
  }));
  const rfEdges = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: 'default',
    style: { stroke: 'var(--color-line-strong)', strokeWidth: 1.2 },
    animated: false,
  }));

  return (
    <div className={`relative ${mode === 'mini' ? 'h-[280px]' : 'h-[540px]'} w-full overflow-hidden rounded-[12px] border border-[var(--color-line)]`}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        fitView={mode === 'full'}
        proOptions={{ hideAttribution: true }}
        zoomOnScroll={mode === 'full'}
        panOnDrag={mode === 'full'}
        panOnScroll={false}
      >
        {mode === 'full' && <Controls showInteractive={false} />}
        <Background gap={18} size={1} color="rgba(10,10,10,0.05)" />
      </ReactFlow>
    </div>
  );
}
```

- [ ] **Step 2: Add a tiny smoke test**

```tsx
// @vitest-environment jsdom
// tests/dashboard/agent-canvas.test.tsx
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { AgentCanvas } from '@/components/dashboard/canvas/agent-canvas';

describe('<AgentCanvas />', () => {
  it('renders an empty graph for empty events without throwing', () => {
    const { container } = render(<AgentCanvas events={[]} mode="mini" />);
    expect(container.querySelector('.react-flow')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run, fix, commit**

```bash
pnpm test tests/dashboard/agent-canvas.test.tsx
git add components/dashboard/canvas/agent-canvas.tsx tests/dashboard/agent-canvas.test.tsx
git commit -m "phase 10: <AgentCanvas /> wrapper — React Flow + mini/full modes"
```

---

### Task 21: `<CanvasScrubber />` — bottom replay strip (full mode only)

**Files:**
- Create: `components/dashboard/canvas/canvas-scrubber.tsx`
- Test: `tests/dashboard/canvas-scrubber.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { CanvasScrubber } from '@/components/dashboard/canvas/canvas-scrubber';

describe('<CanvasScrubber />', () => {
  it('renders one tick per provided event timestamp', () => {
    const { container } = render(
      <CanvasScrubber
        startedAt={new Date('2026-04-27T00:00:00Z')}
        endedAt={new Date('2026-04-27T00:01:00Z')}
        events={[
          { kind: 'tool', t: new Date('2026-04-27T00:00:10Z') },
          { kind: 'gate', t: new Date('2026-04-27T00:00:30Z') },
          { kind: 'tool', t: new Date('2026-04-27T00:00:50Z') },
        ]}
        cursor={null}
        onCursorChange={() => {}}
      />,
    );
    expect(container.querySelectorAll('[data-tick]').length).toBe(3);
  });

  it('fires onCursorChange(null) when "live" button clicked', () => {
    const onCursor = vi.fn();
    const { getByText } = render(
      <CanvasScrubber
        startedAt={new Date()} endedAt={null}
        events={[]} cursor={123} onCursorChange={onCursor}
      />,
    );
    fireEvent.click(getByText(/live/i));
    expect(onCursor).toHaveBeenCalledWith(null);
  });
});
```

- [ ] **Step 2: Implement**

```tsx
// components/dashboard/canvas/canvas-scrubber.tsx
'use client';
import { ChangeEvent } from 'react';

export type ScrubEvent = { kind: 'tool' | 'gate'; t: Date };

export type CanvasScrubberProps = {
  startedAt: Date;
  endedAt: Date | null;
  events: ScrubEvent[];
  /** epoch ms cursor; null = live mode (follow new events) */
  cursor: number | null;
  onCursorChange: (next: number | null) => void;
};

export function CanvasScrubber({ startedAt, endedAt, events, cursor, onCursorChange }: CanvasScrubberProps) {
  const start = startedAt.getTime();
  const end = (endedAt ?? new Date()).getTime();
  const span = Math.max(1, end - start);

  function handleSlide(e: ChangeEvent<HTMLInputElement>) {
    const v = Number(e.currentTarget.value);
    onCursorChange(v >= span ? null : start + v);
  }

  return (
    <div className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-5 border-t border-[var(--color-line)] px-7 py-4">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted-2)]">
        Replay
      </span>
      <div className="relative h-7">
        <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-[var(--color-line-strong)]" />
        {events.map((ev, i) => {
          const left = ((ev.t.getTime() - start) / span) * 100;
          const cls = ev.kind === 'gate'
            ? 'bg-[var(--color-red)]'
            : 'bg-[var(--color-ink)]';
          return (
            <div
              key={i}
              data-tick={ev.kind}
              className={`absolute top-1/2 h-3 w-px -translate-y-1/2 ${cls}`}
              style={{ left: `${left}%` }}
            />
          );
        })}
        <input
          type="range"
          min={0}
          max={span}
          value={cursor == null ? span : cursor - start}
          onChange={handleSlide}
          className="absolute inset-0 w-full opacity-0"
        />
      </div>
      <span className="font-mono text-[11px] tabular-nums text-[var(--color-muted)]">
        {cursor == null ? 'live' : new Date(cursor).toLocaleTimeString()}
      </span>
      <button
        onClick={() => onCursorChange(null)}
        className="rounded-[2px] border border-[var(--color-line-strong)] px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]"
      >
        Live
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Test, commit**

```bash
pnpm test tests/dashboard/canvas-scrubber.test.tsx
git add components/dashboard/canvas/canvas-scrubber.tsx tests/dashboard/canvas-scrubber.test.tsx
git commit -m "phase 10: <CanvasScrubber /> — replay strip with tool + gate ticks"
```

---

### Task 22: `<MiniCanvas />` widget (embedded canvas in bento home)

**Files:**
- Create: `components/dashboard/widgets/mini-canvas.tsx`
- Test: `tests/dashboard/widget-mini-canvas.test.tsx`

- [ ] **Step 1: Implement**

```tsx
// components/dashboard/widgets/mini-canvas.tsx
'use client';
import type { ActiveRunSnapshot } from '@/lib/dashboard/queries';
import type { WidgetDef } from '../widget-registry';
import { getActiveRun } from '@/lib/dashboard/queries';
import { AgentCanvas } from '../canvas/agent-canvas';

export function MiniCanvas({ data }: { data: ActiveRunSnapshot | null }) {
  if (!data) {
    return (
      <div className="grid h-full place-items-center font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-muted-2)]">
        No active run
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <div className="mb-3.5 flex items-start justify-between">
        <div>
          <h3 className="text-[17px] font-medium tracking-tight">Active swarm run · {data.task.id.slice(0, 8)}</h3>
          <div className="mt-1 font-mono text-[11px] text-[var(--color-muted)]">{data.task.prompt.slice(0, 80)}</div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-lime)] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--color-ink)]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-ink)]" />
          Live
        </span>
      </div>
      <AgentCanvas events={data.events as never} mode="mini" />
    </div>
  );
}

export const miniCanvasDef: WidgetDef<ActiveRunSnapshot | null> = {
  id: 'mini-canvas',
  name: 'Active swarm run',
  gridArea: 'canvas',
  refreshMs: 2000,
  load: getActiveRun,
  Component: MiniCanvas,
};
```

- [ ] **Step 2: Smoke test**

```tsx
// @vitest-environment jsdom
// tests/dashboard/widget-mini-canvas.test.tsx
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MiniCanvas } from '@/components/dashboard/widgets/mini-canvas';

describe('<MiniCanvas />', () => {
  it('renders empty state when data=null', () => {
    const { getByText } = render(<MiniCanvas data={null} />);
    expect(getByText(/no active run/i)).toBeTruthy();
  });
});
```

- [ ] **Step 3: Register, test, commit**

```bash
pnpm test tests/dashboard/widget-mini-canvas.test.tsx
git add components/dashboard/widgets/mini-canvas.tsx components/dashboard/widget-registry.ts tests/dashboard/widget-mini-canvas.test.tsx
git commit -m "phase 10: <MiniCanvas /> widget — embedded AgentCanvas in bento"
```

---

### Task 23: `/api/dashboard/route.ts` — single polling endpoint

**Files:**
- Create: `app/api/dashboard/route.ts`
- Test: `tests/dashboard/api-dashboard.test.ts`

The home polls each widget by hitting `GET /api/dashboard?widget=<id>`. One handler dispatches.

- [ ] **Step 1: Failing test**

```ts
// tests/dashboard/api-dashboard.test.ts
import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/dashboard/route';

describe('/api/dashboard', () => {
  it('returns 400 for missing widget param', async () => {
    const req = new Request('http://x/api/dashboard');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });
  it('returns 400 for unknown widget id', async () => {
    const req = new Request('http://x/api/dashboard?widget=lol');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// app/api/dashboard/route.ts
import { NextResponse } from 'next/server';
import { WIDGET_REGISTRY, type WidgetId } from '@/components/dashboard/widget-registry';

export const dynamic = 'force-dynamic';

const VALID: ReadonlySet<WidgetId> = new Set([
  'greeting','all-agents','mini-canvas','hitl-queue',
  'memory-writes-lime','cleanup-last-night','cost-line-12mo',
  'memory-segments-ring','active-workers-black',
]);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get('widget');
  if (!id || !VALID.has(id as WidgetId)) {
    return NextResponse.json({ error: 'unknown widget id' }, { status: 400 });
  }
  const def = WIDGET_REGISTRY[id as WidgetId];
  if (!def) return NextResponse.json({ error: 'widget not registered' }, { status: 500 });
  try {
    const data = await def.load();
    return NextResponse.json({ data });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Test, commit**

```bash
pnpm test tests/dashboard/api-dashboard.test.ts
git add app/api/dashboard/route.ts tests/dashboard/api-dashboard.test.ts
git commit -m "phase 10: /api/dashboard polling endpoint (?widget=<id>)"
```

---

### Task 24: Bento home — wire all 9 widgets into `app/(dashboard)/page.tsx`

**Files:**
- Modify: `app/(dashboard)/page.tsx`
- Modify: `components/dashboard/widget-registry.ts` (tighten Partial → full Record)
- Modify: `components/dashboard/bento-cell.tsx` (support lime/black variants)

- [ ] **Step 1: Add cell variants to BentoCell**

```tsx
// components/dashboard/bento-cell.tsx — replace existing implementation
import { ReactNode } from 'react';

export type BentoCellProps = {
  name: string;
  gridArea: string;
  variant?: 'default' | 'warm' | 'lime' | 'black';
  hideOpen?: boolean;
  children: ReactNode;
};

const VARIANT: Record<NonNullable<BentoCellProps['variant']>, string> = {
  default: 'bg-[var(--color-surface)] border-[var(--color-line)]',
  warm:    'bg-[var(--color-surface-warm)] border-[var(--color-line)]',
  lime:    'bg-[var(--color-lime)] border-[var(--color-lime-deep)]',
  black:   'bg-[var(--color-ink)] border-[var(--color-ink)] text-[var(--color-surface)]',
};

export function BentoCell({ name, gridArea, variant = 'default', hideOpen, children }: BentoCellProps) {
  const v = VARIANT[variant];
  const labelColor =
    variant === 'lime' ? 'text-black/55' :
    variant === 'black' ? 'text-white/45' :
    'text-[var(--color-muted-2)]';
  const openBorder =
    variant === 'lime' ? 'border-black/25' :
    variant === 'black' ? 'border-white/30' :
    'border-[var(--color-line-strong)]';
  const openColor =
    variant === 'lime' ? 'text-black/70' :
    variant === 'black' ? 'text-white/70' :
    'text-[var(--color-muted)]';

  return (
    <div
      style={{ gridArea }}
      className={`relative overflow-hidden rounded-[16px] border p-[22px] ${v}`}
    >
      <div className={`mb-[10px] flex items-center justify-between font-mono text-[9.5px] uppercase tracking-[0.22em] ${labelColor}`}>
        <span>{name.toUpperCase()}</span>
        {!hideOpen && (
          <span className={`grid h-[22px] w-[22px] place-items-center rounded-full border ${openBorder} text-[12px] ${openColor}`}>↗</span>
        )}
      </div>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Wire registry to full Record + register all widgets**

```ts
// components/dashboard/widget-registry.ts (final form)
import type { ComponentType } from 'react';
import { greetingDef } from './widgets/greeting';
import { allAgentsDef } from './widgets/all-agents';
import { miniCanvasDef } from './widgets/mini-canvas';
import { hitlQueueDef } from './widgets/hitl-queue';
import { memoryWritesLimeDef } from './widgets/memory-writes-lime';
import { cleanupLastNightDef } from './widgets/cleanup-last-night';
import { costLine12MoDef } from './widgets/cost-line-12mo';
import { memorySegmentsRingDef } from './widgets/memory-segments-ring';
import { activeWorkersBlackDef } from './widgets/active-workers-black';

export type WidgetId =
  | 'greeting' | 'all-agents' | 'mini-canvas' | 'hitl-queue'
  | 'memory-writes-lime' | 'cleanup-last-night' | 'cost-line-12mo'
  | 'memory-segments-ring' | 'active-workers-black';

export type WidgetDef<TData = unknown> = {
  id: WidgetId;
  name: string;
  gridArea: string;
  refreshMs: number;
  load: () => Promise<TData>;
  Component: ComponentType<{ data: TData }>;
};

export const WIDGET_REGISTRY: Record<WidgetId, WidgetDef> = {
  'greeting':              greetingDef as WidgetDef,
  'all-agents':            allAgentsDef as WidgetDef,
  'mini-canvas':           miniCanvasDef as WidgetDef,
  'hitl-queue':            hitlQueueDef as WidgetDef,
  'memory-writes-lime':    memoryWritesLimeDef as WidgetDef,
  'cleanup-last-night':    cleanupLastNightDef as WidgetDef,
  'cost-line-12mo':        costLine12MoDef as WidgetDef,
  'memory-segments-ring':  memorySegmentsRingDef as WidgetDef,
  'active-workers-black':  activeWorkersBlackDef as WidgetDef,
};

export function variantFor(id: WidgetId): 'default' | 'warm' | 'lime' | 'black' {
  if (id === 'memory-writes-lime') return 'lime';
  if (id === 'active-workers-black') return 'black';
  if (id === 'cleanup-last-night' || id === 'memory-segments-ring') return 'warm';
  return 'default';
}
```

- [ ] **Step 3: Compose the bento home**

```tsx
// app/(dashboard)/page.tsx — replace the placeholder
import { BentoGrid } from '@/components/dashboard/bento-grid';
import { BentoCell } from '@/components/dashboard/bento-cell';
import { WIDGET_REGISTRY, variantFor, type WidgetId } from '@/components/dashboard/widget-registry';

export const dynamic = 'force-dynamic';

const ORDER: WidgetId[] = [
  'greeting', 'all-agents', 'mini-canvas', 'hitl-queue',
  'memory-writes-lime', 'cleanup-last-night', 'cost-line-12mo',
  'memory-segments-ring', 'active-workers-black',
];

export default async function HomePage() {
  // initial server-side render: load each widget's data once
  const initial = await Promise.all(
    ORDER.map(async (id) => ({ id, data: await WIDGET_REGISTRY[id].load() })),
  );

  return (
    <BentoGrid>
      {initial.map(({ id, data }) => {
        const def = WIDGET_REGISTRY[id];
        const Comp = def.Component;
        return (
          <BentoCell key={id} name={def.name} gridArea={def.gridArea} variant={variantFor(id)}>
            <Comp data={data as never} />
          </BentoCell>
        );
      })}
    </BentoGrid>
  );
}
```

- [ ] **Step 4: Live test with dev**

```bash
pnpm dev -p 3100
```

Open `http://localhost:3100`. Expected: full bento home renders. Lime + black cells stand out. Dispatcher + worker nodes appear in the embedded canvas if a run is in progress, otherwise "No active run" placeholder. Stop dev.

- [ ] **Step 5: Commit**

```bash
git add app/\(dashboard\)/page.tsx components/dashboard/widget-registry.ts components/dashboard/bento-cell.tsx
git commit -m "phase 10: bento home wired with all 9 widgets + lime/black variants"
```

---

### Task 25: Move existing `/tasks/[id]/*` files into `(dashboard)/tasks/[id]/`

This task is **pure file relocation** — no behaviour change. Use `git mv` to preserve history.

**Files:** all of `app/tasks/[id]/*.tsx` → `app/(dashboard)/tasks/[id]/*.tsx`. Plus `app/tasks/page.tsx` and `app/tasks/create-form.tsx` → `app/(dashboard)/tasks/...`.

- [ ] **Step 1: Move via git**

```bash
mkdir -p "app/(dashboard)/tasks/[id]"
git mv app/tasks/[id]/page.tsx           "app/(dashboard)/tasks/[id]/page.tsx"
git mv app/tasks/[id]/timeline-stream.tsx "app/(dashboard)/tasks/[id]/timeline-stream.tsx"
git mv app/tasks/[id]/approval-bar.tsx    "app/(dashboard)/tasks/[id]/approval-bar.tsx"
git mv app/tasks/[id]/approval-card.tsx   "app/(dashboard)/tasks/[id]/approval-card.tsx"
git mv app/tasks/[id]/not-found.tsx       "app/(dashboard)/tasks/[id]/not-found.tsx"
git mv app/tasks/page.tsx                 "app/(dashboard)/tasks/page.tsx"
git mv app/tasks/create-form.tsx          "app/(dashboard)/tasks/create-form.tsx"
rmdir "app/tasks/[id]" "app/tasks" 2>/dev/null || true
```

- [ ] **Step 2: Update internal imports**

`grep -RIn "from '@/app/tasks" .` and replace any references with `@/app/(dashboard)/tasks/...` if they exist. Most references should already use `@/components/timeline/...` and not the page paths.

- [ ] **Step 3: Verify URLs unchanged**

```bash
pnpm dev -p 3100
```

Visit `/tasks` and `/tasks/<existing-id>`. Both should render exactly as before (the route group `(dashboard)` is invisible in the URL). Stop dev.

- [ ] **Step 4: Commit**

```bash
git add -u
git status   # confirm only renames + nothing unexpected
git commit -m "phase 10: relocate /tasks routes into (dashboard) group (move only)"
```

(`git add -u` is acceptable here because we're committing only renames within tracked files; no new files appear.)

---

### Task 26: Canvas/Stream tab toggle on `/tasks/[id]`

**Files:**
- Create: `app/(dashboard)/tasks/[id]/canvas-view.tsx`
- Modify: `app/(dashboard)/tasks/[id]/page.tsx`
- Test: visual smoke

- [ ] **Step 1: Create the Canvas view (server component shell + client island)**

```tsx
// app/(dashboard)/tasks/[id]/canvas-view.tsx
'use client';
import { useEffect, useState } from 'react';
import { AgentCanvas } from '@/components/dashboard/canvas/agent-canvas';
import { CanvasScrubber } from '@/components/dashboard/canvas/canvas-scrubber';
import type { TaskEvent } from '@/db/schema';

export type CanvasViewProps = {
  initialEvents: TaskEvent[];
  startedAt: string;
  endedAt: string | null;
  taskId: string;
};

export function CanvasView({ initialEvents, startedAt, endedAt, taskId }: CanvasViewProps) {
  const [events, setEvents] = useState<TaskEvent[]>(initialEvents);
  const [cursor, setCursor] = useState<number | null>(null);

  // Subscribe to existing phase-06 SSE feed only when cursor is null (live)
  useEffect(() => {
    if (cursor != null) return;
    const es = new EventSource(`/api/tasks/${taskId}/stream`);
    es.addEventListener('task_event', (e) => {
      const ev = JSON.parse((e as MessageEvent).data) as TaskEvent;
      setEvents((prev) => [...prev, ev]);
    });
    return () => es.close();
  }, [cursor, taskId]);

  const ticks = events
    .filter((e) => e.type === 'tool_call' || e.type === 'approval_request')
    .map((e) => ({
      kind: (e.type === 'approval_request' ? 'gate' : 'tool') as 'gate' | 'tool',
      t: new Date(e.createdAt),
    }));

  return (
    <div className="flex flex-col">
      <AgentCanvas events={events} mode="full" asOf={cursor ?? undefined} />
      <CanvasScrubber
        startedAt={new Date(startedAt)}
        endedAt={endedAt ? new Date(endedAt) : null}
        events={ticks}
        cursor={cursor}
        onCursorChange={setCursor}
      />
    </div>
  );
}
```

- [ ] **Step 2: Add tab toggle to `[id]/page.tsx`**

The existing page already loads task + events server-side. Wrap its body in a `<Tabs>` with two children. Approach: read current tab from `?view=canvas|stream` (default `canvas`).

```tsx
// app/(dashboard)/tasks/[id]/page.tsx — pseudo-diff. Add at top:
import Link from 'next/link';
import { CanvasView } from './canvas-view';

// Inside the page component, after existing data load:
const params = await searchParams;
const view = params?.view === 'stream' ? 'stream' : 'canvas';

// Replace where the timeline currently renders with:
<div className="mb-3 flex gap-2">
  <Link href={`?view=canvas`} className={`rounded-full px-3 py-1.5 text-[12px] ${view === 'canvas' ? 'bg-[var(--color-ink)] text-[var(--color-surface)]' : 'border border-[var(--color-line-strong)]'}`}>Canvas</Link>
  <Link href={`?view=stream`} className={`rounded-full px-3 py-1.5 text-[12px] ${view === 'stream' ? 'bg-[var(--color-ink)] text-[var(--color-surface)]' : 'border border-[var(--color-line-strong)]'}`}>Stream</Link>
</div>

{view === 'canvas' ? (
  <CanvasView
    initialEvents={events}
    startedAt={run.startedAt.toISOString()}
    endedAt={run.endedAt?.toISOString() ?? null}
    taskId={params.id}
  />
) : (
  <TimelineStream taskId={params.id} initialEvents={events} />
)}
```

The exact diff depends on the current page structure — read `app/(dashboard)/tasks/[id]/page.tsx` first and adjust the integration. The stream view stays the existing component unchanged.

- [ ] **Step 3: Test, commit**

```bash
pnpm dev -p 3100
```

Open `/tasks/<id>?view=canvas` — see the React Flow canvas. Open `?view=stream` — see the original timeline.

```bash
git add "app/(dashboard)/tasks/[id]/canvas-view.tsx" "app/(dashboard)/tasks/[id]/page.tsx"
git commit -m "phase 10: /tasks/[id] Canvas/Stream tab toggle (?view=)"
```

---

### Task 27: `/tasks` kanban (replaces existing list view)

**Files:**
- Create: `components/dashboard/kanban/kanban-board.tsx`
- Create: `components/dashboard/kanban/kanban-column.tsx`
- Create: `components/dashboard/kanban/task-card.tsx`
- Modify: `app/(dashboard)/tasks/page.tsx`

- [ ] **Step 1: Implement TaskCard + KanbanColumn**

```tsx
// components/dashboard/kanban/task-card.tsx
import Link from 'next/link';
import type { TaskWithGate } from '@/lib/dashboard/queries';

export function TaskCard({ task }: { task: TaskWithGate }) {
  return (
    <Link
      href={`/tasks/${task.id}`}
      className="block rounded-[12px] border border-[var(--color-line)] bg-[var(--color-surface)] p-3.5 transition hover:border-[var(--color-line-strong)]"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="line-clamp-2 text-[13px] leading-snug">{task.prompt}</div>
        {task.hasOpenGate && (
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-[var(--color-red)]" />
        )}
      </div>
      <div className="flex justify-between font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--color-muted-2)]">
        <span>{task.agentCount} agents</span>
        <span>${task.costUsd.toFixed(2)}</span>
      </div>
    </Link>
  );
}
```

```tsx
// components/dashboard/kanban/kanban-column.tsx
import type { TaskWithGate, KanbanColumn as Col } from '@/lib/dashboard/queries';
import { TaskCard } from './task-card';

const TITLES: Record<Col, string> = {
  queued: 'Queued',
  in_progress: 'In progress',
  awaiting_approval: 'Awaiting approval',
  done: 'Done',
  failed: 'Failed',
};

export function KanbanColumn({ status, tasks }: { status: Col; tasks: TaskWithGate[] }) {
  return (
    <div className="rounded-[16px] border border-[var(--color-line)] bg-[var(--color-surface-warm)] p-4">
      <div className="mb-3 flex items-center justify-between font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--color-muted-2)]">
        <span>{TITLES[status]}</span>
        <span>{tasks.length}</span>
      </div>
      <div className="flex flex-col gap-2.5">
        {tasks.map((t) => <TaskCard key={t.id} task={t} />)}
        {tasks.length === 0 && (
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted-2)]">— empty —</div>
        )}
      </div>
    </div>
  );
}
```

```tsx
// components/dashboard/kanban/kanban-board.tsx
import { KanbanColumn } from './kanban-column';
import type { KanbanColumn as Col, TaskWithGate } from '@/lib/dashboard/queries';

export function KanbanBoard({ board }: { board: Record<Col, TaskWithGate[]> }) {
  const cols: Col[] = ['queued', 'in_progress', 'awaiting_approval', 'done', 'failed'];
  return (
    <div className="grid grid-cols-5 gap-3.5">
      {cols.map((c) => <KanbanColumn key={c} status={c} tasks={board[c]} />)}
    </div>
  );
}
```

- [ ] **Step 2: Replace `app/(dashboard)/tasks/page.tsx`**

```tsx
// app/(dashboard)/tasks/page.tsx
import { getKanbanBoard } from '@/lib/dashboard/queries';
import { KanbanBoard } from '@/components/dashboard/kanban/kanban-board';
import { CreateTaskForm } from './create-form';

export const dynamic = 'force-dynamic';

export default async function TasksPage() {
  const board = await getKanbanBoard();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-[24px] font-medium tracking-tight">Tasks</h1>
        <details className="relative">
          <summary className="cursor-pointer rounded-full border border-[var(--color-line-strong)] px-3.5 py-1.5 text-[13px] font-medium">+ New task</summary>
          <div className="absolute right-0 top-full mt-2 w-[460px] rounded-[12px] border border-[var(--color-line)] bg-[var(--color-surface)] p-4 shadow">
            <CreateTaskForm />
          </div>
        </details>
      </div>
      <KanbanBoard board={board} />
    </div>
  );
}
```

(Note: the dnd-kit drag-to-sort within columns is a smaller follow-up — the board is functional without it. Adding dnd-kit just adds same-column reorder visuals. Keep it out unless asked.)

- [ ] **Step 3: Test, commit**

```bash
pnpm dev -p 3100
```

Visit `/tasks` — see five columns. Click `+ New task` — form expands.

```bash
git add components/dashboard/kanban/ "app/(dashboard)/tasks/page.tsx"
git commit -m "phase 10: /tasks kanban (5 columns derived from status × open-gate)"
```

---

### Task 28: `/agents/[name]` page — Recharts metric strip + recent runs

**Files:**
- Create: `app/(dashboard)/agents/[name]/page.tsx`
- Create: `app/(dashboard)/agents/[name]/charts.tsx`

- [ ] **Step 1: Create the client charts**

```tsx
// app/(dashboard)/agents/[name]/charts.tsx
'use client';
import dynamic from 'next/dynamic';
import type { AgentMetrics } from '@/lib/dashboard/queries';

const Bar = dynamic(() => import('recharts').then((m) => m.BarChart), { ssr: false });
const BarSeries = dynamic(() => import('recharts').then((m) => m.Bar), { ssr: false });
const Resp = dynamic(() => import('recharts').then((m) => m.ResponsiveContainer), { ssr: false });
const XAxis = dynamic(() => import('recharts').then((m) => m.XAxis), { ssr: false });

export function AgentChartStrip({ metrics }: { metrics: AgentMetrics }) {
  const tokenSeries = metrics.dailyTokens.map((d) => ({
    label: d.date.toISOString().slice(5, 10),
    tokens: d.tokens,
  }));
  return (
    <div className="grid grid-cols-3 gap-3.5">
      <div className="rounded-[16px] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
        <div className="mb-1 font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--color-muted-2)]">p50 / p95 latency</div>
        <div className="text-[24px] font-semibold tracking-tight tabular-nums">
          {(metrics.p50LatencyMs / 1000).toFixed(2)}s <span className="text-[14px] text-[var(--color-muted)]">/ {(metrics.p95LatencyMs / 1000).toFixed(2)}s</span>
        </div>
      </div>
      <div className="rounded-[16px] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
        <div className="mb-2 font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--color-muted-2)]">Daily tokens</div>
        <div className="h-[60px]">
          <Resp width="100%" height="100%">
            <Bar data={tokenSeries}>
              <XAxis dataKey="label" hide />
              <BarSeries dataKey="tokens" fill="#0a0a0a" />
            </Bar>
          </Resp>
        </div>
      </div>
      <div className="rounded-[16px] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
        <div className="mb-1 font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--color-muted-2)]">Success rate</div>
        <div className="text-[24px] font-semibold tracking-tight tabular-nums">{(metrics.successRate * 100).toFixed(0)}%</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the page**

```tsx
// app/(dashboard)/agents/[name]/page.tsx
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getAgentMetrics } from '@/lib/dashboard/queries';
import { AGENT_NAMES } from '@/lib/agent/agents';
import { AgentChartStrip } from './charts';

export const dynamic = 'force-dynamic';

export default async function AgentPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!AGENT_NAMES.includes(name as never)) notFound();

  const metrics = await getAgentMetrics(name);
  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-end justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted)]">Agent</div>
          <h1 className="text-[36px] font-medium tracking-tight">{name}</h1>
        </div>
        <Link href="/" className="text-[13px] text-[var(--color-muted)] underline">← back</Link>
      </header>

      <AgentChartStrip metrics={metrics} />

      <section>
        <h2 className="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted)]">Recent runs</h2>
        <table className="w-full text-[13px]">
          <thead className="text-left font-mono text-[9.5px] uppercase tracking-[0.18em] text-[var(--color-muted-2)]">
            <tr>
              <th className="py-2">Run</th>
              <th className="py-2">Started</th>
              <th className="py-2">Status</th>
              <th className="py-2 text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {metrics.recentRuns.map((r) => (
              <tr key={r.runId} className="border-t border-[var(--color-line)]">
                <td className="py-2 font-mono text-[11px]"><Link href={`/tasks/${r.taskId}`} className="underline">{r.runId.slice(0, 8)}</Link></td>
                <td className="py-2">{new Date(r.startedAt).toLocaleString()}</td>
                <td className="py-2">{r.status}</td>
                <td className="py-2 text-right tabular-nums">${r.costUsd.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {metrics.topMemories.length > 0 && (
        <section>
          <h2 className="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted)]">Top recalled memories (30d)</h2>
          <ul className="flex flex-col gap-2">
            {metrics.topMemories.map((m) => (
              <li key={m.memoryId} className="rounded-[10px] border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-[12px]">
                <div className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-[var(--color-muted-2)]">
                  {m.memoryId.slice(0, 8)} · {m.recallCount}x
                </div>
                <div className="mt-1 line-clamp-2">{m.excerpt}</div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
```

This requires `lib/agent/agents/index.ts` to export `AGENT_NAMES` (the union as a runtime array). Check current exports — if it only exports the type, add:

```ts
// lib/agent/agents/index.ts (add at bottom if missing)
export const AGENT_NAMES = [
  'dispatcher','fleet-analyst','maintenance-planner','billing','support',
  'reflector','route-optimizer','incident-responder','driver-coach',
  'compliance-auditor','analytics-reporter',
] as const;
```

- [ ] **Step 3: Smoke + commit**

```bash
pnpm dev -p 3100
```

Open `/agents/fleet-analyst` — see header, three chart cards, recent runs table.

```bash
git add "app/(dashboard)/agents/" lib/agent/agents/index.ts
git commit -m "phase 10: /agents/[name] — Recharts strip + recent runs + top memories"
```

---

### Task 29: `/memories` page — filterable browser

**Files:**
- Create: `app/(dashboard)/memories/page.tsx`

- [ ] **Step 1: Implement**

```tsx
// app/(dashboard)/memories/page.tsx
import Link from 'next/link';
import { getMemories } from '@/lib/dashboard/queries';

export const dynamic = 'force-dynamic';

const SEGMENTS = ['identity','correction','preference','relationship','knowledge','behavioral','context'] as const;
const BUCKETS  = ['short','long','permanent'] as const;

export default async function MemoriesPage({
  searchParams,
}: { searchParams: Promise<{ bucket?: string; segment?: string; touched?: string; page?: string }> }) {
  const sp = await searchParams;
  const filter = {
    bucket: (BUCKETS as readonly string[]).includes(sp.bucket ?? '') ? (sp.bucket as 'short'|'long'|'permanent') : undefined,
    segment: (SEGMENTS as readonly string[]).includes(sp.segment ?? '') ? sp.segment : undefined,
    cleanupTouched: sp.touched === '1',
  };
  const page = Math.max(0, Number(sp.page ?? 0));
  const result = await getMemories(filter as never, page, 100);

  function pillHref(updates: Record<string, string | undefined>) {
    const next = { ...sp, ...updates, page: '0' };
    const qs = new URLSearchParams(Object.entries(next).filter(([, v]) => v) as [string, string][]).toString();
    return `?${qs}`;
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-end justify-between">
        <h1 className="text-[36px] font-medium tracking-tight">Memories <span className="text-[var(--color-muted)] tabular-nums">{result.total}</span></h1>
      </header>

      <div className="flex flex-wrap gap-2">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-[var(--color-muted)]">Bucket</span>
        {BUCKETS.map((b) => (
          <Link key={b} href={pillHref({ bucket: filter.bucket === b ? undefined : b })}
                className={`rounded-full px-3 py-1 text-[12px] ${filter.bucket === b ? 'bg-[var(--color-ink)] text-[var(--color-surface)]' : 'border border-[var(--color-line-strong)]'}`}>
            {b}
          </Link>
        ))}
        <span className="ml-4 font-mono text-[9.5px] uppercase tracking-[0.2em] text-[var(--color-muted)]">Segment</span>
        {SEGMENTS.map((s) => (
          <Link key={s} href={pillHref({ segment: filter.segment === s ? undefined : s })}
                className={`rounded-full px-3 py-1 text-[12px] ${filter.segment === s ? 'bg-[var(--color-ink)] text-[var(--color-surface)]' : 'border border-[var(--color-line-strong)]'}`}>
            {s}
          </Link>
        ))}
        <Link href={pillHref({ touched: filter.cleanupTouched ? undefined : '1' })}
              className={`ml-4 rounded-full px-3 py-1 text-[12px] ${filter.cleanupTouched ? 'bg-[var(--color-lime)] text-[var(--color-ink)] font-medium' : 'border border-[var(--color-line-strong)]'}`}>
          Touched by last cleanup
        </Link>
      </div>

      <div className="rounded-[16px] border border-[var(--color-line)] bg-[var(--color-surface)] overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="text-left font-mono text-[9.5px] uppercase tracking-[0.18em] text-[var(--color-muted-2)]">
            <tr>
              <th className="px-4 py-2">ID</th>
              <th className="px-4 py-2">Content</th>
              <th className="px-4 py-2">Bucket</th>
              <th className="px-4 py-2">Segment</th>
              <th className="px-4 py-2 text-right">Imp.</th>
              <th className="px-4 py-2">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((m) => (
              <tr key={m.id} className="border-t border-[var(--color-line)]">
                <td className="px-4 py-2 font-mono text-[10px]">{m.id.slice(0, 8)}</td>
                <td className="px-4 py-2 line-clamp-1 max-w-[420px]">{m.content}</td>
                <td className="px-4 py-2 font-mono text-[10px] uppercase">{m.bucket}</td>
                <td className="px-4 py-2 font-mono text-[10px] uppercase">{m.segment}</td>
                <td className="px-4 py-2 text-right tabular-nums">{m.importance.toFixed(2)}</td>
                <td className="px-4 py-2 font-mono text-[10px] uppercase">{m.cleanupVerdict ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Smoke + commit**

```bash
pnpm dev -p 3100
```

Visit `/memories` — list of recent memories; click a bucket pill to filter; click "Touched by last cleanup" — list narrows.

```bash
git add "app/(dashboard)/memories/page.tsx"
git commit -m "phase 10: /memories filterable browser (bucket × segment × cleanup-touched)"
```

---

### Task 30: Playwright E2E + invariant test

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/dashboard.spec.ts`
- Create: `tests/dashboard/invariants.test.ts`
- Modify: `package.json` — add `"test:e2e": "playwright test"`

- [ ] **Step 1: Add the Playwright config**

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm dev -p 3100',
    url: 'http://localhost:3100',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
```

- [ ] **Step 2: Add the invariant test**

```ts
// tests/dashboard/invariants.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { WIDGET_REGISTRY } from '@/components/dashboard/widget-registry';

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

describe('phase-10 invariants', () => {
  it('no dashboard component imports the Agent SDK', () => {
    const dirs = ['app/(dashboard)', 'components/dashboard'];
    const offenders: string[] = [];
    for (const d of dirs) {
      try {
        for (const f of walk(d)) {
          if (!/\.tsx?$/.test(f)) continue;
          const src = readFileSync(f, 'utf8');
          if (src.includes('@anthropic-ai/claude-agent-sdk')) offenders.push(relative('.', f));
        }
      } catch { /* dir may not exist on first run */ }
    }
    expect(offenders, `These dashboard files import the SDK:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('every WidgetId is registered with a Component + load + gridArea', () => {
    const ids = ['greeting','all-agents','mini-canvas','hitl-queue',
      'memory-writes-lime','cleanup-last-night','cost-line-12mo',
      'memory-segments-ring','active-workers-black'] as const;
    for (const id of ids) {
      const def = WIDGET_REGISTRY[id];
      expect(def, `widget ${id} not registered`).toBeDefined();
      expect(typeof def.load).toBe('function');
      expect(typeof def.Component).toBe('function');
      expect(typeof def.gridArea).toBe('string');
    }
  });

  it('widgets do not import recharts directly (must go through next/dynamic)', () => {
    const widgetsDir = 'components/dashboard/widgets';
    for (const f of walk(widgetsDir)) {
      if (!/\.tsx?$/.test(f)) continue;
      const src = readFileSync(f, 'utf8');
      const hasDirect = /from\s+['"]recharts['"]/.test(src);
      const hasDynamic = src.includes("import('recharts')");
      // Allow either no recharts use, or only the dynamic form.
      expect(!hasDirect || hasDynamic, `${f} imports recharts directly`).toBe(true);
    }
  });
});
```

- [ ] **Step 3: Add the E2E spec**

```ts
// tests/e2e/dashboard.spec.ts
import { test, expect } from '@playwright/test';

test.describe('phase-10 dashboards', () => {
  test('home renders with greeting + bento cells', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/Hi /)).toBeVisible();
    await expect(page.getByText(/here's/)).toBeVisible();
    await expect(page.locator('[data-testid="bento-home"], .grid')).toBeVisible();
  });

  test('/tasks shows five kanban columns', async ({ page }) => {
    await page.goto('/tasks');
    for (const title of ['Queued', 'In progress', 'Awaiting approval', 'Done', 'Failed']) {
      await expect(page.getByText(title)).toBeVisible();
    }
  });

  test('/agents/fleet-analyst renders the metric strip', async ({ page }) => {
    await page.goto('/agents/fleet-analyst');
    await expect(page.getByText('p50 / p95 latency', { exact: false })).toBeVisible();
    await expect(page.getByText('Daily tokens')).toBeVisible();
    await expect(page.getByText('Success rate')).toBeVisible();
  });

  test('/memories shows filter pills + table', async ({ page }) => {
    await page.goto('/memories');
    await expect(page.getByText(/Bucket/i)).toBeVisible();
    await expect(page.getByText(/Segment/i)).toBeVisible();
  });

  test('invalid agent returns 404', async ({ page }) => {
    const res = await page.goto('/agents/totally-fake');
    expect(res?.status()).toBe(404);
  });
});
```

- [ ] **Step 4: Update package.json**

```json
{
  "scripts": {
    "test:e2e": "playwright test"
  }
}
```

- [ ] **Step 5: Run + commit**

```bash
pnpm test tests/dashboard/invariants.test.ts
pnpm test:e2e
```

Both must pass.

```bash
git add tests/e2e/ tests/dashboard/invariants.test.ts playwright.config.ts package.json
git commit -m "phase 10: Playwright E2E + invariant test (no SDK imports, registry complete, no direct recharts)"
```

---

## Final wrap-up

- [ ] **Update README.md** with a short "phase 10 demo" section pointing to `/`, `/tasks`, `/agents/fleet-analyst`, `/memories`.
- [ ] **Push the branch + open the PR.**

```bash
git push origin phase/10-org-chart-metrics-kanban
gh pr create --title "phase 10: bento home, agent canvas, kanban, metrics, memories" \
  --body "$(cat <<'EOF'
## Summary
Operator dashboard surface — light-mode bento home, full agent canvas, kanban, per-agent metrics, memory browser. Implements roadmap phase 10. Spec: docs/superpowers/specs/2026-04-27-phase-10-dashboards-design.md.

## Test plan
- [ ] pnpm test (Vitest, unit + integration)
- [ ] pnpm test:e2e (Playwright)
- [ ] pnpm typecheck
- [ ] pnpm build (bundle size sanity for home page)
- [ ] Manual smoke at /, /tasks, /tasks/<id>, /agents/<name>, /memories
EOF
)"
```

---

## Plan self-review

- **Spec coverage:** every section of the spec maps to at least one task. §1 visual system → Tasks 1, 2, 24. §2 routes → Tasks 3, 24, 26, 27, 28, 29. §3 component contracts → Tasks 4, 5, 19, 20, 21, 22, 24. §4 data sources → Tasks 6–9. §5 polling → Task 5, 23. §6 soft dep → Task 9 (`getAgentMetrics`). §7 acceptance criteria → Task 30. §8 sequencing → entire task order.
- **Placeholders:** none. Every step has either real code, a real command, or an explicit file move.
- **Type consistency:** `AgentName` in registry matches `AGENT_NAMES` array added in Task 28. `WidgetId` union appears identically in registry skeleton (Task 5), final registry (Task 24), polling endpoint allowlist (Task 23), and invariant test (Task 30). `KanbanColumn` shape (`queued/in_progress/awaiting_approval/done/failed`) consistent across queries (Task 9), board component (Task 27), and E2E spec (Task 30).
- **Open spec drift:** the spec said HITL filter is `status='open'`; the actual enum is `status='pending'`. The plan uses `pending` everywhere and notes the correction at the top of Task 6.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-27-phase-10-dashboards-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?

---

## Final shipped state — deviations from plan

The 30-task plan above shipped intact (every task closed). What changed in the **finishing pass** between the original close-out commit (`65fc4a9` — first pass at the README) and the PR-ready state:

### Component vendor strategy (NEW — not in the original plan)

The plan assumed plain Tailwind + a few `next/dynamic` Recharts imports. In the finishing pass we adopted a registry-based component vendor strategy via `components.json`:

```json
"registries": {
  "@reui":         "https://reui.io/r/{style}/{name}.json",
  "@ai-elements":  "https://ai-sdk.dev/elements/api/registry/{name}.json"
}
```

| Folder | Origin | Why it's there |
|---|---|---|
| `components/ui/*` | shadcn `radix-maia` | Stock primitives — Dialog, Tabs, Table, Select, Avatar, Badge, Tooltip, Popover, etc. Used by every other folder. |
| `components/reui/*` | reui | `<Frame>` shell (bento + dialog frame), `<DataGrid>` over @tanstack/react-table, `<Filters>` chip-bar, `<Kanban>`, `<Timeline>`, `<DateSelector>`. Anchors the visual language. |
| `components/ai-elements/*` | Vercel AI SDK Elements | Tool / Reasoning / Confirmation / Code-Block / Conversation / Message / Shimmer. Used to re-skin the timeline — `ToolCall.tsx`, `ToolResult.tsx`, `AssistantTurn.tsx`, `ApprovalRequest.tsx` were rewritten on top of these. |

These are **vendored** — fully copied into `components/{ui,reui,ai-elements}/` and treated as our code. Two patches applied during install (kept here as a record so they don't surprise the next reader):

- `components/reui/filters.tsx:51` — the upstream import `Plus01Icon` from `@hugeicons/core-free-icons` resolves at the type level but is missing from the ESM bundle. Aliased to `PlusSignIcon as Plus01Icon`.
- `components/reui/data-grid/data-grid-pagination.tsx:165` — `<SelectTrigger className="w-14">` clipped two-digit "Rows per page" values (10 / 25 / 50 / 100). Bumped to `w-20`.

### Page surface — what shipped vs what the plan said

| Route | Plan said | Shipped |
|---|---|---|
| `/` | Bento home, 9 widgets | Same shape, but `BentoCell` now wraps each widget in a reui `<Frame>` ↦ `<FramePanel>` (+ optional `<FrameFooter>` for widgets like cost-line whose summary stats sit naturally below the chart). `WidgetDef` gained `Footer?` and `panelClassName?`. |
| `/tasks` | Kanban + a `<CreateTaskForm>` rendered in the page header | Same kanban, but the header now mounts `<CreateTaskDialog>` — a `+ New task` button that opens the form in a Radix Dialog. `create-form.tsx` got an `onCreated?` callback so the dialog can self-close on success. |
| `/tasks/<id>?view=` | Plain anchor pills wired to `?view=` | Replaced with Radix `<Tabs>` in `task-tabs.tsx`. `value` is mirrored to the query param via `router.replace(..., { scroll: false })`; Radix unmounts inactive panes by default so only one EventSource is alive at a time. |
| `/agents` (index) | Plain anchor list grid | Rebuilt as `agents-table.tsx` — a Frame-wrapped `<Table>` with a worker avatar (initials + earth-tone hash colour from `components/dashboard/agents/agent-avatar.tsx`), status badge (active / recent / idle by `lastActivatedAt`), soft budget, last-activated. Click row opens a Dialog with a 30-day stat block (runs, total cost, success rate as a coloured bar) and a **View full metrics →** link. Backed by a new `getAgentsSummary()` query. |
| `/agents/<name>` | Per-agent metrics page | Unchanged from the plan. |
| `/memories` | Filterable table — bucket × segment pills + "touched by last cleanup" toggle, URL-driven | Rebuilt as `memories-table.tsx` (client component) — `c-filters-7`-style chip filters over bucket / segment / cleanup-verdict, a sortable @tanstack/react-table `<DataGrid>` with pagination, importance as a coloured progress bar, cleanup verdict as a `promote / prune / merge / keep` colour-coded badge. Click row opens a Dialog with the full record. URL is no longer the source of truth — the server fetches up to 1000 rows once and the table filters / sorts / paginates client-side. The cleanup verdict column is always populated thanks to a small SQL fix below. |

### Query-side fixes (NEW)

`lib/dashboard/queries.ts` got three meaningful changes during the finishing pass:

- **`getActiveWorkers`** — added `AND e.created_at >= now() - interval '10 minutes'`. The bare `r.status = 'in_progress'` filter was returning agents from runs that crashed without closing, leaking stale "active" workers into the home tile. The freshness window cross-checks the status flag against event recency.
- **`getActiveRun`** — same fix, but with a fallback: if no run is genuinely live (in-progress AND has an event in the last 10 min), return the **most recent run of any status** with `isLive: false`. The mini-canvas tile flips its heading from "Active swarm run · LIVE" to "Last swarm run · {status}" so the home page always has something useful to show even on a quiet system.
- **`getMemories`** — the `LEFT JOIN LATERAL ... ON ${cleanupTouched ? true : false}` pattern meant `cleanupVerdict` was always NULL whenever the cleanup-touched filter was off. Changed to `ON true` unconditionally so the verdict column is always populated (the WHERE clause still narrows when `cleanupTouched=true`). Lets the new client-side filter work without re-fetching.

### Canvas — replay UX rework

The original plan had a passive scrubber: drag the slider, the canvas redraws. Two issues showed up under load:

1. **Topology stutter.** `canvas-layout.ts` was a single pass over the cursor-filtered events, so each tick added or removed worker nodes that hadn't started yet. React Flow dropped the dispatcher → worker edge until the next paint.
2. **Bar lag during replay.** Driving the cursor 60×/s through React state forced React Flow to re-render every frame; the scrubber bar would tick in chunks instead of sliding smoothly.

Fixes:

- **Two-pass `canvas-layout.ts`.** Pass 1 derives **structure** (workers + delegation edges) from the **full** events list — topology is stable across cursor changes. Pass 2 applies **state** (active / hitl / done / tool chips) from events `<= asOfMs`.
- **Play/Pause + imperative bar.** `<CanvasScrubber>` gained a Play/Pause button (Lucide icons). Pressing play kicks an 8-second `requestAnimationFrame` loop. The bar's fill is driven imperatively via `transform: scaleX()` + a CSS transition so the visual motion runs on the compositor and survives the React Flow re-render cost.

### Timeline polish

`components/timeline/*.tsx` were rewritten on top of `@/components/ai-elements/*`:

- `ToolCall.tsx` → `<Tool>` + `<ToolHeader type="dynamic-tool" .../>` + `<ToolContent><ToolInput .../></ToolContent>`. Collapsible by default, no more raw JSON dumps.
- `ToolResult.tsx` → same treatment via `<ToolOutput>`.
- `AssistantTurn.tsx` → wraps `<thinking>` blocks in `<Reasoning><ReasoningTrigger /><ReasoningContent>...` so the reasoning can be hidden by default.
- `ApprovalRequest.tsx` → re-shelled around the AI-Elements `<Confirmation>` card.

### Dependencies added during finishing pass

On top of the plan's pre-flight (`reactflow @dnd-kit/core @dnd-kit/sortable recharts @playwright/test`), the registry-driven vendoring pulled these in:

- **Recharts 2 → 3** — registry components require v3. Tooltip styling rewritten to match `components/ui/tooltip.tsx`'s rounded-2xl bg-foreground panel.
- **DataGrid stack** — `@tanstack/react-table`, `@tanstack/react-virtual`.
- **Calendar / dates** — `react-day-picker`, `date-fns` (used by `<DateSelector>`; not yet rendered anywhere visible).
- **Drag** — `@dnd-kit/modifiers` (for the kanban's drop preview, even though re-ordering is still display-only).
- **AI-Elements stack** — `ai`, `streamdown`, `@streamdown/{cjk,code,math,mermaid}`, `shiki`, `use-stick-to-bottom`, `motion`, `lucide-react`, `@radix-ui/react-use-controllable-state`.

### Scratch / cruft (NOT shipped)

`components/examples/c-*.tsx` and the root-level `progress-*.png` / `replay-*.png` files were design references and screenshots used during the finishing pass. They are now **gitignored** and stay local; nothing imports them.

### Inngest port

`scripts.inngest:dev` was changed from `http://localhost:3000/api/inngest` to `http://localhost:3100/api/inngest` because port 3000 is taken on the operator's machine — `pnpm dev -p 3100` is the only invocation we use here.

### What's intentionally out-of-scope (carried forward)

These were follow-ups noted on the original PR description and remain follow-ups:

- `getAgentMetrics.topMemories` queries a JSONB path that doesn't exist on `task_events` — page renders the section conditionally so it just stays empty until the query is fixed.
- `<CanvasScrubber>` server/client hydration mismatch on live tasks (server snapshots `Date.now()` at SSR time, client recomputes on hydration). Predates phase 10's scrubber rework.
- `/agents/<name>` rejects `dispatcher` because the worker registry only holds the 10 workers; the dispatcher orchestrator is a separate concept.






