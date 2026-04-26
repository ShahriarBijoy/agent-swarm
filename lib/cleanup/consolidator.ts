import Anthropic from '@anthropic-ai/sdk';
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
  client: Anthropic,
): Promise<ConsolidatorRunResult> {
  const response = await client.messages.create({
    model: ROLE_MODEL.consolidator,
    max_tokens: 2048,
    system: consolidatorSystemPrompt(),
    messages: [{ role: 'user', content: consolidatorUserPrompt(batch) }],
  });

  const costUsd = computeCallCostUsd(ROLE_MODEL.consolidator, response.usage);
  const text = extractText(response);

  try {
    const parsed = ConsolidatorBatchSchema.parse(JSON.parse(stripFences(text)));
    return { proposals: parsed.proposals, costUsd, parseFailed: false };
  } catch {
    return { proposals: [], costUsd, parseFailed: true };
  }
}

function extractText(response: Anthropic.Message): string {
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}
