# Git Workflow

Repository: https://github.com/ShahriarBijoy/agent-swarm.git

## Identity

All commits and pushes **must** use this identity:

- **Name:** `shahriarbijoy`
- **Email:** `shahriarbijoy@gmail.com`

Configure once per clone (repo-local, do not rely on global config):

```bash
git config user.name  "shahriarbijoy"
git config user.email "shahriarbijoy@gmail.com"
```

Verify before the first commit in any new clone or worktree:

```bash
git config user.name
git config user.email
```

If either is wrong, fix it **before** committing — rewriting authorship later is painful.

## Phase-based worktree workflow

Auto-ride is built phase by phase. Each implementation phase gets its **own git worktree** under `.worktree/` so multiple phases can run in parallel without stepping on each other's working tree.

### Why worktrees

- Parallel work on several phases without stashing or branch-switching
- Each phase has an isolated `node_modules`, `.next/`, and build state
- The main checkout stays clean and reviewable
- Long-running agent runs in one worktree don't block edits in another

### Directory layout

```
Agent-swarm/                      # main checkout (main branch)
├── .worktree/                    # all phase worktrees live here (gitignored)
│   ├── phase-01-memory-schema/
│   ├── phase-02-orchestrator/
│   └── phase-03-hitl-approvals/
├── gitworkflow.md
└── ...
```

Add `.worktree/` to `.gitignore` in the main checkout so the worktrees are never committed from the parent repo.

### Starting a new phase

From the main checkout, create a worktree on a fresh branch named after the phase:

```bash
# 1. Make sure main is up to date
git switch main
git pull

# 2. Create the worktree + branch in one step
git worktree add .worktree/phase-03-hitl-approvals -b phase/03-hitl-approvals

# 3. Enter the worktree
cd .worktree/phase-03-hitl-approvals

# 4. Confirm identity is correct in the new worktree
git config user.name  "shahriarbijoy"
git config user.email "shahriarbijoy@gmail.com"
```

Branch naming: `phase/<NN>-<short-kebab-description>` (e.g. `phase/03-hitl-approvals`).
Worktree folder: `.worktree/phase-<NN>-<short-kebab-description>`.

### Working inside a worktree

- Commit early, commit often. Prefer small, focused commits over one giant end-of-phase commit.
- Push the phase branch to `origin` on the first commit so it's visible on GitHub:
  ```bash
  git push -u origin phase/03-hitl-approvals
  ```
- Keep the phase branch rebased on `main` if `main` moves while you work:
  ```bash
  git fetch origin
  git rebase origin/main
  ```

### Finishing a phase → open a PR

When the phase is complete (feature works end-to-end, tests pass, self-review done):

```bash
# From inside the worktree
git push

# Open PR via gh CLI
gh pr create \
  --base main \
  --head phase/03-hitl-approvals \
  --title "phase 03: HITL approvals via Inngest waitForEvent" \
  --body  "Implements phase 03 of the Auto-ride roadmap. See auto-ride-initial-plan.md §4."
```

PR requirements:
- Title starts with `phase NN:` so the roadmap maps 1:1 to PRs
- Body links back to the relevant section(s) of `auto-ride-initial-plan.md`
- One PR per phase — do **not** bundle multiple phases in one PR

### After the PR merges

Clean up the worktree and the local branch:

```bash
# From the main checkout (not inside the worktree you're deleting)
cd /w/personal-code/Agent-swarm
git worktree remove .worktree/phase-03-hitl-approvals
git branch -d phase/03-hitl-approvals
git fetch --prune
```

`git worktree remove` refuses to delete a worktree with uncommitted changes — that's the safety net. If you're sure you want to discard work, use `git worktree remove --force`, but think twice.

### Parallel phases

Multiple worktrees can exist at once:

```bash
git worktree list
# /w/personal-code/Agent-swarm                                  abc1234 [main]
# /w/personal-code/Agent-swarm/.worktree/phase-02-orchestrator  def5678 [phase/02-orchestrator]
# /w/personal-code/Agent-swarm/.worktree/phase-03-hitl          9ab0cde [phase/03-hitl-approvals]
```

Each worktree is an independent working directory. Run the Next.js dev server on different ports if you need two phases running simultaneously (`PORT=3001 pnpm dev`, etc.).

## Guardrails

- **Never** force-push to `main`.
- **Never** commit with `--no-verify` unless the user explicitly asks — fix the hook failure instead.
- **Never** run `git worktree remove --force` or `git branch -D` without confirming there's nothing to lose.
- Secrets (`.env*`, API keys, Anthropic tokens) must never be committed. Stage files by name, not `git add -A`.
- Prefer **new commits** over `git commit --amend` once a branch has been pushed.
