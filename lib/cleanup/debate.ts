import type { CandidateRow } from './prompts';
import type { ConsolidatorProposal, AdversaryResponse, JudgeVerdict } from './schemas';
import { runConsolidator } from './consolidator';
import { runAdversary } from './adversary';
import { runJudge } from './judge';
import { CostCapExceededError } from './errors';
import type { LlmCall } from './llm';

export const JUDGE_THRESHOLD = 0.7;
export const CONSOLIDATOR_BATCH_SIZE = 10;

export interface DebateProposalRecord {
  memoryId: string;
  targetMemoryId: string | null;
  consolidator: ConsolidatorProposal;
  adversary: AdversaryResponse | null;
  judge: JudgeVerdict | null;
  finalAction: 'prune' | 'merge' | 'keep';
}

export interface DebateRunArgs {
  candidates: CandidateRow[];
  llm: LlmCall;
  maxRunUsd: number;
}

export interface DebateRunResult {
  proposals: DebateProposalRecord[];
  costUsd: number;
  proposalsGenerated: number;
  proposalsContested: number;
  proposalsJudged: number;
  parseFailures: number;
}

/**
 * The C → A → J pipeline. Cost is tracked across every model call; if the
 * running total crosses maxRunUsd before a step starts, throws
 * CostCapExceededError. Caller (the Inngest function) catches and marks
 * the run row failed.
 */
export async function runDebate(args: DebateRunArgs): Promise<DebateRunResult> {
  const { candidates, llm, maxRunUsd } = args;
  let costUsd = 0;
  let parseFailures = 0;
  const allProposals: DebateProposalRecord[] = [];
  const candidateById = new Map(candidates.map((c) => [c.memoryId, c]));

  // Step 1: Consolidator over batches of 10
  for (let i = 0; i < candidates.length; i += CONSOLIDATOR_BATCH_SIZE) {
    if (costUsd >= maxRunUsd) throw new CostCapExceededError(costUsd, maxRunUsd);
    const batch = candidates.slice(i, i + CONSOLIDATOR_BATCH_SIZE);
    const r = await runConsolidator(batch, llm);
    costUsd += r.costUsd;
    if (r.parseFailed) {
      parseFailures += 1;
      continue;
    }
    for (const p of r.proposals) {
      const cand = candidateById.get(p.memoryId);
      if (!cand) continue; // model hallucinated a memoryId; drop
      allProposals.push({
        memoryId: p.memoryId,
        targetMemoryId: cand.targetMemoryId,
        consolidator: p,
        adversary: null,
        judge: null,
        finalAction: p.action,
      });
    }
  }

  // Step 2: Adversary over each proposal
  for (const record of allProposals) {
    if (costUsd >= maxRunUsd) throw new CostCapExceededError(costUsd, maxRunUsd);
    const cand = candidateById.get(record.memoryId)!;
    const r = await runAdversary(record.consolidator, cand, llm);
    costUsd += r.costUsd;
    record.adversary = r.response;
  }

  // Step 3: Judge on contested only
  let contested = 0;
  let judged = 0;
  for (const record of allProposals) {
    if (record.adversary === null) continue;
    if (record.adversary.adversaryConfidence <= JUDGE_THRESHOLD) continue;
    contested += 1;
    if (costUsd >= maxRunUsd) throw new CostCapExceededError(costUsd, maxRunUsd);
    const cand = candidateById.get(record.memoryId)!;
    const r = await runJudge(record.consolidator, record.adversary.objection, cand, llm);
    costUsd += r.costUsd;
    record.judge = r.verdict;
    record.finalAction = r.verdict.finalAction;
    judged += 1;
  }

  return {
    proposals: allProposals,
    costUsd,
    proposalsGenerated: allProposals.length,
    proposalsContested: contested,
    proposalsJudged: judged,
    parseFailures,
  };
}
