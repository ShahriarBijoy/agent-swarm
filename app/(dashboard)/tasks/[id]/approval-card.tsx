'use client';

import { useState, useTransition } from 'react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ClockIcon } from 'lucide-react';
import type { GateSummary } from '@/db/queries/approval-gates';
import { resolveApproval } from './actions';

/**
 * One pending-gate card. Three submit buttons share a single Server
 * Action (`resolveApproval`); the clicked button's `value` populates the
 * `decision` form field. "Modify" reveals a JSON textarea whose contents
 * are validated client-side before the form submits.
 *
 * Styled with the shadcn `Alert` shell (the same primitive ai-elements
 * `Confirmation` builds on) plus the codebase's button.
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
    });
  }

  return (
    <Alert
      data-testid="approval-card"
      data-gate-id={gate.id}
      className="flex flex-col gap-3 border-amber-500/50 bg-amber-50/60"
    >
      <AlertTitle className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <Badge
            variant="secondary"
            className="gap-1.5 rounded-full bg-amber-500/15 text-amber-800"
          >
            <ClockIcon className="size-3.5" />
            Awaiting approval
          </Badge>
          <span className="font-mono text-sm text-foreground">
            {gate.toolName}
          </span>
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {gate.id.slice(0, 8)}
        </span>
      </AlertTitle>

      <AlertDescription className="flex flex-col gap-3">
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
            className="rounded border border-input bg-background px-2 py-1 font-mono text-foreground"
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
              className="rounded border border-input bg-background px-2 py-1 font-mono text-foreground"
              spellCheck={false}
            />
          </label>
        )}

        {errorMsg && (
          <p role="alert" className="text-xs text-destructive">
            {errorMsg}
          </p>
        )}

        <div className="flex flex-wrap gap-2 self-end">
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => handleSubmit('approve')}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            Approve
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => {
              if (showModify) handleSubmit('modify');
              else setShowModify(true);
            }}
          >
            {showModify ? 'Submit modified' : 'Modify…'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={pending}
            onClick={() => handleSubmit('deny')}
          >
            Deny
          </Button>
        </div>
      </AlertDescription>
    </Alert>
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
