import { parseAdversarySafe, type AdversaryResponse, type ConsolidatorProposal } from './schemas';
import { adversarySystemPrompt, adversaryUserPrompt, type CandidateRow } from './prompts';
import { computeCallCostUsd, ROLE_MODEL } from './cost-tracker';
import type { LlmCall } from './llm';

export interface AdversaryRunResult {
  response: AdversaryResponse;
  costUsd: number;
}

/**
 * Single Adversary call over one Consolidator proposal. parseAdversarySafe
 * defaults to confidence 0.0 on bad JSON ⇒ Consolidator wins ⇒ Judge skipped.
 */
export async function runAdversary(
  proposal: ConsolidatorProposal,
  candidate: CandidateRow,
  llm: LlmCall,
): Promise<AdversaryRunResult> {
  const { text, usage } = await llm({
    model: ROLE_MODEL.adversary,
    system: adversarySystemPrompt(),
    userPrompt: adversaryUserPrompt(proposal, candidate),
  });

  const costUsd = computeCallCostUsd(ROLE_MODEL.adversary, usage);
  const parsed = parseAdversarySafe(text);
  // Override the fallback memoryId with the proposal's so downstream code
  // can correlate. Confidence stays whatever parseAdversarySafe returned.
  return {
    response: { ...parsed, memoryId: proposal.memoryId },
    costUsd,
  };
}
