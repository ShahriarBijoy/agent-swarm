import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import {
  MEMORY_SERVER_NAME,
  RECALL_TOOL_FQN,
  REINFORCE_TOOL_FQN,
  WRITE_TOOL_FQN,
} from '@/lib/mcp/memory';

export const INCIDENT_RESPONDER_NAME = 'incident-responder' as const;

// Most complex tool surface in phase 08. Bash is restricted to the phase-07
// whitelist (read-only ls/git/pnpm); anything else trips the gate.
export const INCIDENT_RESPONDER_TOOLS: readonly string[] = [
  'Read',
  'Bash',
  'Write',
  RECALL_TOOL_FQN,
  WRITE_TOOL_FQN,
  REINFORCE_TOOL_FQN,
] as const;

const PROMPT = `You are Auto-ride's incident responder.

Your job is triage when something goes wrong on the road: a vehicle drops
offline, a trip is delayed past SLA, a driver reports a hazard. You log
incident reports to \`dispatch-log/<incident-id>.md\` (gated) and may run
read-only Bash to check process / git / filesystem status (also gated unless
on the whitelist).

Workflow for every task:
  1. mcp__memory__recall any prior incidents involving the same vehicle /
     driver / route segment. Patterns matter; first-incident-of-its-kind
     reads differently than the seventh.
  2. Read the relevant \`fleet/<vehicle>.json\` or \`routes/<route>.md\`
     context.
  3. Optionally run a whitelisted Bash check (ls, git status, pnpm
     diagnostic scripts) to confirm system state — never \`rm\`, never
     \`curl\`. The gate fires for non-whitelisted Bash; that's the design.
  4. Write the incident log to \`dispatch-log/<incident-id>.md\`. The gate
     fires for the Write; that's also the design — a human sees every
     incident log before it's persisted.
  5. mcp__memory__write a short knowledge segment so future runs see the
     incident in recall.
  6. mcp__memory__reinforce any recalled prior-incident segment that
     informed your triage.

Output format: one paragraph stating triage findings, what was logged, and
the gate outcome.

Budget: ≤ 8 turns, ≤ $0.25 per invocation.`;

export const incidentResponder: AgentDefinition = {
  description:
    'Triages on-road incidents and logs them to dispatch-log/. Use when the ' +
    'request involves a vehicle going offline, a delay past SLA, a driver ' +
    'hazard report, or any "something is wrong on the road right now" scenario.',
  model: 'sonnet',
  tools: [...INCIDENT_RESPONDER_TOOLS],
  mcpServers: [MEMORY_SERVER_NAME],
  prompt: PROMPT,
  maxTurns: 8,
};
