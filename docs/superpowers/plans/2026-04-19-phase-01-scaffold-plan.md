# Phase 01 — Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Auto-ride repo skeleton (Next.js 15 + Drizzle + Neon + pgvector + one `/health` route) so every later phase has a clean base to build on.

**Architecture:** Flat single-package Next.js repo. All code under `src/` with `app/` (routes), `db/` (Drizzle client, empty schema barrel), and `lib/` (zod env loader). Agent code (`src/agent/`) intentionally absent — lands in phase 05. Two Neon connection URLs: pooled for Next.js runtime via `@neondatabase/serverless`, unpooled for `drizzle-kit migrate` via `postgres`. pgvector extension enabled via a custom drizzle migration.

**Tech Stack:** Next.js 15 (App Router, Turbopack), React 19, TypeScript 5 (strict + `noUncheckedIndexedAccess`), Tailwind CSS v4, shadcn/ui (user preset `b3sPu45W6s`), Drizzle ORM + drizzle-kit, `@neondatabase/serverless` (pooled), `postgres` (direct), zod 4, vitest 3, pnpm 9, Node ≥22.

**Spec:** `docs/superpowers/specs/2026-04-19-phase-01-scaffold-design.md`
**Roadmap entry:** `docs/roadmap/ROADMAP.md` — phase 01

---

## Prerequisites (one-time, before Task 1)

- Neon project created; **pgvector enabled via the Neon dashboard** (Project → Extensions → toggle `vector` on). Without this, the migration in Task 8 fails.
- Pooled and unpooled Neon connection strings copied.
- Node ≥22 and pnpm ≥9 installed locally (`node -v && pnpm -v`).
- From the main checkout (`W:/personal-code/Agent-swarm`), `git status` is clean on `main` at commit `bb8820a` or later.

---

## Task 1 — Create phase 01 worktree

**Files:**
- No code files yet; git plumbing only.

- [ ] **Step 1: Create worktree + branch from `main`**

Run (from the main checkout `W:/personal-code/Agent-swarm`):
```bash
git switch main && git pull
git worktree add .worktree/phase-01-scaffold -b phase/01-scaffold
```
Expected: `Preparing worktree (new branch 'phase/01-scaffold')` and a new directory at `.worktree/phase-01-scaffold/`.

- [ ] **Step 2: Set repo-local git identity in the new worktree**

```bash
cd .worktree/phase-01-scaffold
git config user.name  "shahriarbijoy"
git config user.email "shahriarbijoy@gmail.com"
git config user.name && git config user.email
```
Expected stdout:
```
shahriarbijoy
shahriarbijoy@gmail.com
```

- [ ] **Step 3: Push the new branch to origin**

```bash
git push -u origin phase/01-scaffold
```
Expected: `Branch 'phase/01-scaffold' set up to track remote branch 'phase/01-scaffold' from 'origin'.`

No commit yet — the worktree branch starts at main's HEAD.

---

## Task 2 — Scaffold Next.js + Tailwind v4 + shadcn via preset

**Files:**
- Create (via scaffolder): `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs`, `components.json`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `src/lib/utils.ts`, `src/components/ui/button.tsx`, `public/*`, etc.
- Modify (by scaffolder): `.gitignore` (append Next.js entries — **keep existing contents**)

- [ ] **Step 1: Run the user-provided shadcn preset**

