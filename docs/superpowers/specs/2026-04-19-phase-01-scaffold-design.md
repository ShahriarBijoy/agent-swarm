# Phase 01 — Scaffold (design)

**Date:** 2026-04-19
**Status:** approved (brainstorming)
**Plan references:** `auto-ride-initial-plan.md` §1, §9
**Roadmap entry:** `docs/roadmap/ROADMAP.md` — phase 01

## Purpose

Stand up the Auto-ride repo skeleton — Next.js 15 webapp, Drizzle-managed Neon connection, pgvector extension enabled, one health-check route, one shadcn component as a pipeline smoke test. **No auth, no schema, no agent code, no UI.** This phase exists so every subsequent phase can focus on one concern at a time without re-litigating toolchain choices.

## Non-goals

Explicitly out of scope for phase 01 — do not add them even if convenient:

- Any auth layer, middleware, or route gating (phase 11).
- Any schema tables beyond the empty Drizzle config (phase 02).
- Any UI beyond the Next.js placeholder page + the shadcn `button` component added at init time.
- Any Claude Agent SDK, Gemini SDK, or Inngest integration (phases 03/05/06).
- CI / deploy pipeline (phase 12).
- Tests beyond one `/health` smoke test.

## Repo architecture

**Flat single-package Next.js repo.** Chosen over a pnpm monorepo because a solo portfolio project values iteration speed over pristine dependency isolation; the structural cost of splitting later (phase 12, if Vercel Sandbox vs Fly.io makes it matter) is ~2 hours because schema already lives under `src/db/`.

```
Agent-swarm/
├── src/
│   ├── app/                 # Next.js App Router
│   │   ├── layout.tsx
│   │   ├── page.tsx         # minimal placeholder
│   │   └── health/
│   │       └── route.ts     # public health endpoint
│   ├── db/
│   │   ├── client.ts        # @neondatabase/serverless client (pooled, runtime)
│   │   └── schema/          # empty in phase 01; populated in phase 02
│   └── lib/
│       └── env.ts           # zod-validated env loader
├── drizzle/
│   └── 0000_enable_vector.sql  # CREATE EXTENSION IF NOT EXISTS vector;
├── docs/
│   ├── roadmap/ROADMAP.md
│   └── superpowers/specs/   # this file lives here
├── drizzle.config.ts
├── next.config.ts
├── tsconfig.json
├── eslint.config.mjs
├── package.json
├── pnpm-lock.yaml
├── .env.example
├── .gitignore
├── CLAUDE.md
├── gitworkflow.md
├── auto-ride-initial-plan.md
└── README.md                # phase-01 landing page with setup steps
```

`src/agent/` is intentionally absent in phase 01 — it lands in phase 05 when the first `query()` call needs it. Keeping `src/agent/` isolated from `src/app/` is the structural invariant that makes a future split (monorepo or two-repo) cheap.

## Dependencies

**Runtime:**

| Package | Purpose | Pin strategy |
|---|---|---|
| `next@15` | App Router, Fluid Compute, Turbopack dev | exact patch |
| `react@19` + `react-dom@19` | React 19 for Next 15 | exact patch |
| `typescript@5` | — | exact patch |
| `tailwindcss@4` | CSS-first config (no `tailwind.config.js`) | exact patch |
| `drizzle-orm` | ORM, `vector` column type support | exact patch |
| `drizzle-kit` | Migrations, studio, `--custom` generator | exact patch |
| `@neondatabase/serverless` | Pooled HTTP/WS driver for Next.js serverless | exact patch |
| `postgres` | Direct driver — drizzle-kit needs long sessions for migrations | exact patch |
| `zod@4` | Env validation in phase 01; MCP tool schemas in later phases | exact patch |

**Dev:**

| Package | Purpose |
|---|---|
| `vitest@3` | Test runner (smoke test in phase 01; real tests in phase 03+) |
| `eslint` + `eslint-config-next` | Lint |
| `prettier` | Format |
| `@types/node`, `@types/react`, `@types/react-dom` | Types |
| `tsx` | Running TS scripts (`drizzle.config.ts`, future `src/agent/runtime.ts`) |

**Not installed in phase 01** (deliberately deferred):

- `@anthropic-ai/claude-agent-sdk` — phase 05.
- `@google/genai` — phase 03.
- `inngest` — phase 06.
- `better-auth` — phase 11.
- `@langfuse/otel`, `@arizeai/openinference-instrumentation-claude-agent-sdk` — phase 12.

## Toolchain details

**Node:** ≥22 (Next 15 requirement).
**Package manager:** pnpm 9.x. `engines` field in `package.json` enforces both.
**TypeScript config:**
```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "moduleResolution": "bundler",
    "paths": { "@/*": ["./src/*"] }
  }
}
```
`exactOptionalPropertyTypes` intentionally off — historically painful with third-party libs.

**shadcn init command (user-provided preset):**
```bash
pnpm dlx shadcn@latest init --preset b3sPu45W6s --template next
```
Add one component to prove the pipeline:
```bash
pnpm dlx shadcn@latest add button
```
No further UI in this phase.

## Database setup

**Prerequisite:** a Neon account and a project (free tier is enough for the entire roadmap). pgvector must be enabled via the Neon dashboard **before** the migration runs — `CREATE EXTENSION` fails on projects where the extension isn't allow-listed. README documents both steps.

**Two connection URLs** — this is the most common phase-01 pitfall:

- `DATABASE_URL` — Neon **pooled** (`-pooler` in the hostname). Used by Next.js runtime via `@neondatabase/serverless`.
- `DATABASE_URL_UNPOOLED` — Neon **direct**. Used by `drizzle-kit migrate`. Pooled URLs fail on migrations because they can't hold the long transaction drizzle-kit opens.

