'use client';

import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
} from '@/components/ai-elements/tool';
import type { ApprovalRequestPayload } from './types';

/**
 * Inline timeline card for the approval lifecycle. Renders two visual
 * variants based on `payload.subtype`:
 *  - `opened`: Tool block with state="approval-requested" and the
 *    proposed input expanded as JSON.
 *  - `resolved`: Tool block whose state mirrors the decision (approved/
 *    modified → "approval-responded", denied → "output-denied"), with
 *    optional reviewer note + modified-input block.
 *
 * The floating <ApprovalCard> sits above the timeline and dismisses when
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
  return (
    <div
      data-type="approval_request"
      data-subtype="opened"
      data-gate-id={payload.gate_id}
    >
      <Tool defaultOpen={false} className="mb-0">
        <ToolHeader
          type="dynamic-tool"
          toolName={payload.tool_name}
          state="approval-requested"
          title={`${payload.tool_name} · seq=${seq}`}
        />
        <ToolContent>
          {payload.reason && (
            <p className="text-xs text-muted-foreground">{payload.reason}</p>
          )}
          <ToolInput input={payload.proposed_input} />
        </ToolContent>
      </Tool>
    </div>
  );
}

function ApprovalResolved({
  seq,
  payload,
}: {
  seq: number;
  payload: Extract<ApprovalRequestPayload, { subtype: 'resolved' }>;
}) {
  const state =
    payload.decision === 'denied' ? 'output-denied' : 'approval-responded';
  return (
    <div
      data-type="approval_request"
      data-subtype="resolved"
      data-gate-id={payload.gate_id}
    >
      <Tool defaultOpen={false} className="mb-0">
        <ToolHeader
          type="dynamic-tool"
          toolName={payload.decision}
          state={state}
          title={`${payload.decision} · seq=${seq}`}
        />
        <ToolContent>
          {payload.reason && (
            <p className="text-xs text-muted-foreground">{payload.reason}</p>
          )}
          {payload.decision === 'modified' && payload.modified_input && (
            <ToolInput input={payload.modified_input} />
          )}
        </ToolContent>
      </Tool>
    </div>
  );
}

function isApprovalPayload(value: unknown): value is ApprovalRequestPayload {
  if (typeof value !== 'object' || value === null) return false;
  const subtype = (value as { subtype?: unknown }).subtype;
  return subtype === 'opened' || subtype === 'resolved';
}
