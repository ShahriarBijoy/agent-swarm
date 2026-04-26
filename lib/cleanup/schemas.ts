import { z } from 'zod';

/** Action verbs available across all three roles. */
export const ActionEnum = z.enum(['prune', 'merge', 'keep']);
export type Action = z.infer<typeof ActionEnum>;

export const ConsolidatorProposalSchema = z.object({
  memoryId: z.string().uuid(),
  action: ActionEnum,
  reasoning: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
export type ConsolidatorProposal = z.infer<typeof ConsolidatorProposalSchema>;

/** Consolidator returns up to 10 proposals per call (one batch). */
export const ConsolidatorBatchSchema = z.object({
  proposals: z.array(ConsolidatorProposalSchema),
});

export const AdversaryResponseSchema = z.object({
  memoryId: z.string().uuid(),
  adversaryConfidence: z.number().min(0).max(1),
  objection: z.string().default(''),
});
export type AdversaryResponse = z.infer<typeof AdversaryResponseSchema>;

export const JudgeVerdictSchema = z.object({
  memoryId: z.string().uuid(),
  finalAction: ActionEnum,
  reasoning: z.string().min(1),
});
export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>;

/**
 * Permissive parsers used in the runtime path. On any parse failure they
 * return the project's "safe default" (do nothing) rather than throw, so
 * one model misbehaving cannot abort an entire nightly run.
 *
 * The fallbacks honor the asymmetric loss rule from spec §3:
 *   - Adversary fallback ⇒ "no objection" ⇒ Consolidator wins
 *   - Judge fallback     ⇒ "keep"          ⇒ no-op apply
 */
export function parseAdversarySafe(raw: string): AdversaryResponse {
  try {
    const parsed = AdversaryResponseSchema.parse(JSON.parse(stripFences(raw)));
    return parsed;
  } catch {
    return {
      memoryId: '00000000-0000-0000-0000-000000000000',
      adversaryConfidence: 0.0,
      objection: '',
    };
  }
}

export function parseJudgeSafe(raw: string): JudgeVerdict {
  try {
    const parsed = JudgeVerdictSchema.parse(JSON.parse(stripFences(raw)));
    return parsed;
  } catch {
    return {
      memoryId: '00000000-0000-0000-0000-000000000000',
      finalAction: 'keep',
      reasoning: 'parse-failure-fallback',
    };
  }
}

/** Models sometimes wrap JSON in ```json fences. Strip them defensively. */
function stripFences(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    const inner = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    return inner.trim();
  }
  return trimmed;
}
