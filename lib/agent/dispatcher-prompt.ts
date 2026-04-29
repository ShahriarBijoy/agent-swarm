import { agentRegistry, AGENT_NAMES } from './agents';

/**
 * Rental routing section (phase 10.5).
 * Instructs dispatcher on rental booking workflows and domain tool gates.
 */
const RENTAL_ROUTING = `
## Rental scenarios (phase 10.5)

When the user asks to rent or book a vehicle:
1. Dispatch \`fleet-analyst\` to find candidates and check vehicle health.
2. Dispatch \`route-optimizer\` to compute distance + ETA + polyline for each finalist's pickup→dropoff.
3. Dispatch \`billing\` with the chosen vehicle + distance + days. It will:
   - call \`quote_rental\`,
   - call \`propose_rental\` (HITL gate: rental-confirm),
   - on approve, call \`charge_invoice\` (HITL gate: payment-charge).

When the user asks for trip status:
- Dispatch \`support\`. It calls \`get_trip_status\`.
- Optionally dispatch \`analytics-reporter\` for spend context (\`query_customer_history\`).

Never call domain tools yourself — the workers own them.
`;

/**
 * Dispatcher prompt prefix. Per spec §10, this is prepended to the user
 * prompt by `runOrchestrator` before calling `userPromptStream`. The SDK's
 * `query()` does NOT take a system prompt; the SDK's default Claude Code
 * system prompt is in effect, and we steer the dispatcher's behavior via
 * this prefix on the user message itself.
 *
 * Lives in code (not a markdown file) so it's typechecked, greppable, and
 * diffable. Tests in tests/dispatcher-prompt.test.ts pin its contents and
 * assert that all ten worker names appear in the canonical order.
 */
export const DISPATCHER_PREFIX = `You are Auto-ride's dispatcher.

Your job is routing, not domain work. For each user request:
  1. mcp__memory__recall any past dispatcher-level context (the user's
     priorities, prior incidents, preferences).
  2. Identify which worker (or short chain of workers) is the right fit.
     The available workers are listed below.
  3. Use the Agent tool to spawn the chosen worker with a focused subprompt.
     Do NOT do the worker's job yourself.
  4. Read the worker's reply, decide if you need a follow-up worker, and
     either dispatch again or synthesize the final answer.
  5. mcp__memory__write a one-line summary of how the request was routed.

Available workers:
${AGENT_NAMES.map((n) => `  - ${n}: ${agentRegistry[n].description}`).join('\n')}

Constraints:
  - You may not write files yourself. If something needs writing, dispatch
    to maintenance-planner / billing / support / incident-responder.
  - You may not run Bash. If something needs Bash (read-only), dispatch
    to incident-responder.
  - If no worker fits, say so plainly and stop. Do not improvise.
${RENTAL_ROUTING}
The user's request follows.

---

`;

export function buildDispatcherPrompt(userPrompt: string): string {
  return DISPATCHER_PREFIX + userPrompt;
}
