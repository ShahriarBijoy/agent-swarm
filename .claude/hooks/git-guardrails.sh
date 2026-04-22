#!/usr/bin/env bash
# PreToolUse/Bash guardrail: enforces the rules in gitworkflow.md.
# Reads the hook payload on stdin and denies commands that violate:
#   - git add -A / git add --all / git add .      (stage files by name instead)
#   - --no-verify on any git command              (fix the hook, don't bypass)
#   - git push --force* to main                   (never force-push main)
#   - git worktree remove --force                 (don't discard uncommitted work)
#   - git branch -D                               (don't force-delete branches)
# Uses node (this project requires Node.js) for JSON parsing.

set -euo pipefail

cmd=$(node -e '
let s = "";
process.stdin.on("data", d => s += d);
process.stdin.on("end", () => {
  try {
    const p = JSON.parse(s);
    process.stdout.write((p.tool_input && p.tool_input.command) || "");
  } catch (_) {}
});
')

if [[ -z "$cmd" ]]; then
  exit 0
fi

deny() {
  local reason="$1"
  node -e '
const r = process.argv[1];
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: r
  }
}));
' "$reason"
  exit 0
}

# 1. git add -A | --all | .
if [[ "$cmd" =~ (^|[[:space:]])git[[:space:]]+add[[:space:]]+(-A|--all|\.)([[:space:]]|$) ]]; then
  deny "git-guardrails: gitworkflow.md forbids 'git add -A' / 'git add --all' / 'git add .'. Stage files by name to avoid committing secrets or local cruft."
fi

# 2. --no-verify on any git invocation
if [[ "$cmd" =~ (^|[[:space:]])git[[:space:]].*--no-verify([[:space:]]|=|$) ]]; then
  deny "git-guardrails: gitworkflow.md forbids --no-verify. Fix the failing hook instead of bypassing it."
fi

# 3. force-push to main (all flavors of force flag)
if [[ "$cmd" =~ (^|[[:space:]])git[[:space:]]+push ]]; then
  if [[ "$cmd" =~ (--force([[:space:]=]|$)|--force-with-lease([[:space:]=]|$)|[[:space:]]-f([[:space:]]|$)) ]]; then
    if [[ "$cmd" =~ (^|[[:space:]:/])main([[:space:]]|$) ]] || [[ "$cmd" =~ HEAD:main ]] || [[ "$cmd" =~ :refs/heads/main ]]; then
      deny "git-guardrails: never force-push to main (gitworkflow.md Guardrails)."
    fi
  fi
fi

# 4. git worktree remove --force | -f
if [[ "$cmd" =~ (^|[[:space:]])git[[:space:]]+worktree[[:space:]]+remove.*(--force([[:space:]]|$)|[[:space:]]-f([[:space:]]|$)) ]]; then
  deny "git-guardrails: 'git worktree remove --force' discards uncommitted work. Inspect the worktree first and commit or stash anything you want to keep."
fi

# 5. git branch -D (force-delete)
if [[ "$cmd" =~ (^|[[:space:]])git[[:space:]]+branch[[:space:]]+-D([[:space:]]|$) ]]; then
  deny "git-guardrails: 'git branch -D' force-deletes an unmerged branch. Use 'git branch -d' or confirm with the user first (gitworkflow.md Guardrails)."
fi

exit 0
