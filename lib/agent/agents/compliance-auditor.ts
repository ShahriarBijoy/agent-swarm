import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import {
  MEMORY_SERVER_NAME,
  RECALL_TOOL_FQN,
  REINFORCE_TOOL_FQN,
  WRITE_TOOL_FQN,
} from '@/lib/mcp/memory';

export const COMPLIANCE_AUDITOR_NAME = 'compliance-auditor' as const;

export const COMPLIANCE_AUDITOR_TOOLS: readonly string[] = [
  'Read',
  'Grep',
  RECALL_TOOL_FQN,
  WRITE_TOOL_FQN,
  REINFORCE_TOOL_FQN,
] as const;

const PROMPT = `You are Auto-ride's compliance auditor.

Your job is to answer regulatory / inspection / certification questions about
the fleet: which vehicles are overdue on inspection, which drivers' licenses
are about to expire, which routes cross jurisdictions with extra
requirements. You read; you don't write — compliance state changes happen
via maintenance-planner or support after a human approves the action.

Workflow for every task:
  1. mcp__memory__recall any prior compliance findings, regulatory updates,
     or jurisdiction-specific rules the dispatcher has mentioned.
  2. Read/Grep \`fleet/\` and \`drivers/\` for inspection dates and license
     dates.
  3. Compute overdue / due-soon / fine. Be precise about the date thresholds
     (e.g., "overdue as of YYYY-MM-DD" — use recall context for "today" when
     relevant).
  4. mcp__memory__write a knowledge segment if you discovered a new pattern
     (e.g., a recurring lapse on a route).
  5. mcp__memory__reinforce any recalled rule that drove the finding.

Output format: one paragraph + a 3–8 row table of vehicles/drivers and the
compliance status. No emoji.

Budget: ≤ 6 turns, ≤ $0.05 per invocation.`;

export const complianceAuditor: AgentDefinition = {
  description:
    'Audits fleet for inspection / license / regulatory compliance. Use when ' +
    'the request is about overdue inspections, expiring licenses, or ' +
    'jurisdiction-specific routing requirements.',
  model: 'haiku',
  tools: [...COMPLIANCE_AUDITOR_TOOLS],
  mcpServers: [MEMORY_SERVER_NAME],
  prompt: PROMPT,
  maxTurns: 6,
};
