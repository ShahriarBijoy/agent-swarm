/**
 * Per-million-token pricing in USD, from anthropic.com/pricing as of 2026-04-26.
 * `cacheRead` is the cache-hit input rate (10% of base input).
 * `cacheWrite` is the 5-min ephemeral cache write rate (125% of base input).
 *
 * NOTE: These are notional. Auto-ride runs on Max OAuth so no real $ is billed
 * per call; the cost figure is used by MAX_RUN_USD to abort runaway runs.
 */
export const PRICING = {
  'claude-sonnet-4-6': {
    input: 3.00,
    output: 15.00,
    cacheRead: 0.30,
    cacheWrite: 3.75,
  },
  'claude-haiku-4-5': {
    input: 0.80,
    output: 4.00,
    cacheRead: 0.08,
    cacheWrite: 1.00,
  },
  'claude-opus-4-6': {
    input: 15.00,
    output: 75.00,
    cacheRead: 1.50,
    cacheWrite: 18.75,
  },
} as const;

export type RoleModel = keyof typeof PRICING;

/** Single source of truth for which model plays which role. */
export const ROLE_MODEL = {
  consolidator: 'claude-sonnet-4-6',
  adversary: 'claude-haiku-4-5',
  judge: 'claude-opus-4-6',
} as const satisfies Record<'consolidator' | 'adversary' | 'judge', RoleModel>;

/** Hard cap on a single cleanup run. Abort and mark `failed` if exceeded. */
export const MAX_RUN_USD = 10.0;

/** Token usage shape returned by Anthropic.messages.create. */
export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
}

/**
 * Pure function — no I/O, no mutation. Multiplies usage counts by per-model
 * rates and returns USD. Safe to call inside step.run() because cached step
 * outputs replay deterministically.
 */
export function computeCallCostUsd(
  model: RoleModel,
  usage: AnthropicUsage,
): number {
  const rates = PRICING[model];
  const input = (usage.input_tokens / 1_000_000) * rates.input;
  const output = (usage.output_tokens / 1_000_000) * rates.output;
  const cacheR = ((usage.cache_read_input_tokens ?? 0) / 1_000_000) * rates.cacheRead;
  const cacheW = ((usage.cache_creation_input_tokens ?? 0) / 1_000_000) * rates.cacheWrite;
  return input + output + cacheR + cacheW;
}
