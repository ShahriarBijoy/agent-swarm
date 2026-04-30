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
      <Tool defaultOpen={true} className="mb-0">
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
          {renderProposedInput(payload.tool_name, payload.proposed_input)}
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
      <Tool defaultOpen={true} className="mb-0">
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

function renderProposedInput(
  toolName: string,
  input: Record<string, unknown>
) {
  if (toolName === 'mcp__auto-ride-domain__propose_rental') {
    const i = input as {
      vehicle_id: string;
      customer_id: string;
      distance_km: number;
      total_usd: number;
      scheduled_start_at: string;
      scheduled_end_at: string;
    };
    return (
      <div className="space-y-2 text-sm">
        <div className="font-medium">Rental confirmation</div>
        <div>
          Vehicle <code>{i.vehicle_id.slice(0, 8)}</code>
        </div>
        <div>
          Customer <code>{i.customer_id.slice(0, 8)}</code>
        </div>
        <div>Distance: {i.distance_km} km</div>
        <div>
          Window:{' '}
          {new Date(i.scheduled_start_at).toLocaleString()} →{' '}
          {new Date(i.scheduled_end_at).toLocaleString()}
        </div>
        <div className="font-mono text-base">
          Total: ${i.total_usd.toFixed(2)}
        </div>
      </div>
    );
  }
  if (toolName === 'mcp__auto-ride-domain__charge_invoice') {
    const i = input as { invoice_id: string };
    return (
      <div className="space-y-2 text-sm">
        <div className="font-medium">Payment charge</div>
        <div>
          Invoice <code>{i.invoice_id.slice(0, 8)}</code>
        </div>
        <div className="text-xs opacity-70">
          Marks invoice as paid; no real card capture in v0.
        </div>
      </div>
    );
  }
  return <ToolInput input={input} />;
}

function isApprovalPayload(value: unknown): value is ApprovalRequestPayload {
  if (typeof value !== 'object' || value === null) return false;
  const subtype = (value as { subtype?: unknown }).subtype;
  return subtype === 'opened' || subtype === 'resolved';
}
