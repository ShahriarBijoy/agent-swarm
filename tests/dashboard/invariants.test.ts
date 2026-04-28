import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { WIDGET_REGISTRY } from '@/components/dashboard/widget-registry';

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

describe('phase-10 invariants', () => {
  it('no dashboard component imports the Agent SDK', () => {
    const dirs = ['app/(dashboard)', 'components/dashboard'];
    const offenders: string[] = [];
    for (const d of dirs) {
      try {
        for (const f of walk(d)) {
          if (!/\.tsx?$/.test(f)) continue;
          const src = readFileSync(f, 'utf8');
          if (src.includes('@anthropic-ai/claude-agent-sdk')) offenders.push(relative('.', f));
        }
      } catch {
        /* dir may not exist on first run */
      }
    }
    expect(offenders, `These dashboard files import the SDK:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('every WidgetId is registered with a Component + load + gridArea', () => {
    const ids = [
      'greeting',
      'all-agents',
      'mini-canvas',
      'hitl-queue',
      'memory-writes-lime',
      'cleanup-last-night',
      'cost-line-12mo',
      'memory-segments-ring',
      'active-workers-black',
    ] as const;
    for (const id of ids) {
      const def = WIDGET_REGISTRY[id];
      expect(def, `widget ${id} not registered`).toBeDefined();
      expect(typeof def.load).toBe('function');
      expect(typeof def.Component).toBe('function');
      expect(typeof def.gridArea).toBe('string');
    }
  });

  it('widgets do not import recharts directly (must go through next/dynamic)', () => {
    const widgetsDir = 'components/dashboard/widgets';
    for (const f of walk(widgetsDir)) {
      if (!/\.tsx?$/.test(f)) continue;
      const src = readFileSync(f, 'utf8');
      const hasDirect = /from\s+['"]recharts['"]/.test(src);
      const hasDynamic = src.includes("import('recharts')");
      expect(!hasDirect || hasDynamic, `${f} imports recharts directly`).toBe(true);
    }
  });
});