From inside `.worktree/phase-01-scaffold/`:
```bash
pnpm dlx shadcn@latest init --preset b3sPu45W6s --template next
```
Expected: interactive prompts auto-answered by the preset; files above are created; `pnpm install` runs at the end. If the scaffolder refuses to run in a non-empty directory, answer `yes` when prompted to overwrite (existing files are all planning docs — they're on `main`, not lost).

- [ ] **Step 2: Confirm the scaffolder respected the existing `.gitignore` allowlist**

```bash
cat .gitignore | head -25
```
Expected: the first block still contains `*.md` + allowlist entries (`!README.md`, `!gitworkflow.md`, `!CLAUDE.md`, `!.claude/**/*.md`, `!docs/**/*.md`). If the scaffolder wiped them, restore from `main`:
```bash
git checkout main -- .gitignore
```
Then re-append any Next-specific lines (`.next/`, `node_modules/`, `/coverage`) that the scaffolder added.

- [ ] **Step 3: Confirm project structure**

```bash
ls src/
# expect: app/  components/  lib/
ls src/app/
# expect: favicon.ico  globals.css  layout.tsx  page.tsx
cat components.json | head -5
# expect: $schema + style + rsc: true
```

- [ ] **Step 4: Add the `button` component to verify the shadcn pipeline**

```bash
pnpm dlx shadcn@latest add button
```
Expected: `src/components/ui/button.tsx` created (or already present via preset — either is fine).

- [ ] **Step 5: Review scaffolded files before staging (the PreToolUse hook blocks `git add .` and `git add -A`)**

```bash
git status
```
Note every untracked path the scaffolder created so you can pass them explicitly to `git add`.

- [ ] **Step 6: Initial commit (stage by name only)**

Stage the typical Next.js 15 + shadcn set. Adjust the list to match what `git status` actually shows — scaffolders vary by preset.
```bash
git add \
  package.json pnpm-lock.yaml \
  tsconfig.json next.config.ts next-env.d.ts \
  eslint.config.mjs postcss.config.mjs \
  components.json \
  .gitignore \
  src/ public/
# If the preset created anything else (e.g., a prettier config, an `app/`
# directory outside `src/`, or a README override), stage it by name here too.
git status   # verify nothing sensitive (.env.local, .env, .env.*) is staged
git commit -m "chore(phase-01): scaffold Next.js 15 + Tailwind v4 + shadcn via preset b3sPu45W6s"
```

---

## Task 3 — Install remaining runtime + dev dependencies

**Files:**
- Modify: `package.json` (adds deps)
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Install runtime deps**

```bash
pnpm add drizzle-orm drizzle-kit @neondatabase/serverless postgres zod dotenv
```
Expected: packages added to `dependencies` in `package.json`.

- [ ] **Step 2: Install dev deps**

```bash
pnpm add -D vitest @vitest/ui tsx @types/node
```
Expected: packages added to `devDependencies`.

- [ ] **Step 3: Pin Node + pnpm engines in package.json**

Open `package.json`, add:
```json
"engines": {
  "node": ">=22",
  "pnpm": ">=9"
},
"packageManager": "pnpm@9"
```
(Preserve all existing fields the scaffolder generated.)

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(phase-01): add drizzle, neon, postgres, zod, vitest deps + engines pin"
```

---

## Task 4 — Tighten TypeScript config

**Files:**
- Modify: `tsconfig.json`

- [ ] **Step 1: Open `tsconfig.json` and enable strict flags**

Ensure `compilerOptions` contains (merge with what the scaffolder wrote):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```
Note: `exactOptionalPropertyTypes` intentionally **off** — painful with many libs.

- [ ] **Step 2: Run typecheck to confirm the scaffolded code still passes under strict**

```bash
pnpm exec tsc --noEmit
```
Expected: no errors. (If `src/app/page.tsx` has an unchecked index access, fix it minimally — do not disable the flag.)

- [ ] **Step 3: Commit**

```bash
git add tsconfig.json src/app/page.tsx
git commit -m "chore(phase-01): tighten tsconfig (strict + noUncheckedIndexedAccess)"
```

---

## Task 5 — `.env.example` + `.env.local` template

**Files:**
- Create: `.env.example`

- [ ] **Step 1: Create `.env.example`**

```bash
cat > .env.example <<'EOF'
# ──────────────────────────────────────────────────────────────
# Neon Postgres — TWO URLs required.
#   DATABASE_URL          → pooled,   for Next.js serverless runtime
#                           (used by @neondatabase/serverless)
#   DATABASE_URL_UNPOOLED → direct,   for drizzle-kit migrations
#                           (pooled URLs time out on long migration txns)
# ──────────────────────────────────────────────────────────────
DATABASE_URL="postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/autoride?sslmode=require"
DATABASE_URL_UNPOOLED="postgresql://user:pass@ep-xxx.region.aws.neon.tech/autoride?sslmode=require"

# ──────────────────────────────────────────────────────────────
# Later phases will append:
#   CLAUDE_CODE_OAUTH_TOKEN   (phase 05, Max-subscription via `claude setup-token`)
#     OR
#   ANTHROPIC_BASE_URL +      (phase 05, LiteLLM Max-passthrough proxy)
#   ANTHROPIC_AUTH_TOKEN      (phase 05)
#     OR
#   ANTHROPIC_API_KEY         (phase 05, only if this project ever turns commercial)
#   GOOGLE_GENAI_API_KEY      (phase 03)
#   INNGEST_EVENT_KEY         (phase 06)
#   INNGEST_SIGNING_KEY       (phase 06)
#   BETTER_AUTH_SECRET        (phase 11)
#   BETTER_AUTH_URL           (phase 11)
#   LANGFUSE_PUBLIC_KEY       (phase 12)
#   LANGFUSE_SECRET_KEY       (phase 12)
#   LANGFUSE_BASEURL          (phase 12)
# ──────────────────────────────────────────────────────────────
EOF
```

- [ ] **Step 2: Copy to `.env.local` and fill in real Neon URLs**

```bash
cp .env.example .env.local
# Then edit .env.local with the real pooled + unpooled URLs from the Neon dashboard.
```
`.env.local` is gitignored by the default Next.js `.gitignore` block — confirm with `git status` that it's not staged.

- [ ] **Step 3: Commit the example only**

```bash
git add .env.example
git commit -m "chore(phase-01): add .env.example with pooled/unpooled Neon URLs"
```

---

## Task 6 — Zod-validated env loader

**Files:**
- Create: `src/lib/env.ts`

Scope matches the spec exactly ("One smoke test" at the route-handler layer in Task 9 — the env loader is a trivial zod schema and doesn't need its own test file).

- [ ] **Step 1: Write the loader**

Create `src/lib/env.ts`:
```ts
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url().min(1),
  DATABASE_URL_UNPOOLED: z.string().url().min(1),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();
```

- [ ] **Step 2: Typecheck passes**

```bash
pnpm exec tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/env.ts
git commit -m "feat(phase-01): zod-validated env loader"
```

---

## Task 7 — Neon client + `ping` + `checkExtension`

**Files:**
- Create: `src/db/client.ts`
- Create: `src/db/schema/index.ts` (empty barrel for phase 02)

- [ ] **Step 1: Create the empty schema barrel**

```bash
mkdir -p src/db/schema
cat > src/db/schema/index.ts <<'EOF'
// Phase 02 will populate this barrel with memory + task + approval tables.
// Keeping the file so drizzle.config.ts has a valid schema glob from phase 01.
export {};
EOF
```

- [ ] **Step 2: Write the Neon client**

Create `src/db/client.ts`:
```ts
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { env } from '@/lib/env';
import * as schema from './schema';

const sql = neon(env.DATABASE_URL);
export const db = drizzle(sql, { schema });

/** Returns 'up' if SELECT 1 resolves within 2s, else 'down'. */
export async function ping(): Promise<'up' | 'down'> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2000);
    try {
      await sql`SELECT 1`;
      return 'up';
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return 'down';
  }
}

/** Returns 'installed' if pg_extension has a row matching `name`, else 'missing'. */
export async function checkExtension(
  name: string,
): Promise<'installed' | 'missing'> {
  try {
    const rows = (await sql`
      SELECT 1 FROM pg_extension WHERE extname = ${name}
    `) as unknown[];
    return rows.length > 0 ? 'installed' : 'missing';
  } catch {
    return 'missing';
  }
}
```

- [ ] **Step 3: Typecheck passes**

```bash
pnpm exec tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/db/client.ts src/db/schema/index.ts
git commit -m "feat(phase-01): neon client + ping + checkExtension helpers"
```

---

## Task 8 — pgvector migration

**Files:**
- Create: `drizzle.config.ts`
- Create: `drizzle/0000_enable_vector.sql`
- Create: `drizzle/meta/_journal.json` (drizzle-kit generates)

- [ ] **Step 1: Write `drizzle.config.ts`**

```ts
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED! },
  strict: true,
  verbose: true,
});
```

- [ ] **Step 2: Generate a custom (empty) migration scaffold**

```bash
pnpm exec drizzle-kit generate --custom --name enable_vector
```
Expected: `drizzle/0000_enable_vector.sql` created with an empty body; `drizzle/meta/_journal.json` created.

- [ ] **Step 3: Fill in the migration SQL**

Replace the contents of `drizzle/0000_enable_vector.sql` with:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

- [ ] **Step 4: Run the migration against Neon**

```bash
pnpm exec drizzle-kit migrate
```
Expected: `[✓] Migrations applied successfully!`. If you see `ERROR: extension "vector" is not available`, go back to the Neon dashboard → Extensions → enable `vector`, then re-run.

- [ ] **Step 5: Verify in Neon (manual, via drizzle-kit studio)**

```bash
pnpm exec drizzle-kit studio
```
Open the URL printed, run a raw query `SELECT extname FROM pg_extension;` — confirm `vector` appears. Close studio.

- [ ] **Step 6: Commit**

```bash
git add drizzle.config.ts drizzle/
git commit -m "feat(phase-01): pgvector extension migration + drizzle config"
```

---

## Task 9 — `/health` route (TDD)

**Files:**
- Create: `src/app/health/route.ts`
- Create: `tests/health.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/health.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/db/client', () => ({
  ping: vi.fn(),
  checkExtension: vi.fn(),
}));

describe('GET /health', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 200 and ok:true when db and vector are healthy', async () => {
    const client = await import('@/db/client');
    vi.mocked(client.ping).mockResolvedValue('up');
    vi.mocked(client.checkExtension).mockResolvedValue('installed');

    const { GET } = await import('../src/app/health/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      checks: { db: 'up', vector: 'installed' },
    });
    expect(body.version).toBeDefined();
    expect(body.ts).toBeDefined();
  });

  it('returns 503 and ok:false when db is down', async () => {
    const client = await import('@/db/client');
    vi.mocked(client.ping).mockResolvedValue('down');
    vi.mocked(client.checkExtension).mockResolvedValue('installed');

    const { GET } = await import('../src/app/health/route');
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.checks.db).toBe('down');
  });

  it('returns 503 when pgvector is missing', async () => {
    const client = await import('@/db/client');
    vi.mocked(client.ping).mockResolvedValue('up');
    vi.mocked(client.checkExtension).mockResolvedValue('missing');

    const { GET } = await import('../src/app/health/route');
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.checks.vector).toBe('missing');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- health
```
Expected: FAIL — `Cannot find module '../src/app/health/route'`.

- [ ] **Step 3: Implement the route handler**

Create `src/app/health/route.ts`:
```ts
import { ping, checkExtension } from '@/db/client';
import pkg from '../../../package.json';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [db, vector] = await Promise.all([
    ping(),
    checkExtension('vector'),
  ]);
  const ok = db === 'up' && vector === 'installed';
  return Response.json(
    {
      ok,
      version: pkg.version,
      checks: { db, vector },
      ts: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 },
  );
}
```
Note: `resolveJsonModule: true` in `tsconfig.json` (Task 4) allows the `package.json` import.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- health
```
Expected: PASS — all three tests green.

- [ ] **Step 5: Manual smoke against real Neon**

```bash
pnpm dev
```
In another terminal:
```bash
curl -s http://localhost:3000/health | jq
```
Expected body:
```json
{ "ok": true, "version": "0.1.0", "checks": { "db": "up", "vector": "installed" }, "ts": "..." }
```
Stop `pnpm dev` (`Ctrl+C`).

- [ ] **Step 6: Commit**

```bash
git add src/app/health/route.ts tests/health.test.ts
git commit -m "feat(phase-01): /health route with db + pgvector checks"
```

---

## Task 10 — Scripts, vitest config, ESLint sanity

**Files:**
- Modify: `package.json` (add scripts)
- Create: `vitest.config.ts`
- Modify: `eslint.config.mjs` (if needed — only if scaffolder didn't set flat config)

- [ ] **Step 1: Add scripts to `package.json`**

Merge into the `scripts` block (preserve any the scaffolder wrote):
```json
{
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "format": "prettier --write .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio"
  }
}
```

- [ ] **Step 2: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
```

- [ ] **Step 3: Run all commands that will gate the PR**

```bash
pnpm typecheck
pnpm lint
pnpm test
```
Expected: all three green. Fix any lint issues the scaffolder left behind.

- [ ] **Step 4: Commit**

```bash
git add package.json vitest.config.ts
git commit -m "chore(phase-01): add dev/test/db scripts + vitest config"
```

---

## Task 11 — README quickstart

**Files:**
- Modify: `README.md` (replace scaffolder default)

- [ ] **Step 1: Replace `README.md` content**

```markdown
# Auto-ride

An 11-agent Claude Agent SDK swarm with a three-bucket memory system and nightly adversarial cleanup, served from a Next.js 15 webapp.

- Architecture & rationale: [`auto-ride-initial-plan.md`](./auto-ride-initial-plan.md)
- Phase roadmap: [`docs/roadmap/ROADMAP.md`](./docs/roadmap/ROADMAP.md)
- Git workflow: [`gitworkflow.md`](./gitworkflow.md)

## Quickstart (phase 01)

**Prerequisites**
- Node ≥22, pnpm ≥9
- A Neon project with **pgvector enabled** (Neon dashboard → Project → Extensions → toggle `vector` on)

**Setup**

1. Copy env template and fill in both Neon URLs:
   ```bash
   cp .env.example .env.local
   ```
   `.env.local` needs:
   - `DATABASE_URL` — Neon **pooled** URL (hostname contains `-pooler`)
   - `DATABASE_URL_UNPOOLED` — Neon direct URL

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

## Scripts

| Script | Purpose |
|---|---|
| `pnpm dev` | Next.js dev server with Turbopack |
| `pnpm build` / `pnpm start` | Production build / server |
| `pnpm test` / `pnpm test:watch` | vitest |
| `pnpm typecheck` | `tsc --noEmit` under strict |
| `pnpm lint` / `pnpm format` | ESLint / Prettier |
| `pnpm db:generate` | Generate a Drizzle migration |
| `pnpm db:migrate` | Apply pending migrations (via `DATABASE_URL_UNPOOLED`) |
| `pnpm db:studio` | Open drizzle-kit studio |

## Phase status

See [`docs/roadmap/ROADMAP.md`](./docs/roadmap/ROADMAP.md) for the 12-phase plan and the current open PR.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(phase-01): README quickstart"
```

---

## Task 12 — Acceptance verification + final cleanup

**Files:**
- No new files; runs through every acceptance criterion from the spec.

- [ ] **Step 1: Run the full gate locally**

```bash
pnpm install          # should be a no-op
pnpm typecheck        # green
pnpm lint             # green
pnpm test             # 3 tests pass (all in tests/health.test.ts)
pnpm build            # production build succeeds
```

- [ ] **Step 2: Run `/health` against real Neon**

```bash
pnpm dev
# in another terminal:
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/health
# expect: 200
curl -s http://localhost:3000/health | jq '.ok, .checks'
# expect: true  { "db": "up", "vector": "installed" }
```
Stop `pnpm dev`.

- [ ] **Step 3: Manual failure-mode verification**

Temporarily break the extension check — in `src/app/health/route.ts`, change `checkExtension('vector')` to `checkExtension('nonexistent')`.
```bash
pnpm dev
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/health
# expect: 503
curl -s http://localhost:3000/health | jq '.ok, .checks'
# expect: false  { "db": "up", "vector": "missing" }
```
Stop `pnpm dev`. **Revert** the test edit:
```bash
git checkout -- src/app/health/route.ts
```

- [ ] **Step 4: Verify drizzle-kit studio still opens**

```bash
pnpm db:studio
```
Schema view should be empty (no tables — phase 02 adds them). Close studio.

- [ ] **Step 5: Final git hygiene**

```bash
git status
```
Expected: `nothing to commit, working tree clean`. If anything is uncommitted, either commit it with a meaningful message or `git restore` it.

---

## Task 13 — Open the phase 01 PR

**Files:**
- None (remote operation only)

- [ ] **Step 1: Rebase on latest `main` (in case it moved)**

```bash
git fetch origin
git rebase origin/main
```
If `main` hasn't moved, this is a no-op.

- [ ] **Step 2: Push**

```bash
git push
```

- [ ] **Step 3: Open the PR**

```bash
gh pr create \
  --base main \
  --head phase/01-scaffold \
  --title "phase 01: scaffold" \
  --body "$(cat <<'EOF'
Implements phase 01 of the Auto-ride roadmap.

- Design: [docs/superpowers/specs/2026-04-19-phase-01-scaffold-design.md](./docs/superpowers/specs/2026-04-19-phase-01-scaffold-design.md)
- Plan: [docs/superpowers/plans/2026-04-19-phase-01-scaffold-plan.md](./docs/superpowers/plans/2026-04-19-phase-01-scaffold-plan.md)
- Roadmap entry: [docs/roadmap/ROADMAP.md](./docs/roadmap/ROADMAP.md) — phase 01
- Plan § references: auto-ride-initial-plan.md §1, §9

## Scope
- Flat single-package Next.js 15 + Tailwind v4 + shadcn repo
- Drizzle + Neon pooled/unpooled clients; pgvector extension migration applied
- Zod-validated env loader at `src/lib/env.ts`
- Public `/health` route returning `{ok, version, checks:{db,vector}, ts}` with 200/503
- vitest smoke tests for env loader + /health route handler
- Engines pinned to Node ≥22, pnpm ≥9

## Non-goals (deferred)
- No auth layer (phase 11)
- No schema tables (phase 02)
- No agent/MCP/Anthropic/Gemini code (phases 03-05)

## Acceptance
- [x] `pnpm install` clean
- [x] `pnpm dev` serves `/`
- [x] `pnpm db:migrate` applies `CREATE EXTENSION vector`
- [x] `pnpm db:studio` opens
- [x] `GET /health` → 200 with all checks green
- [x] `/health` → 503 when a check fails (manual verify)
- [x] `pnpm test`, `pnpm typecheck`, `pnpm lint` all green
- [x] Worktree git identity = shahriarbijoy/shahriarbijoy@gmail.com
EOF
)"
```

- [ ] **Step 4: Confirm the PR is open**

```bash
gh pr view --web
```
Browser opens the PR page on GitHub.

---

## Post-merge cleanup (after PR merges to main)

Run from the main checkout (not inside the worktree):
```bash
cd W:/personal-code/Agent-swarm
git switch main && git pull
git worktree remove .worktree/phase-01-scaffold
git branch -d phase/01-scaffold
git fetch --prune
```

`git worktree remove` refuses if there are uncommitted changes — that's the safety net.

---

## Coverage check (self-review vs. spec)

| Spec requirement | Task(s) |
|---|---|
| Flat `src/{app,db,lib}` layout | Task 2 (scaffold) + Task 7 (db) |
| Next 15 + React 19 + Tailwind v4 + shadcn via preset `b3sPu45W6s` | Task 2 |
| Exact-patch dep pins | Task 3 (lockfile locks) |
| TS strict + `noUncheckedIndexedAccess` | Task 4 |
| `DATABASE_URL` pooled / `DATABASE_URL_UNPOOLED` unpooled | Tasks 5, 7, 8 |
| `drizzle-kit generate --custom` → pgvector migration | Task 8 |
| `/health` with `ping` + `checkExtension` helpers, 200/503 | Tasks 7, 9 |
| Zod env loader at `src/lib/env.ts` | Task 6 |
| vitest installed + smoke test for `/health` | Tasks 9, 10 |
| `pnpm` scripts (dev/build/test/typecheck/db:*) | Task 10 |
| README quickstart (Neon dashboard step, pooled vs unpooled note) | Task 11 |
| Acceptance criteria 1–10 from spec | Task 12 |
| Phase 01 worktree + branch + PR workflow | Tasks 1, 13 |
| Git identity enforcement | Task 1 Step 2 |
| `.gitignore` already extended for `docs/**/*.md` | (done on main in prior commit `eb76cb6`) |
