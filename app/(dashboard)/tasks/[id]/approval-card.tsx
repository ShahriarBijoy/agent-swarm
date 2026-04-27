'use client';

import { useState, useTransition } from 'react';
import type { GateSummary } from '@/db/queries/approval-gates';
import { resolveApproval } from './actions';

/**
 * One pending-gate card. Three submit buttons share a single Server
 * Action (`resolveApproval`); the clicked button's `value` populates the
 * `decision` form field. "Modify" reveals a JSON textarea whose contents
 * are validated client-side before the form submits.
 */
export function ApprovalCard({ gate }: { gate: GateSummary }) {
  const [reason, setReason] = useState('');
  const [modifiedInput, setModifiedInput] = useState(() =>
    JSON.stringify(gate.proposedInput, null, 2),
  );
  const [showModify, setShowModify] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(decision: 'approve' | 'modify' | 'deny') {
    const fd = new FormData();
    fd.set('gateId', gate.id);
    fd.set('decision', decision);
    if (reason.trim()) fd.set('reason', reason.trim());
    if (decision === 'modify') {
      try {
        // Reject + warn before round-tripping to the server.
        JSON.parse(modifiedInput);
      } catch (err) {
        setErrorMsg(
          `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }
      fd.set('modifiedInput', modifiedInput);
    }
    setErrorMsg(null);
    startTransition(async () => {
      const result = await resolveApproval(fd);
      if (!result.ok) {
        setErrorMsg(formatError(result));
      }
      // On ok: the SSE stream's `approval_request:resolved` event drops
      // this card from the bar via revalidatePath + the parent's effect.
    });
  }

  return (
    <article
      data-testid="approval-card"
      data-gate-id={gate.id}
      className="flex flex-col gap-3 rounded-md border border-amber-500/50 bg-amber-500/5 p-4"
    >
      <header className="flex items-baseline justify-between text-sm">
        <span className="font-mono text-amber-700 dark:text-amber-300">
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-semibold uppercase tracking-wide">
            awaiting approval
          </span>{' '}
          <span className="text-foreground">{gate.toolName}</span>
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {gate.id.slice(0, 8)}
        </span>
      </header>

      <details className="text-xs">
        <summary className="cursor-pointer select-none text-muted-foreground">
          proposed input
        </summary>
        <pre className="mt-1 whitespace-pre-wrap rounded bg-muted p-2 font-mono">
          {JSON.stringify(gate.proposedInput, null, 2)}
        </pre>
      </details>

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">reason (optional)</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className="rounded border border-input bg-background px-2 py-1 font-mono"
          placeholder="why approve / modify / deny?"
        />
      </label>

      {showModify && (
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">modified input (JSON)</span>
          <textarea
            value={modifiedInput}
            onChange={(e) => setModifiedInput(e.target.value)}
            rows={6}
            className="rounded border border-input bg-background px-2 py-1 font-mono"
            spellCheck={false}
          />
        </label>
      )}

      {errorMsg && (
        <p
          role="alert"
          className="text-xs text-rose-600 dark:text-rose-400"
        >
          {errorMsg}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => handleSubmit('approve')}
          className="rounded bg-emerald-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
        >
          Approve
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (showModify) handleSubmit('modify');
            else setShowModify(true);
          }}
          className="rounded bg-sky-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
        >
          {showModify ? 'Submit modified' : 'Modify…'}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => handleSubmit('deny')}
          className="rounded bg-rose-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
        >
          Deny
        </button>
      </div>
    </article>
  );
}

function formatError(result: {
  error: string;
  message?: string;
  status?: string;
}): string {
  switch (result.error) {
    case 'gate_already_resolved':
      return `Gate already resolved (status: ${result.status ?? '?'}).`;
    case 'gate_not_found':
      return 'Gate not found — it may have timed out.';
    case 'invalid_modified_input':
      return result.message ?? 'Invalid modified input.';
    case 'invalid_body':
      return 'Invalid form data — refresh the page.';
    default:
      return `Unexpected error: ${result.error}`;
  }
}
