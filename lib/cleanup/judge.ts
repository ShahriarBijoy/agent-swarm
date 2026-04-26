import Anthropic from '@anthropic-ai/sdk';
import { parseJudgeSafe, type JudgeVerdict, type ConsolidatorProposal } from './schemas';
import { judgeSystemPrompt, judgeUserPrompt, type CandidateRow } from './prompts';
import { computeCallCostUsd, ROLE_MODEL } from './cost-tracker';

export interface JudgeRunResult {
  verdict: JudgeVerdict;
  costUsd: number;
}

/**
 * Single Judge call over a contested proposal. parseJudgeSafe defaults to
 * finalAction='keep' on bad JSON ⇒ no-op apply (asymmetric loss safe bet).
 */
export async function runJudge(
  proposal: ConsolidatorProposal,
  adversaryObjection: string,
  candidate: CandidateRow,
  client: Anthropic,
): Promise<JudgeRunResult> {
  const response = await client.messages.create({
    model: ROLE_MODEL.judge,
    max_tokens: 512,
    system: judgeSystemPrompt(),
    messages: [
      { role: 'user', content: judgeUserPrompt(proposal, adversaryObjection, candidate) },
    ],
  });

  const costUsd = computeCallCostUsd(ROLE_MODEL.judge, response.usage);
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const parsed = parseJudgeSafe(text);
  return {
    verdict: { ...parsed, memoryId: proposal.memoryId },
    costUsd,
  };
}
