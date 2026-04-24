export function CompactBoundary({
  seq,
  payload,
}: {
  seq: number;
  payload: Record<string, unknown>;
}) {
  const meta = payload.compact_metadata as
    | { trigger?: string; pre_tokens?: number; [k: string]: unknown }
    | undefined;
  const trigger = meta?.trigger ?? 'unknown';

  return (
    <div
      data-type="compact_boundary"
      className="flex items-center gap-2 py-2 text-xs text-muted-foreground"
    >
      <hr className="flex-1 border-border" />
      <span className="whitespace-nowrap font-mono">
        {`compact · trigger=${trigger} · seq=${seq}`}
      </span>
      <hr className="flex-1 border-border" />
    </div>
  );
}
