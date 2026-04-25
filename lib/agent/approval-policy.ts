/**
 * Phase-07 approval policy: deterministic, side-effect-free decision about
 * whether a tool invocation must pause for human approval before the SDK
 * actually runs it.
 *
 * Pure function — kept away from the canUseTool callback (which deals with
 * Inngest + DB) so it's trivially table-testable.
 */

const INPUT_PREVIEW_LIMIT = 80;

export type ApprovalDecisionHint =
  | { require: false }
  | { require: true; reason: string };

/**
 * Whitelisted Bash commands. Phase 07 keeps this tight — only read-only
 * observability + the project's own pnpm scripts. Anything else trips the
 * gate. Extend by adding a regex; never weaken.
 */
export const BASH_WHITELIST: readonly RegExp[] = [
  /^ls(\s|$)/,
  /^pwd(\s|$)/,
  /^echo\s/,
  /^cat\s/,
  /^node\s+--version(\s|$)/,
  /^git\s+(status|log|show|diff|branch|rev-parse)(\s|$)/,
  /^pnpm\s+(test|test:watch|typecheck|lint|build|format)(\s|$)/,
];

export function shouldRequireApproval(
  toolName: string,
  input: unknown,
): ApprovalDecisionHint {
  // 1. Payment tools always gate.
  if (toolName.startsWith('mcp__stripe__')) {
    return { require: true, reason: 'Payment tool — always gated.' };
  }

  // 2. Bash with non-whitelisted commands gates.
  if (toolName === 'Bash') {
    const cmd = readString(input, 'command');
    if (cmd === null) {
      return { require: true, reason: 'Bash without a command field.' };
    }
    if (isWhitelistedBash(cmd)) return { require: false };
    return {
      require: true,
      reason: `Non-whitelisted Bash: ${truncate(cmd, INPUT_PREVIEW_LIMIT)}`,
    };
  }

  // 3. Write to source tree gates. Other writes (docs, /tmp) pass.
  if (toolName === 'Write') {
    const path = readString(input, 'file_path');
    if (path === null) {
      return { require: true, reason: 'Write without a file_path field.' };
    }
    if (isSourcePath(path)) {
      return { require: true, reason: `Write to source tree: ${path}` };
    }
    return { require: false };
  }

  // 4. Any MCP tool annotated `requiresApproval: true` (phase-08 hook —
  // currently the SDK doesn't surface annotations to canUseTool, so this
  // branch never fires today; left as a documented extension point).
  // ---

  // 5. Default: pass-through. Read, Agent, recall/write/reinforce/forget
  // memory tools are all unrestricted.
  return { require: false };
}

export function isWhitelistedBash(command: string): boolean {
  const trimmed = command.trim();
  if (trimmed === '') return false;
  return BASH_WHITELIST.some((rx) => rx.test(trimmed));
}

export function isSourcePath(path: string): boolean {
  // Match `src/...` at the root or anywhere in the path. Catches both POSIX
  // (`src/foo.ts`) and Windows (`src\foo.ts`) separators, plus nested
  // `packages/x/src/...` layouts.
  return /(^|[\\/])src[\\/]/.test(path);
}

function readString(input: unknown, key: string): string | null {
  if (typeof input !== 'object' || input === null) return null;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return value.slice(0, limit) + `…(+${value.length - limit})`;
}
