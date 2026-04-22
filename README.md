# Auto-ride

An 11-agent Claude Agent SDK swarm with a three-bucket memory system and nightly adversarial cleanup, served from a Next.js 15 webapp.

- Phase roadmap: [`docs/roadmap/ROADMAP.md`](./docs/roadmap/ROADMAP.md)
- Git workflow: [`gitworkflow.md`](./gitworkflow.md)
- Contributor guide: [`CLAUDE.md`](./CLAUDE.md)

## Quickstart (through phase 02)

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

   After phase 02, `pnpm db:migrate` also creates the nine core tables (`memories`, `memory_segment_config`, `memory_links`, `memory_cleanup_runs`, `memory_cleanup_proposals`, `tasks`, `task_runs`, `task_events`, `approval_gates`) and seeds seven `memory_segment_config` rows. Verify with `pnpm db:studio` or:
   ```sql
   SELECT segment, default_importance FROM memory_segment_config ORDER BY default_importance DESC;
   -- 7 rows, identity 0.90 → context 0.40
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
