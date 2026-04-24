export function ToolResult({
  seq,
  payload,
}: {
  seq: number;
  payload: Record<string, unknown>;
}) {
  const toolUseId = String(payload.tool_use_id ?? '');
  const isError = payload.is_error === true;
  const content = payload.content;
  const contentText = stringifyContent(content);
  const preview = truncate(contentText, 160);

  return (
    <article
      data-type="tool_result"
      className={`flex flex-col gap-1 rounded-md border-l-2 px-4 py-2 ${
        isError ? 'border-destructive/60 bg-destructive/5' : 'border-border bg-background'
      }`}
    >
      <header className="flex items-baseline justify-between text-xs text-muted-foreground">
        <span className="font-mono">
          <span className="uppercase tracking-wide">tool_result</span>{' '}
          {isError && (
            <span className="rounded bg-destructive/20 px-1 text-destructive">
              error
            </span>
          )}{' '}
          <span className="text-foreground">{toolUseId}</span>
        </span>
        <span className="font-mono">{`seq=${seq}`}</span>
      </header>
      <p className="text-xs whitespace-pre-wrap">{preview}</p>
      {contentText.length > preview.length && (
        <details className="text-xs">
          <summary className="cursor-pointer select-none text-muted-foreground">
            full output
          </summary>
          <pre className="mt-1 whitespace-pre-wrap rounded bg-muted p-2 font-mono text-xs">
            {contentText}
          </pre>
        </details>
      )}
    </article>
  );
}

function stringifyContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    // Claude content blocks: [{type:'text', text:'...'}]
    const textBlocks = content
      .filter(
        (b): b is { type: 'text'; text: string } =>
          typeof b === 'object' &&
          b !== null &&
          (b as { type?: unknown }).type === 'text',
      )
      .map((b) => b.text);
    if (textBlocks.length > 0) return textBlocks.join('\n');
  }
  return JSON.stringify(content, null, 2);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '…';
}