`src/lib/env.ts` is a zod-validated loader; in phase 01 it validates exactly the two DB URLs below. Subsequent phases extend the schema as new env vars are introduced, so missing config surfaces at process boot, not at first use.

`.env.example`:
```
# Pooled — for Next.js serverless runtime (@neondatabase/serverless)
DATABASE_URL="postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/autoride?sslmode=require"

# Unpooled — for drizzle-kit migrations (postgres driver). Required: drizzle-kit
# cannot run migrations through the Neon pooler — the transaction times out.
DATABASE_URL_UNPOOLED="postgresql://user:pass@ep-xxx.region.aws.neon.tech/autoride?sslmode=require"

# Later phases will append:
#   ANTHROPIC_API_KEY         (phase 05)
#   GOOGLE_GENAI_API_KEY      (phase 03)
#   INNGEST_EVENT_KEY         (phase 06)
#   INNGEST_SIGNING_KEY       (phase 06)
#   BETTER_AUTH_SECRET        (phase 11)
#   BETTER_AUTH_URL           (phase 11)
#   LANGFUSE_PUBLIC_KEY       (phase 12)
#   LANGFUSE_SECRET_KEY       (phase 12)
#   LANGFUSE_BASEURL          (phase 12)
```

**pgvector migration:** `drizzle-kit generate --custom` produces an empty migration scaffold; edit it to contain `CREATE EXTENSION IF NOT EXISTS vector;`. File ends up at `drizzle/0000_enable_vector.sql`.

**drizzle.config.ts:**
```ts
import { defineConfig } from 'drizzle-kit';
import 'dotenv/config';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/*.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED! },
  strict: true,
  verbose: true,
});
```

## `/health` route

Public route handler at `src/app/health/route.ts`. Never gated (even after phase 11 adds auth).

```ts
import { ping, checkExtension } from '@/db/client';
import pkg from '../../../package.json';

export async function GET() {
  const [db, vector] = await Promise.all([ping(), checkExtension('vector')]);
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

`ping()`: `SELECT 1` with 2-second statement timeout; returns `'up'` or `'down'`.
`checkExtension(name)`: `SELECT 1 FROM pg_extension WHERE extname = $1`; returns `'installed'` or `'missing'`.

Status code 503 when either check fails — useful for container / Vercel health probes later.

## Testing

vitest installed in phase 01 (rather than deferring to phase 03) so the first test infrastructure already exists when memory-MCP tests need it.

One smoke test: `tests/health.test.ts` imports the `/health` route handler, invokes it with a mocked `Request`, asserts `status === 200` and response body shape (when Neon is reachable). Documents the pattern for future phases.

## Scripts

`package.json`:
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
  },
  "engines": {
    "node": ">=22",
    "pnpm": ">=9"
  },
  "packageManager": "pnpm@9"
}
```

## Acceptance criteria

All must pass before the phase 01 PR merges:

1. `pnpm install` completes clean on Node ≥22 / pnpm ≥9.
2. `pnpm dev` serves `/` with a minimal shadcn-styled placeholder.
3. `pnpm db:migrate` runs `drizzle/0000_enable_vector.sql` against `DATABASE_URL_UNPOOLED` without error; `SELECT 1 FROM pg_extension WHERE extname='vector'` returns a row.
4. `pnpm db:studio` opens successfully (empty schema view).
5. `GET /health` returns `200` with `{ ok: true, version, checks: { db: "up", vector: "installed" }, ts }`.
6. **Manual failure mode verification:** stopping the Neon project (or temporarily renaming the extension check to a non-existent extension) makes `/health` return `503` with `ok: false` and the correct failing check reflected.
7. `pnpm test` runs vitest; smoke test passes.
8. `pnpm typecheck` succeeds under strict mode.
9. `pnpm lint` succeeds.
10. Worktree git identity verified: `git config user.name` → `shahriarbijoy`, `git config user.email` → `shahriarbijoy@gmail.com`.

## Cross-cutting setup (phase 01 only)

These one-time changes land in phase 01 and don't repeat:

- `.gitignore` extends the existing `*.md` allowlist with `!docs/**/*.md` so design specs and the roadmap commit.
- `README.md` gets a top-level "Quickstart" section documenting:
  - Neon project creation + enabling pgvector in the dashboard
  - `.env.example` → `.env.local` with both pooled and unpooled URLs
  - `pnpm install && pnpm db:migrate && pnpm dev`
  - How to verify `/health`

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Pooled URL used for migrations → transaction timeout | High | `.env.example` comment loudly; drizzle.config.ts explicitly reads `DATABASE_URL_UNPOOLED` |
| pgvector not enabled in Neon dashboard before migration | High | README documents the dashboard toggle step |
| shadcn + Tailwind v4 compat edge cases | Low | User-supplied preset `b3sPu45W6s` pins a known-good config |
| Next 15 + React 19 breaking changes between minor versions | Low | Exact-patch pins, explicit re-pin convention |

## Out-of-band decisions pinned by this phase

- **Repo shape:** flat single-package Next.js (option B), re-evaluated at phase 12 if deploy-split costs matter.
- **Test runner:** vitest (not jest, not node:test).
- **Lint:** `eslint-config-next` baseline (no biome / xo / standard).
- **Env validation:** zod-based loader in `src/lib/env.ts`. Every phase that adds env vars extends that loader; surfaces missing vars at boot, not at first use.

## What unlocks next

Phase 01 passing unlocks phase 02 (schema). Phase 02 uses:
- `drizzle-kit generate` against `src/db/schema/*.ts`
- The `vector` column type from `drizzle-orm/pg-core` (available because the extension is enabled)
- The env loader and Neon client established here
