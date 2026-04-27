import {
  ConsolidatorBatchSchema,
  stripFences,
  type ConsolidatorProposal,
} from './schemas';
import {
  consolidatorSystemPrompt,
  consolidatorUserPrompt,
  type CandidateRow,
} from './prompts';
import { computeCallCostUsd, ROLE_MODEL } from './cost-tracker';
import type { LlmCall } from './llm';

export interface ConsolidatorRunResult {
  proposals: ConsolidatorProposal[];
  costUsd: number;
  parseFailed: boolean;
}

/**
 * Single Consolidator call over a batch of candidates (≤10).
 * On parse failure: returns { proposals: [], parseFailed: true } — the
 * batch is dropped from the run. The cost is still recorded since the
 * tokens were consumed.
 */
export async function runConsolidator(
  batch: CandidateRow[],
  llm: LlmCall,
): Promise<ConsolidatorRunResult> {
  const { text, usage } = await llm({
    model: ROLE_MODEL.consolidator,
    system: consolidatorSystemPrompt(),
    userPrompt: consolidatorUserPrompt(batch),
  });

  const costUsd = computeCallCostUsd(ROLE_MODEL.consolidator, usage);

  try {
    const parsed = ConsolidatorBatchSchema.parse(JSON.parse(stripFences(text)));
    return { proposals: parsed.proposals, costUsd, parseFailed: false };
  } catch {
    return { proposals: [], costUsd, parseFailed: true };
  }
}
