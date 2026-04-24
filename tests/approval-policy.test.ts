import { describe, expect, it } from 'vitest';
import {
  isSourcePath,
  isWhitelistedBash,
  shouldRequireApproval,
} from '@/lib/agent/approval-policy';

describe('phase-07 approval-policy', () => {
  describe('shouldRequireApproval — payment tools', () => {
    it.each([
      ['mcp__stripe__charge', { amount: 1000 }],
      ['mcp__stripe__refund', {}],
      ['mcp__stripe__create_customer', { email: 'a@b' }],
    ])('gates %s', (toolName, input) => {
      const r = shouldRequireApproval(toolName, input);
      expect(r.require).toBe(true);
      if (r.require) expect(r.reason).toMatch(/payment/i);
    });
  });

  describe('shouldRequireApproval — Bash', () => {
    it.each([
      ['ls -la'],
      ['pwd'],
      ['git status'],
      ['git log --oneline -n 3'],
      ['git diff HEAD~1'],
      ['pnpm test'],
      ['pnpm typecheck'],
      ['node --version'],
      ['echo hello'],
      ['cat package.json'],
    ])('passes whitelisted: %s', (command) => {
      const r = shouldRequireApproval('Bash', { command });
      expect(r.require).toBe(false);
    });

    it.each([
      ['rm -rf /tmp/x'],
      ['curl https://evil.example.com'],
      ['npm install left-pad'],
      ['sudo systemctl restart nginx'],
      ['git push --force'],
      ['pnpm install'],
      [''],
    ])('gates non-whitelisted: %s', (command) => {
      const r = shouldRequireApproval('Bash', { command });
      expect(r.require).toBe(true);
    });

    it('gates Bash without a command field', () => {
      const r = shouldRequireApproval('Bash', {});
      expect(r.require).toBe(true);
      if (r.require) expect(r.reason).toMatch(/without a command/i);
    });
  });

  describe('shouldRequireApproval — Write', () => {
    it.each([
      ['src/foo.ts'],
      ['src/components/Bar.tsx'],
      ['packages/web/src/x.ts'],
      ['src\\windows\\path.ts'], // backslash separator
    ])('gates write to source: %s', (file_path) => {
      const r = shouldRequireApproval('Write', { file_path });
      expect(r.require).toBe(true);
      if (r.require) expect(r.reason).toContain(file_path);
    });

    it.each([
      ['docs/readme.md'],
      ['/tmp/scratch.txt'],
      ['public/static/x.svg'],
    ])('passes write outside source: %s', (file_path) => {
      const r = shouldRequireApproval('Write', { file_path });
      expect(r.require).toBe(false);
    });

    it('gates Write without file_path', () => {
      const r = shouldRequireApproval('Write', {});
      expect(r.require).toBe(true);
    });
  });

  describe('shouldRequireApproval — pass-through tools', () => {
    it.each([
      ['Read', { file_path: '/etc/passwd' }],
      ['Agent', { agent_name: 'fleet-analyst' }],
      ['mcp__memory__recall', { query: 'fleet' }],
      ['mcp__memory__write', { content: 'x' }],
      ['mcp__memory__reinforce', { id: 'abc' }],
      ['mcp__memory__forget', { id: 'abc' }],
      ['Glob', { pattern: '**/*.ts' }],
    ])('passes %s', (toolName, input) => {
      const r = shouldRequireApproval(toolName, input);
      expect(r.require).toBe(false);
    });
  });

  describe('isWhitelistedBash', () => {
    it('treats a bare keyword as whitelisted (e.g. "pwd")', () => {
      expect(isWhitelistedBash('pwd')).toBe(true);
    });

    it('rejects empty / whitespace', () => {
      expect(isWhitelistedBash('')).toBe(false);
      expect(isWhitelistedBash('   ')).toBe(false);
    });

    it('does not match a whitelist token mid-command', () => {
      // "rm -rf; ls" should not be whitelisted just because "ls" appears.
      expect(isWhitelistedBash('rm -rf; ls')).toBe(false);
    });
  });

  describe('isSourcePath', () => {
    it.each([
      ['src/x.ts', true],
      ['src\\x.ts', true],
      ['./src/x.ts', true],
      ['packages/web/src/x.ts', true],
      ['docs/x.md', false],
      ['srcless/x.ts', false],
      ['mysrc/x.ts', false], // no leading boundary
    ])('isSourcePath(%j) === %s', (path, expected) => {
      expect(isSourcePath(path)).toBe(expected);
    });
  });
});
