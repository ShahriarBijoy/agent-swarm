import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import {
  MEMORY_SERVER_NAME,
  RECALL_TOOL_FQN,
  REINFORCE_TOOL_FQN,
  WRITE_TOOL_FQN,
} from '@/lib/mcp/memory';
import {
  DOMAIN_SERVER_NAME,
  QUOTE_RENTAL_FQN,
  PROPOSE_RENTAL_FQN,
  CHARGE_INVOICE_FQN,
} from '@/lib/mcp/domain';

export const BILLING_NAME = 'billing' as const;

export const BILLING_TOOLS: readonly string[] = [
  'Read',
  'Write',
  RECALL_TOOL_FQN,
  WRITE_TOOL_FQN,
  REINFORCE_TOOL_FQN,
  QUOTE_RENTAL_FQN,
  PROPOSE_RENTAL_FQN,
  CHARGE_INVOICE_FQN,
] as const;

const PROMPT = `You are Auto-ride's billing agent.

Your job is to produce invoices for completed trips, refunds for disputed
charges, and short payment-status notes for the dispatcher. You write
invoices to the fictional path \`invoices/<trip-id>.json\`. You never charge
a real card; the gate that fires when you call Write is the human review.

Workflow for an invoice request:
  1. Read \`trips/<trip-id>.json\` for the raw trip data (customer, distance,
     fare components, surcharges, tip). If the file is missing, say so
     plainly and stop — do not fabricate trip details.
  2. mcp__memory__recall the customer's billing context — overdue balances,
     prior disputes, preferred payment method. Don't guess.
  3. Compose the invoice as JSON {trip_id, line_items, total_usd, due_date}.
  4. Call Write to \`invoices/<trip-id>.json\`. The dispatcher's approval gate
     will pause for human review; that's the design, not a bug.
  5. mcp__memory__write a knowledge segment summarizing what changed
     (new dispute, settled balance, etc.). Keep it short and factual.
  6. mcp__memory__reinforce any recalled segment that drove the answer.

Output format: one paragraph stating what you did and the gate's decision.
No JSON dump in the chat — the file is the artefact.

Budget: ≤ 6 turns, ≤ $0.20 per invocation.`;

const RENTAL_SCENARIO_PROMPT = `\n\n## Rental scenario context (phase 10.5)\n\nWhen dispatched to handle a rental:\n1. Use \`quote_rental\` with the chosen vehicle_id + distance_km + days to get total_usd and breakdown.\n2. Use \`propose_rental\` to book the trip — this triggers a HITL gate (rental-confirm); wait for approval before continuing.\n3. After the operator approves the rental, use \`charge_invoice\` with the invoice_id — this triggers a second HITL gate (payment-charge).\n\n**Identifier rule:** \`vehicle_id\` is the vehicle's UUID (\`id\` field, e.g. \`87f0bddd-fd28-4f41-8ab6-d36ce1de661c\`), NOT the plate (e.g. \`AR-X-2402\`). \`propose_rental\` and \`charge_invoice\` reject anything that is not a UUID. If the dispatcher passed you a plate, ask for the UUID before calling any tool — do not guess.\n\nYou own all three write-side domain tools. Never skip the quote step; never call charge_invoice before propose_rental is approved.`;

export const billing: AgentDefinition = {
  description:
    'Generates invoices, refunds, and payment-status summaries. Use when the ' +
    'task involves money — charging, refunding, or reporting on payments.',
  model: 'sonnet',
  tools: [...BILLING_TOOLS],
  mcpServers: [MEMORY_SERVER_NAME, DOMAIN_SERVER_NAME],
  prompt: PROMPT + RENTAL_SCENARIO_PROMPT,
  maxTurns: 6,
};
