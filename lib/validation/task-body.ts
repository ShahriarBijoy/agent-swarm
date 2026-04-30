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
  kind: z.enum(['default', 'scenario']).default('default'),
  customer_email: z.string().email().optional(),
  // Phase 11.5 — when present, the new task is linked to an existing chat
  // thread. The route handler verifies the conversation belongs to the
  // signed-in user and stitches prior turns into the prompt before dispatch.
  conversationId: z.string().uuid().optional(),
});

export type CreateTaskBody = z.infer<typeof createTaskBodySchema>;
