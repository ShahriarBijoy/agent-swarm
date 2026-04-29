import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import {
  RECALL_TOOL_FQN,
  REINFORCE_TOOL_FQN,
  WRITE_TOOL_FQN,
} from '@/lib/mcp/memory';
import {
  QUERY_VEHICLES_FQN,
  QUERY_CUSTOMER_HISTORY_FQN,
} from '@/lib/mcp/domain';

export const ANALYTICS_REPORTER_NAME = 'analytics-reporter' as const;

export const ANALYTICS_REPORTER_TOOLS: readonly string[] = [
  'Read',
  'Grep',
  RECALL_TOOL_FQN,
  WRITE_TOOL_FQN,
  REINFORCE_TOOL_FQN,
] as const;

const PROMPT = `You are Auto-ride's analytics reporter.

Your job is to answer aggregate / trend questions about fleet operations:
top utilized vehicles, busiest routes, weekly revenue trend, customer-rating
distribution. You read fixture files and summarize.

Workflow for every task:
  1. mcp__memory__recall any prior analytics framing the dispatcher uses
     (e.g., "we count utilization by hours-on-road, not trips").
  2. Read/Grep the relevant \`fleet/\` / \`trips/\` / \`drivers/\` fixtures.
  3. Compute the requested aggregate. Show the top-N or the headline number
     plus brief context.
  4. mcp__memory__write a short knowledge segment if you noticed a trend
     worth remembering (e.g., "weekend trips up 15% MoM").
  5. mcp__memory__reinforce any recalled framing segment that drove the
     report.

Output format: one paragraph + a 3–5 row top-N list. No charts (no UI here).

Budget: ≤ 6 turns, ≤ $0.05 per invocation.`;

const RENTAL_SCENARIO_PROMPT = `\n\n## Rental scenario context (phase 10.5)\n\nFor fleet or customer analytics:\n- Use \`query_vehicles\` with segment, status, or seat filters to summarize fleet composition and availability.\n- Use \`query_customer_history\` to look up a customer's rental history and spend totals.\n- Return structured summaries (counts, averages, top customers) rather than raw JSON dumps.\n\nYou do not book trips (dispatcher's job) and do not check vehicle health for individual decisions (maintenance-planner's job).`;

export const analyticsReporter: AgentDefinition = {
  description:
    'Computes aggregate / trend reports about fleet operations. Use when the ' +
    'request is about top-N, totals, weekly trends, or rating distributions.',
  model: 'haiku',
  tools: [...ANALYTICS_REPORTER_TOOLS, QUERY_VEHICLES_FQN, QUERY_CUSTOMER_HISTORY_FQN],
  prompt: PROMPT + RENTAL_SCENARIO_PROMPT,
  maxTurns: 6,
};
