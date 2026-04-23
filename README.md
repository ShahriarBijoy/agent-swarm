# Auto-ride

An 11-agent Claude Agent SDK swarm with a three-bucket memory system and nightly adversarial cleanup, served from a Next.js 15 webapp.

- Phase roadmap: [`docs/roadmap/ROADMAP.md`](./docs/roadmap/ROADMAP.md)
- Git workflow: [`gitworkflow.md`](./gitworkflow.md)
- Contributor guide: [`CLAUDE.md`](./CLAUDE.md)

## Quickstart (through phase 05)

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
| `pnpm recall:demo` | Seed memories, embed a query via Gemini, print ranked recall (phase 03) |
| `pnpm memory:demo` | End-to-end memory lifecycle dry-run: write six memories, recall with auto-reinforce, explicit reinforce, forget, evaluate promotion proposal, evaluate tombstone-expiry candidate, clean up (phase 04) |
| `pnpm query:demo` | First real `query()`: orchestrator + fleet-analyst subagent + memory MCP + task_events persistence, CLI-driven. Accepts a prompt as argv. Requires Anthropic auth (see quickstart step 7). (phase 05) |

## Phase status

See [`docs/roadmap/ROADMAP.md`](./docs/roadmap/ROADMAP.md) for the 12-phase plan and the current open PR.
