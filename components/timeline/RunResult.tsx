export function RunResult({
  seq,
  payload,
}: {
  seq: number;
  payload: Record<string, unknown>;
}) {
  const subtype = String(payload.subtype ?? '?');
  const isSuccess = subtype === 'success';
  const cost = Number(payload.total_cost_usd ?? 0);
  const turns = Number(payload.num_turns ?? 0);
  const durationMs = Number(payload.duration_ms ?? 0);
  const result =
    typeof payload.result === 'string' ? payload.result : null;
  const errors = Array.isArray(payload.errors)
    ? (payload.errors as string[])
    : null;

  return (
    <article
      data-type="run_result"
      className={`flex flex-col gap-2 rounded-md border p-4 ${
        isSuccess
          ? 'border-primary/40 bg-primary/5'
          : 'border-destructive/40 bg-destructive/5'
      }`}
    >
      <header className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-3">
          <span
            className={`rounded px-2 py-0.5 font-mono text-xs uppercase tracking-wide ${
              isSuccess
                ? 'bg-primary/20 text-primary'
                : 'bg-destructive/20 text-destructive'
            }`}
          >
            {subtype}
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            {`$${cost.toFixed(4)} · turns=${turns} · ${(durationMs / 1000).toFixed(1)}s`}
          </span>
        </div>
        <span className="font-mono text-xs text-muted-foreground">{`seq=${seq}`}</span>
      </header>
      {result && (
        <p className="text-sm whitespace-pre-wrap leading-relaxed">{result}</p>
      )}
      {errors && errors.length > 0 && (
        <div className="rounded bg-destructive/10 p-2 text-xs text-destructive">
          <div className="mb-1 font-mono uppercase tracking-wide">errors</div>
          <ul className="list-disc space-y-0.5 pl-5">
            {errors.map((e, i) => (
              <li key={i} className="font-mono">
                {e}
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}
