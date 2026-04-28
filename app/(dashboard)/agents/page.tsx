import { AGENT_NAMES, AGENT_SOFT_BUDGET_USD, type AgentName } from '@/lib/agent/agents';
import { getAgentsSummary } from '@/lib/dashboard/queries';
import { AgentsTable, type AgentRow } from './agents-table';

export const dynamic = 'force-dynamic';

export default async function AgentsIndexPage() {
  const summaries = await getAgentsSummary();
  const rows: AgentRow[] = AGENT_NAMES.map((name: AgentName) => ({
    name,
    softBudget: AGENT_SOFT_BUDGET_USD[name],
    summary: summaries[name] ?? null,
  }));

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-6">
      <AgentsTable rows={rows} />
    </div>
  );
}
