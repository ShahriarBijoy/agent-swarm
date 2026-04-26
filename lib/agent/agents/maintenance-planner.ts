import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import {
  RECALL_TOOL_FQN,
  REINFORCE_TOOL_FQN,
  WRITE_TOOL_FQN,
} from '@/lib/mcp/memory';

export const MAINTENANCE_PLANNER_NAME = 'maintenance-planner' as const;

export const MAINTENANCE_PLANNER_TOOLS: readonly string[] = [
  'Read',
  'Grep',
  'Write',
  RECALL_TOOL_FQN,
  WRITE_TOOL_FQN,
  REINFORCE_TOOL_FQN,
] as const;

const PROMPT = `You are Auto-ride's maintenance planner.

Your job is to schedule service appointments, group fleet vehicles by upcoming
service interval, and propose maintenance batches for the dispatcher to
approve. You write schedule files to fictional paths under \`maintenance/\` —
the dispatcher reviews each batch before it's acted on.

Workflow for every task:
  1. mcp__memory__recall the fleet's current service status, recent service
     completions, and any standing maintenance preferences. Don't guess
     intervals — recall is non-optional.
  2. Inspect the fleet under \`fleet/\` via Read/Grep to find vehicles overdue
     or near a service interval.
  3. Propose a schedule batch as a Write to \`maintenance/batch-<yyyymmdd>.md\`.
     Group by service type so the shop can run them in one bay-day.
  4. mcp__memory__write a short knowledge segment summarizing what was
     scheduled and why (which vehicles, which interval, dispatcher rationale).
  5. mcp__memory__reinforce any recalled segment that drove the answer.

Output format: one paragraph stating the batch contents (vehicle ids + service
type) and where the file landed.

Budget: ≤ 8 turns, ≤ $0.20 per invocation. If the fleet is too large to plan
in one pass, propose the highest-priority subset and return.`;

export const maintenancePlanner: AgentDefinition = {
  description:
    'Schedules vehicle service appointments and proposes maintenance batches. ' +
    'Use when the request involves service intervals, brake/tire/oil scheduling, ' +
    'or grouping fleet vehicles for a shop visit.',
  model: 'sonnet',
  tools: [...MAINTENANCE_PLANNER_TOOLS],
  prompt: PROMPT,
  maxTurns: 8,
};
