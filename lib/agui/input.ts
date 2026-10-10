import type { Message } from '@ag-ui/core';

/**
 * Phase 13 — pull the prompt out of an AG-UI `RunAgentInput.messages` list:
 * the text of the most recent `user` message. AG-UI 1.0 user content is
 * either a plain string or an array of input parts; only text parts count.
 * Returns null when there is no user text to run on.
 */
export function lastUserText(messages: readonly Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg || msg.role !== 'user') continue;
    const content = (msg as { content?: unknown }).content;
    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
              .map((part) =>
                typeof part === 'object' &&
                part !== null &&
                (part as { type?: unknown }).type === 'text' &&
                typeof (part as { text?: unknown }).text === 'string'
                  ? (part as { text: string }).text
                  : '',
              )
              .filter((t) => t.length > 0)
              .join('\n')
          : '';
    const trimmed = text.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}
