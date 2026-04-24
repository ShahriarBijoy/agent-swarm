import type { ApprovalRequestPayload } from './types';

/**
 * Inline timeline card for the approval lifecycle. Renders two visual
 * variants based on `payload.subtype`:
 *  - `opened`: amber border, "Awaiting approval" badge, expandable JSON
 *    preview of the proposed input.
 *  - `resolved`: status-tinted border (green / amber / red), the decision
 *    badge, optional reviewer note.
 *
 * The floating <ApprovalBar> sits above the timeline and dismisses when
 * the gate resolves; the inline card here keeps the historical record
 * after the bar disappears.
 */
export function ApprovalRequest({
  seq,
  payload,
}: {
  seq: number;
  payload: Record<string, unknown>;
}) {
  // The wire payload is loose; narrow it before reading.
  const p = payload as unknown as ApprovalRequestPayload;
  if (!isApprovalPayload(p)) return null;

  if (p.subtype === 'opened') {
    return <ApprovalOpened seq={seq} payload={p} />;
  }
  return <ApprovalResolved seq={seq} payload={p} />;
}

function ApprovalOpened({
  seq,
  payload,
}: {
  seq: number;
  payload: Extract<ApprovalRequestPayload, { subtype: 'opened' }>;
}) {
  const inputPretty = JSON.stringify(payload.proposed_input, null, 2);
  return (
    <article
      data-type="approval_request"
      data-subtype="opened"
      data-gate-id={payload.gate_id}
      className="flex flex-col gap-1 rounded-md border-l-4 border-amber-500 bg-amber-500/5 px-4 py-2"
    >
      <header className="flex items-baseline justify-between text-xs">
        <span className="font-mono">
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
            awaiting approval
          </span>{' '}
          <span className="text-foreground">{payload.tool_name}</span>
        </span>
        <span className="font-mono text-muted-foreground">{`seq=${seq}`}</span>
      </header>
      {payload.reason && (
        <p className="text-xs text-muted-foreground">{payload.reason}</p>
      )}
      <details className="text-xs">
        <summary className="cursor-pointer select-none text-muted-foreground">
          proposed input
        </summary>
        <pre className="mt-1 whitespace-pre-wrap rounded bg-muted p-2 font-mono text-xs">
          {inputPretty}
        </pre>
      </details>
    </article>
  );
}

function ApprovalResolved({
  seq,
  payload,
}: {
  seq: number;
  payload: Extract<ApprovalRequestPayload, { subtype: 'resolved' }>;
}) {
  const styles = decisionStyles(payload.decision);
  const modifiedJson =
    payload.decision === 'modified' && payload.modified_input
      ? JSON.stringify(payload.modified_input, null, 2)
      : null;
  return (
    <article
      data-type="approval_request"
      data-subtype="resolved"
      data-gate-id={payload.gate_id}
      className={`flex flex-col gap-1 rounded-md border-l-4 px-4 py-2 ${styles.container}`}
    >
      <header className="flex items-baseline justify-between text-xs">
        <span className="font-mono">
          <span
            className={`rounded px-1.5 py-0.5 font-semibold uppercase tracking-wide ${styles.badge}`}
          >
            {payload.decision}
          </span>
        </span>
        <span className="font-mono text-muted-foreground">{`seq=${seq}`}</span>
      </header>
      {payload.reason && (
        <p className="text-xs text-muted-foreground">{payload.reason}</p>
      )}
      {modifiedJson && (
        <details className="text-xs">
          <summary className="cursor-pointer select-none text-muted-foreground">
            modified input
          </summary>
          <pre className="mt-1 whitespace-pre-wrap rounded bg-muted p-2 font-mono text-xs">
            {modifiedJson}
          </pre>
        </details>
      )}
    </article>
  );
}

function decisionStyles(decision: 'approved' | 'modified' | 'denied'): {
  container: string;
  badge: string;
} {
  switch (decision) {
    case 'approved':
      return {
        container: 'border-emerald-500 bg-emerald-500/5',
        badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
      };
    case 'modified':
      return {
        container: 'border-sky-500 bg-sky-500/5',
        badge: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
      };
    case 'denied':
      return {
        container: 'border-rose-500 bg-rose-500/5',
        badge: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
      };
  }
}

function isApprovalPayload(value: unknown): value is ApprovalRequestPayload {
  if (typeof value !== 'object' || value === null) return false;
  const subtype = (value as { subtype?: unknown }).subtype;
  return subtype === 'opened' || subtype === 'resolved';
}
