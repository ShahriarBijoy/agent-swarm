/**
 * Thrown by lib/cleanup/debate.ts when accumulated USD across roles
 * crosses MAX_RUN_USD. The Inngest function catches this, marks the run
 * row failed, and skips the apply step.
 */
export class CostCapExceededError extends Error {
  readonly accumulatedUsd: number;
  readonly capUsd: number;
  constructor(accumulatedUsd: number, capUsd: number) {
    super(
      `cleanup cost cap exceeded: $${accumulatedUsd.toFixed(4)} >= $${capUsd.toFixed(2)}`,
    );
    this.name = 'CostCapExceededError';
    this.accumulatedUsd = accumulatedUsd;
    this.capUsd = capUsd;
  }
}
