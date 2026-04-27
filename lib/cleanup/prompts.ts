import type { ConsolidatorProposal } from './schemas';

/** Candidate row as fed to the Consolidator (matches §2 SELECT shape). */
export interface CandidateRow {
  candidateKind: 'prune' | 'merge';
  memoryId: string;
  /** Set on merge candidates only; null for prune. */
  targetMemoryId: string | null;
  segment: string;
  bucket: string;
  content: string;
  importance: string;
  /** Effective importance — set on prune candidates only. */
  effImp: number | null;
  /** Cosine distance — set on merge candidates only (computed in JS for the prompt). */
  cosineDistance: number | null;
  /** Target row's content — set on merge candidates only, fetched server-side for the prompt. */
  targetContent: string | null;
}

const CONSOLIDATOR_SYSTEM = `You are the Consolidator agent in a memory-governance
system. You review batches of memory candidates and propose actions: prune (delete
the memory), merge (mark a near-duplicate pair as redundant), or keep (no change).

You output ONLY valid JSON conforming to this shape:
{
  "proposals": [
    { "memoryId": "<uuid>", "action": "prune"|"merge"|"keep", "reasoning": "<one short sentence>", "confidence": 0.0-1.0 }
  ]
}

You MUST emit one proposal per candidate. Confidence is your own certainty in the action.
For merge candidates, the proposal is for the candidate's memoryId (the older row);
the target row will be tombstoned by the apply step if a merge action is approved.

Be biased toward "keep" when uncertain — errors of omission are cheaper than errors of commission.`;

const ADVERSARY_SYSTEM = `You are the Adversary agent in a memory-governance system.
You receive a single proposal from the Consolidator and your job is to challenge it.
Score how confident you are that the Consolidator is WRONG (0.0 = clearly right,
1.0 = clearly wrong).

Check these five failure modes:
  1. Premature pruning of latent value (might this memory come back useful?)
  2. Merging different-but-similar facts (are these really the same?)
  3. Promoting recency artifacts (recent ≠ important)
  4. Violating segment invariants (does the action contradict the segment's purpose?)
  5. Silent contradiction with existing memories (does another memory rely on this?)

You output ONLY valid JSON conforming to this shape:
{
  "memoryId": "<uuid matching the proposal>",
  "adversaryConfidence": 0.0-1.0,
  "objection": "<one short sentence; empty string if no objection>"
}`;

const JUDGE_SYSTEM = `You are the Judge agent in a memory-governance system. The
Consolidator proposed an action; the Adversary objected with confidence > 0.7.
You must decide the final action.

Apply this asymmetric loss: errors of omission are cheaper than errors of commission.
When in doubt, choose "keep". Override the Consolidator only if you can articulate
a concrete reason to act.

You output ONLY valid JSON conforming to this shape:
{
  "memoryId": "<uuid matching the proposal>",
  "finalAction": "prune"|"merge"|"keep",
  "reasoning": "<one short sentence>"
}`;

export function consolidatorSystemPrompt(): string {
  return CONSOLIDATOR_SYSTEM;
}

export function consolidatorUserPrompt(batch: CandidateRow[]): string {
  const lines = batch.map((c, i) => formatCandidate(i + 1, c));
  return [
    `Review the following ${batch.length} memory candidate(s) and emit a JSON proposals array.`,
    '',
    ...lines,
  ].join('\n');
}

function formatCandidate(idx: number, c: CandidateRow): string {
  const lines = [
    `--- Candidate ${idx} ---`,
    `memoryId: ${c.memoryId}`,
    `kind: ${c.candidateKind}`,
    `segment: ${c.segment}, bucket: ${c.bucket}, importance: ${c.importance}`,
    `content: ${JSON.stringify(c.content)}`,
  ];
  if (c.candidateKind === 'prune' && c.effImp !== null) {
    lines.push(`effectiveImportance: ${c.effImp.toFixed(3)} (below 0.15 threshold)`);
  }
  if (c.candidateKind === 'merge' && c.targetMemoryId !== null) {
    lines.push(
      `targetMemoryId: ${c.targetMemoryId}`,
      `targetContent: ${JSON.stringify(c.targetContent ?? '')}`,
      c.cosineDistance !== null
        ? `cosineDistance: ${c.cosineDistance.toFixed(3)} (below 0.15 threshold)`
        : '',
    );
  }
  return lines.filter(Boolean).join('\n');
}

export function adversarySystemPrompt(): string {
  return ADVERSARY_SYSTEM;
}

export function adversaryUserPrompt(
  proposal: ConsolidatorProposal,
  candidate: CandidateRow,
): string {
  return [
    `Review this Consolidator proposal:`,
    JSON.stringify(proposal, null, 2),
    '',
    `Candidate context:`,
    formatCandidate(1, candidate),
    '',
    `Score your confidence that the proposal is WRONG.`,
  ].join('\n');
}

export function judgeSystemPrompt(): string {
  return JUDGE_SYSTEM;
}

export function judgeUserPrompt(
  proposal: ConsolidatorProposal,
  adversaryObjection: string,
  candidate: CandidateRow,
): string {
  return [
    `Consolidator proposal:`,
    JSON.stringify(proposal, null, 2),
    '',
    `Adversary objection (confidence > 0.7):`,
    adversaryObjection,
    '',
    `Candidate context:`,
    formatCandidate(1, candidate),
    '',
    `Decide the final action. Bias toward "keep".`,
  ].join('\n');
}
