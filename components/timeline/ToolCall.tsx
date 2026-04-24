export function ToolCall({
  seq,
  payload,
}: {
  seq: number;
  payload: Record<string, unknown>;
}) {
  const toolName = String(payload.tool_name ?? '?');
  const toolUseId = String(payload.tool_use_id ?? '');
  const input = payload.input ?? {};
  const inputPretty = JSON.stringify(input, null, 2);
  const inputPreview = previewOf(input);

  return (
    <article
      data-type="tool_call"
      className="flex flex-col gap-1 rounded-md border-l-2 border-primary/40 bg-muted/30 px-4 py-2"
    >
      <header className="flex items-baseline justify-between text-xs text-muted-foreground">
        <span className="font-mono">
          <span className="uppercase tracking-wide">tool_call</span>{' '}
          <span className="text-foreground">{toolName}</span>
          {inputPreview && (
            <span className="text-muted-foreground">{`(${inputPreview})`}</span>
          )}
        </span>
        <span className="font-mono">{`seq=${seq}`}</span>
      </header>
      <details className="text-xs">
        <summary className="cursor-pointer select-none text-muted-foreground">
          input · {toolUseId}
        </summary>
        <pre className="mt-1 whitespace-pre-wrap rounded bg-muted p-2 font-mono text-xs">
          {inputPretty}
        </pre>
      </details>
    </article>
  );
}

function previewOf(input: unknown): string {
  if (typeof input !== 'object' || input === null) return '';
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length === 0) return '';
  const first = entries[0]!;
  const [k, v] = first;
  const vStr =
    typeof v === 'string' ? `"${truncate(v, 40)}"` : truncate(String(v), 40);
  const rest = entries.length > 1 ? `, +${entries.length - 1}` : '';
  return `${k}: ${vStr}${rest}`;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '…';
}
