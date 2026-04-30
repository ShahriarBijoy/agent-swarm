import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { AGENT_NAMES } from '@/lib/agent/agents';

describe('registry invariant', () => {
  it('has exactly the 10 phase-08 workers', () => {
    expect([...AGENT_NAMES].sort()).toEqual([
      'analytics-reporter',
      'billing',
      'compliance-auditor',
      'driver-coach',
      'fleet-analyst',
      'incident-responder',
      'maintenance-planner',
      'reflector',
      'route-optimizer',
      'support',
    ]);
  });

  it('lib/agent/agents/index.ts is byte-identical to main', () => {
    const diff = execSync('git diff main -- lib/agent/agents/index.ts', {
      encoding: 'utf8',
    });
    expect(diff).toBe('');
  });
});
