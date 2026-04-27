import { parseJudgeSafe, type JudgeVerdict, type ConsolidatorProposal } from './schemas';
import { judgeSystemPrompt, judgeUserPrompt, type CandidateRow } from './prompts';
import { computeCallCostUsd, ROLE_MODEL } from './cost-tracker';
import type { LlmCall } from './llm';

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
  llm: LlmCall,
): Promise<JudgeRunResult> {
  const { text, usage } = await llm({
    model: ROLE_MODEL.judge,
    system: judgeSystemPrompt(),
    userPrompt: judgeUserPrompt(proposal, adversaryObjection, candidate),
  });

  const costUsd = computeCallCostUsd(ROLE_MODEL.judge, usage);
  const parsed = parseJudgeSafe(text);
  return {
    verdict: { ...parsed, memoryId: proposal.memoryId },
    costUsd,
  };
}
