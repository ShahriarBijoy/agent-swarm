export function UserMessage({
  seq,
  payload,
}: {
  seq: number;
  payload: Record<string, unknown>;
}) {
  const text = extractText(payload);

  return (
    <article
      data-type="user_message"
      className="flex flex-col gap-1 rounded-md border border-border bg-muted/40 p-4"
    >
      <header className="flex items-baseline justify-between text-xs text-muted-foreground">
        <span className="uppercase tracking-wide">user</span>
        <span className="font-mono">{`seq=${seq}`}</span>
      </header>
      <p className="text-sm whitespace-pre-wrap">{text}</p>
    </article>
  );
}

function extractText(payload: Record<string, unknown>): string {
  const message = payload.message as { content?: unknown } | undefined;
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const texts = content
      .filter(
        (b): b is { type: 'text'; text: string } =>
          typeof b === 'object' &&
          b !== null &&
          (b as { type?: unknown }).type === 'text',
      )
      .map((b) => b.text);
    if (texts.length > 0) return texts.join('\n');
  }
  return JSON.stringify(message ?? payload, null, 2);
}
