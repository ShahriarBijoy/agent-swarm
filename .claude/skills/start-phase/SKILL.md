---
name: start-phase
description: Create a new phase worktree and branch per gitworkflow.md. Usage — `/start-phase <NN> <kebab-description>` (e.g., `/start-phase 03 hitl-approvals`). Sets up `.worktree/phase-<NN>-<kebab>/` on branch `phase/<NN>-<kebab>`, configures repo-local git identity, and pushes the branch to origin.
disable-model-invocation: true
---

# start-phase

Arguments expected via `$ARGUMENTS`: `<NN> <kebab-description>` — two space-separated tokens.

Example: `/start-phase 03 hitl-approvals` → worktree `.worktree/phase-03-hitl-approvals/`, branch `phase/03-hitl-approvals`.

## Steps

1. **Parse arguments.** If fewer than two tokens, stop and ask the user for the phase number and description. `NN` should be zero-padded (e.g., `03`, not `3`). `<kebab-description>` is lowercase-kebab — reject anything else.

2. **Confirm we're in the main checkout**, not an existing worktree:
   ```bash
   git rev-parse --show-toplevel
   git worktree list
   ```
   Abort if the current directory is already a phase worktree — the user should `cd` back to the main checkout first.

3. **Update main:**
   ```bash
   git switch main
   git pull --ff-only
   ```

4. **Create the worktree and branch in one step:**
   ```bash
   git worktree add .worktree/phase-<NN>-<kebab> -b phase/<NN>-<kebab>
   ```

5. **Set repo-local identity inside the new worktree** (never rely on global config):
   ```bash
   git -C .worktree/phase-<NN>-<kebab> config user.name  "shahriarbijoy"
   git -C .worktree/phase-<NN>-<kebab> config user.email "shahriarbijoy@gmail.com"
   ```

6. **Verify identity** — read back both values and show them to the user. Abort if either is wrong.

7. **Push the branch to origin** so it's visible on GitHub from the start:
   ```bash
   git -C .worktree/phase-<NN>-<kebab> push -u origin phase/<NN>-<kebab>
   ```

8. **Report** the absolute path of the new worktree and the branch name. Remind the user they should `cd` into the worktree before editing.

## Guardrails

- Do not overwrite an existing worktree. If `git worktree add` fails because the path exists, report it and stop.
- Do not create a worktree on a branch that already exists remotely — check with `git ls-remote --heads origin phase/<NN>-<kebab>` first.
- Never pass `--force` to any worktree command in this flow.
