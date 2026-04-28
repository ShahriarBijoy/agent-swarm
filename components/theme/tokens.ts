// Single source of truth for the phase-10 dashboard palette + spacing.
// Every Tailwind class outside this file should reference a CSS variable
// named after one of these tokens (e.g. `bg-[var(--color-surface)]`).

export const COLOR = {
  bg:           '#efece6',
  bg2:          '#e6e2d8',
  surface:      '#ffffff',
  surfaceWarm:  '#f6f2ea',
  ink:          '#0a0a0a',
  inkSoft:      '#1a1a18',
  muted:        '#75716a',
  muted2:       '#a09a8e',
  line:         'rgba(10,10,10,0.08)',
  lineStrong:   'rgba(10,10,10,0.16)',
  lime:         '#d4ff3f',
  limeDeep:     '#b8e623',
  red:          '#d71921',
} as const;

export const GRID = {
  cols:        5,
  gap:        '14px',
  cellRadius: '16px',
  innerPad:   '22px',
} as const;

export const SPACING = {
  tight:  '8px',
  medium: '16px',
  wide:   '32px',
  vast:   '64px',
} as const;

export const MOTION = {
  fast:     '150ms cubic-bezier(0.16, 1, 0.3, 1)',
  normal:   '250ms cubic-bezier(0.16, 1, 0.3, 1)',
  pulse:    '1.4s ease-in-out infinite',
  dashFlow: '1.2s linear infinite',
} as const;

export type ColorToken = keyof typeof COLOR;
