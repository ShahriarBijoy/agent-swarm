import Anthropic from '@anthropic-ai/sdk';
import { parseAdversarySafe, type AdversaryResponse, type ConsolidatorProposal } from './schemas';
import { adversarySystemPrompt, adversaryUserPrompt, type CandidateRow } from './prompts';
import { computeCallCostUsd, ROLE_MODEL } from './cost-tracker';

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
  client: Anthropic,
): Promise<AdversaryRunResult> {
  const response = await client.messages.create({
    model: ROLE_MODEL.adversary,
    max_tokens: 512,
    system: adversarySystemPrompt(),
    messages: [{ role: 'user', content: adversaryUserPrompt(proposal, candidate) }],
  });

  const costUsd = computeCallCostUsd(ROLE_MODEL.adversary, response.usage);
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const parsed = parseAdversarySafe(text);
  // Override the fallback memoryId with the proposal's so downstream code
  // can correlate. Confidence stays whatever parseAdversarySafe returned.
  return {
    response: { ...parsed, memoryId: proposal.memoryId },
    costUsd,
  };
}
