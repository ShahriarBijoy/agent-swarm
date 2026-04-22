---
name: finish-phase
description: Push the current phase branch and open a PR with the required `phase NN:` title and a body linking back to `auto-ride-initial-plan.md`. Usage — `/finish-phase <NN> <short-title>` (e.g., `/finish-phase 03 "HITL approvals via Inngest waitForEvent"`). Run from inside the phase worktree.
disable-model-invocation: true
---

# finish-phase

Arguments expected via `$ARGUMENTS`: `<NN> <short-title-in-quotes>`. The title becomes the suffix after `phase NN:` in the PR title.

Example: `/finish-phase 03 "HITL approvals via Inngest waitForEvent"` → PR title `phase 03: HITL approvals via Inngest waitForEvent`.

## Steps

1. **Confirm we're inside the phase worktree.** Run `git rev-parse --show-toplevel` and verify the path contains `.worktree/phase-<NN>-`. Abort otherwise.

2. **Confirm the branch matches the phase:**
   ```bash
   git symbolic-ref --short HEAD
   ```
   Expect `phase/<NN>-<kebab>`. Abort on mismatch.

3. **Confirm working tree is clean:**
   ```bash
   git status --porcelain
   ```
   If there are uncommitted changes, stop and ask the user to commit or stash — do not auto-stage.

4. **Confirm identity is still correct:**
   ```bash
   git config user.name
   git config user.email
   ```
   Must print `shahriarbijoy` and `shahriarbijoy@gmail.com`. If wrong, stop and ask the user — do not silently fix and re-author commits.

5. **Push (normal, not force):**
   ```bash
   git push
   ```
   If upstream isn't set, fall back to `git push -u origin phase/<NN>-<kebab>`. Never `--force`.

6. **Ask the user which section(s) of `auto-ride-initial-plan.md` this phase implements.** The PR body must cite them. If the user can't name a section, do not invent one — ask them to point at a line range.

7. **Open the PR** with `gh pr create`. The title **must** start with `phase <NN>:` (lowercase `phase`, space, number, colon, space). Use a heredoc for the body:
   ```bash
   gh pr create \
     --base main \
     --head phase/<NN>-<kebab> \
     --title "phase <NN>: <short-title>" \
     --body "$(cat <<'EOF'
   Implements phase <NN> of the Auto-ride roadmap.

   ## Plan reference
   See `auto-ride-initial-plan.md` §<section-from-user>.

   ## Summary
   <1-3 bullets describing what this phase delivers>

   ## Test plan
   - [ ] <manual or automated verification steps>
   EOF
   )"
   ```

8. **Return the PR URL** from `gh pr create` output.

## Guardrails

- Never open a PR that bundles multiple phases — one PR per phase is a hard rule in `gitworkflow.md`.
- Never force-push. If the remote has diverged, stop and ask the user how to reconcile.
- Never pass `--no-verify` to the push command or to any commit you make in this flow.
- If the user's identity is wrong on committed history (check `git log --format='%an <%ae>' main..HEAD`), stop and report — do not rewrite history as part of this skill.
