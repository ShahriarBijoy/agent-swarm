# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Pre-implementation. The repo currently contains planning docs only — no source code yet. The architecture, stack choices, and phase breakdown all live in `@auto-ride-initial-plan.md`; read it before proposing any implementation work. Git workflow rules live in `@gitworkflow.md` and are enforced below.

## Git identity (repo-local, required)

Every commit and push **must** use this identity. Set it per clone/worktree — never rely on global config:

```bash
git config user.name  "shahriarbijoy"
git config user.email "shahriarbijoy@gmail.com"
```

Verify with `git config user.name && git config user.email` before the first commit in any new worktree. Rewriting authorship later is painful.

## Phase-based worktree workflow

Work is structured as numbered phases from `auto-ride-initial-plan.md`. Each phase gets its own git worktree and branch — no work lands on `main` except via PR.

- Worktree path: `.worktree/phase-<NN>-<kebab-description>/` (gitignored)
- Branch name: `phase/<NN>-<kebab-description>`
- Start with `git worktree add .worktree/phase-<NN>-<kebab> -b phase/<NN>-<kebab>`, then re-set identity inside the new worktree
- Push branch to `origin` on the first commit so it's visible on GitHub

Use `/start-phase <NN> <kebab>` to run the setup steps safely.

## PR conventions

- Title **must** start with `phase NN:` — the roadmap maps 1:1 to PRs
- Body **must** link the relevant section(s) of `auto-ride-initial-plan.md`
- One PR per phase — never bundle phases
- Base branch is `main`; head is `phase/<NN>-<kebab>`

Use `/finish-phase <NN>` to open the PR with the correct format.

## Guardrails

- **Never** force-push `main`.
- **Never** use `--no-verify` on commits — fix the hook failure instead.
- **Never** stage with `git add -A` or `git add .` — stage files by name to avoid committing secrets or local cruft.
- **Never** run `git worktree remove --force` or `git branch -D` without confirming there's nothing to lose.
- Prefer **new commits** over `git commit --amend` once a branch has been pushed.
- Secrets (`.env*`, API keys, Anthropic tokens) must never be committed.

A PreToolUse hook blocks the first four automatically; don't try to work around it — adjust the approach.

## .gitignore quirk

The repo's `.gitignore` **excludes all `*.md` files** except `README.md`, `LICENSE.md`, and `gitworkflow.md`. Planning and design docs (`auto-ride-initial-plan.md`, future phase notes, scratch markdown) stay local by design. If a new markdown file is meant to be committed, add an explicit allow line to `.gitignore`.

## Planned stack (for when code begins)

Details, tradeoffs, and all version pins live in `@auto-ride-initial-plan.md`. High-level targets:

- **Runtime:** Next.js 15 App Router on Vercel + a separate Claude Agent SDK process (Vercel Sandbox or Fly.io) — not one combined service. Vercel function timeouts can't hold long-running agent loops.
- **Data:** Neon Postgres + pgvector + Drizzle ORM. Enable vector via a `drizzle-kit generate --custom` migration.
- **Agent SDK:** `@anthropic-ai/claude-agent-sdk` (alpha — pin aggressively). Subagents via the `agents` option only accept short model aliases (`sonnet`|`opus`|`haiku`|`inherit`) — full IDs fail silently.
- **Auth for the SDK:** Personal Max subscription OAuth is acceptable for this project because it is a non-commercial portfolio/personal build — `claude setup-token` output or Max-forwarding proxies are fine for development. Per Anthropic's Feb 2026 terms, Max OAuth is prohibited for *commercial* Agent SDK use; if this project ever crosses that line, switch to `ANTHROPIC_API_KEY` from `console.anthropic.com`.
- **Durability:** Inngest `waitForEvent` for HITL approvals (survives redeploys). Better Auth for webapp auth. Langfuse via `@arizeai/openinference-instrumentation-claude-agent-sdk`.
- **Package manager:** pnpm (plan uses `pnpm dev`).

## Working principles

- When unsure how a phase should be implemented, re-read the relevant section of `auto-ride-initial-plan.md` before writing code — it supersedes earlier assumptions where they disagree.
- Propose a short plan before starting multi-step implementation work; explain tradeoffs when picking between options that the plan doc leaves open.
- Keep commits small and focused within a phase; favor more commits over one end-of-phase dump.
