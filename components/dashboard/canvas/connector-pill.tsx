export function ConnectorPill({ reason, tone }: { reason: string; tone: 'cool' | 'warm' | 'lit' }) {
  const cls =
    tone === 'lit' ? 'bg-[var(--color-lime)] border-[var(--color-lime)] text-[var(--color-ink)] font-bold'
    : tone === 'warm' ? 'border-[var(--color-red)] text-[var(--color-red)] bg-[var(--color-surface)]'
    : 'border-[var(--color-line-strong)] text-[var(--color-muted)] bg-[var(--color-surface)]';
  return (
    <span className={`rounded-full border px-2 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.18em] ${cls}`}>
      {reason}
    </span>
  );
}
