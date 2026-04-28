import { describe, expect, it } from 'vitest';
import { COLOR, GRID, SPACING, MOTION } from '@/components/theme/tokens';

describe('phase-10 theme tokens', () => {
  it('exports the seven palette colours used by widgets', () => {
    expect(COLOR.bg).toBe('#efece6');
    expect(COLOR.surface).toBe('#ffffff');
    expect(COLOR.surfaceWarm).toBe('#f6f2ea');
    expect(COLOR.ink).toBe('#0a0a0a');
    expect(COLOR.lime).toBe('#d4ff3f');
    expect(COLOR.red).toBe('#d71921');
    expect(COLOR.muted).toBe('#75716a');
  });

  it('exports the bento grid shape', () => {
    expect(GRID.cols).toBe(5);
    expect(GRID.gap).toBe('14px');
    expect(GRID.cellRadius).toBe('16px');
    expect(GRID.innerPad).toBe('22px');
  });

  it('exports the four spacing tiers in pixels', () => {
    expect(SPACING.tight).toBe('8px');
    expect(SPACING.medium).toBe('16px');
    expect(SPACING.wide).toBe('32px');
    expect(SPACING.vast).toBe('64px');
  });

  it('motion tokens use ease-out (no bounce/spring)', () => {
    expect(MOTION.fast).toContain('cubic-bezier(0.16, 1, 0.3, 1)');
    expect(MOTION.normal).toContain('cubic-bezier(0.16, 1, 0.3, 1)');
    expect(MOTION.pulse).toBe('1.4s ease-in-out infinite');
  });
});
