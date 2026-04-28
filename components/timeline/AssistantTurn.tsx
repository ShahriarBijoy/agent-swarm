import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@/components/ai-elements/reasoning';

type AssistantContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: string; [k: string]: unknown };

function extractBlocks(payload: Record<string, unknown>): AssistantContentBlock[] {
  const message = payload.message as { content?: unknown } | undefined;
  const content = message?.content;
  if (Array.isArray(content)) return content as AssistantContentBlock[];
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return [];
}

export function AssistantTurn({
  seq,
  payload,
}: {
  seq: number;
  payload: Record<string, unknown>;
}) {
  const blocks = extractBlocks(payload);
  const textBlocks = blocks.filter(
    (b): b is { type: 'text'; text: string } => b.type === 'text',
  );
  const thinkingBlocks = blocks.filter(
    (b): b is { type: 'thinking'; thinking: string } => b.type === 'thinking',
  );
  const thinkingText = thinkingBlocks.map((b) => b.thinking).join('\n\n');

  return (
    <article
      data-type="assistant_turn"
      className="flex flex-col gap-2 rounded-md border border-border bg-card p-4 text-card-foreground"
    >
      <header className="flex items-baseline justify-between text-xs text-muted-foreground">
        <span className="uppercase tracking-wide">assistant</span>
        <span className="font-mono">{`seq=${seq}`}</span>
      </header>
      {thinkingText && (
        <Reasoning className="mb-0" defaultOpen={false}>
          <ReasoningTrigger />
          <ReasoningContent>{thinkingText}</ReasoningContent>
        </Reasoning>
      )}
      {textBlocks.length > 0 ? (
        <div className="space-y-2 text-sm leading-relaxed">
          {textBlocks.map((b, i) => (
            <p key={i} className="whitespace-pre-wrap">
              {b.text}
            </p>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground italic">
          (no text blocks — tool_use shown separately below)
        </p>
      )}
    </article>
  );
}
