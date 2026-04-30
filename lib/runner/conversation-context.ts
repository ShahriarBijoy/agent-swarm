import { getEventsSince, type TaskEventRow } from '@/db/queries/task-api';
import { listTasksForConversation } from '@/db/queries/conversations';

/**
 * Phase 11.5 — Build a prior-turns context block for a chat follow-up.
 *
 * The Claude Agent SDK does not auto-resume sessions across `query()` calls
 * in this codebase, so a follow-up task starts a fresh dispatcher with no
 * memory of the prior turns. We feed the dispatcher the user's earlier
 * prompts and the dispatcher's final replies as a Markdown block prepended
 * to the new prompt. Tool calls and worker chatter are intentionally elided
 * — the dispatcher gets the *outcome* of each turn, not the trace.
 *
 * Returns an empty string if there are no completed prior turns (e.g. the
 * conversation only has the current queued task), so the caller can safely
 * concatenate.
 */
export async function buildConversationContext(args: {
  conversationId: string;
  /** Exclude this taskId from the context so the new turn isn't replayed back at the dispatcher. */
  excludeTaskId?: string;
  /** How many prior turns to include. Older turns get dropped from the head. */
  maxTurns?: number;
}): Promise<string> {
  const tasks = await listTasksForConversation(args.conversationId);
  const completed = tasks.filter(
    (t) =>
      t.id !== args.excludeTaskId &&
      (t.status === 'done' || t.status === 'failed'),
  );
  if (completed.length === 0) return '';

  const maxTurns = args.maxTurns ?? 8;
  const recent = completed.slice(-maxTurns);

  const lines: string[] = [];
  lines.push('## Prior conversation in this thread');
  lines.push('');
  lines.push(
    'These turns already happened with the same customer. Use them as ' +
      'context — do not re-dispatch workers for facts already established. ' +
      'The dispatcher reply field is what the customer last saw on screen.',
  );
  lines.push('');

  for (let i = 0; i < recent.length; i += 1) {
    const task = recent[i]!;
    const userPrompt = stripScenarioPrefix(task.prompt);
    const finalText = await getDispatcherFinalText(task.id);
    lines.push(`### Turn ${i + 1}`);
    lines.push('');
    lines.push(`**Customer:** ${truncate(userPrompt, 1200)}`);
    lines.push('');
    if (finalText) {
      lines.push(`**Dispatcher reply:** ${truncate(finalText, 1500)}`);
      lines.push('');
    } else if (task.status === 'failed') {
      lines.push('**Dispatcher reply:** _(turn failed before producing a reply)_');
      lines.push('');
    }
  }

  lines.push('---');
  lines.push('');
  lines.push("## New customer message");
  lines.push('');
  return lines.join('\n');
}

/**
 * The chat path stores prompts with a `[scenario] customer_email=…` prefix
 * and a blank line separating the user text. Strip it for the prior-turn
 * context block — the customer email is already covered by the new prompt's
 * own scenario prefix, and the old prefix would just be noise.
 */
function stripScenarioPrefix(prompt: string): string {
  const m = /^\[scenario\][^\n]*\n+/u.exec(prompt);
  if (!m) return prompt.trim();
  return prompt.slice(m[0].length).trim();
}

/**
 * Pull the dispatcher's last final text from a task by reading the most
 * recent `run_result` event with `subtype: 'success'`. Returns null if the
 * task failed or didn't produce a final text.
 */
async function getDispatcherFinalText(taskId: string): Promise<string | null> {
  const events = await getEventsSince({
    taskId,
    afterId: 0n,
    limit: 500,
  });
  // Walk newest → oldest looking for a successful run_result.
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i]!;
    if (ev.type !== 'run_result') continue;
    const result = readRunResult(ev);
    if (result) return result;
  }
  return null;
}

function readRunResult(ev: TaskEventRow): string | null {
  const payload = ev.payload as {
    subtype?: unknown;
    result?: unknown;
  };
  if (payload.subtype !== 'success') return null;
  if (typeof payload.result !== 'string') return null;
  return payload.result.trim() || null;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}
