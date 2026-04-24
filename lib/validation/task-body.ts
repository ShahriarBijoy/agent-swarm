import { z } from 'zod';

/**
 * POST /api/tasks body schema.
 *
 * `prompt` is bounded at 4000 chars — any real fleet prompt fits comfortably
 * under this, and the bound protects the DB + the Claude SDK from pathological
 * input. `maxBudgetUsd` and `maxTurns` are optional overrides clamped server-
 * side so a client can't ask for an unlimited budget; the defaults in
 * `lib/agent/options.ts` (phase 05) still apply when omitted.
 */
export const createTaskBodySchema = z.object({
  prompt: z.string().min(1).max(4000),
  maxBudgetUsd: z.number().min(0).max(5.0).optional(),
  maxTurns: z.number().int().min(1).max(100).optional(),
});

export type CreateTaskBody = z.infer<typeof createTaskBodySchema>;
