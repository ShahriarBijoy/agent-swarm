import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadAgentAuthEnv } from '@/lib/env';

describe('loadAgentAuthEnv', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('ANTHROPIC_BASE_URL', '');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', '');
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    errSpy.mockRestore();
  });

  it('returns { kind: "api_key" } when only ANTHROPIC_API_KEY is set', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-api03-xxxxx');
    const out = loadAgentAuthEnv();
    expect(out).toEqual({ kind: 'api_key', apiKey: 'sk-ant-api03-xxxxx' });
  });

  it('returns { kind: "oauth" } when only CLAUDE_CODE_OAUTH_TOKEN is set', () => {
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'sk-ant-oat01-xxxxx');
    const out = loadAgentAuthEnv();
    expect(out).toEqual({ kind: 'oauth', oauthToken: 'sk-ant-oat01-xxxxx' });
  });

  it('returns { kind: "gateway" } when both ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN are set', () => {
    vi.stubEnv('ANTHROPIC_BASE_URL', 'http://localhost:4000');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'sk-litellm-master-key');
    const out = loadAgentAuthEnv();
    expect(out).toEqual({
      kind: 'gateway',
      baseUrl: 'http://localhost:4000',
      authToken: 'sk-litellm-master-key',
    });
  });

  it('falls through a half-configured gateway (only BASE_URL) to the next path or error', () => {
    vi.stubEnv('ANTHROPIC_BASE_URL', 'http://localhost:4000');
    // No AUTH_TOKEN, no API key, no OAuth → error
    expect(() => loadAgentAuthEnv()).toThrow(/Agent SDK auth missing/);
  });

  it('API key wins over OAuth when both are set, logs a precedence warning', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-api03-xxxxx');
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'sk-ant-oat01-xxxxx');
    const out = loadAgentAuthEnv();
    expect(out.kind).toBe('api_key');
    const logged = errSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    expect(logged).toMatch(/both .* API key takes precedence/);
  });

  it('gateway wins over OAuth when both are set, logs a precedence warning', () => {
    vi.stubEnv('ANTHROPIC_BASE_URL', 'http://localhost:4000');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'sk-litellm-master-key');
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'sk-ant-oat01-xxxxx');
    const out = loadAgentAuthEnv();
    expect(out.kind).toBe('gateway');
    const logged = errSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    expect(logged).toMatch(/gateway takes precedence/);
  });

  it('throws naming all three paths when no auth env vars are set', () => {
    expect(() => loadAgentAuthEnv()).toThrow(
      /ANTHROPIC_API_KEY[\s\S]*ANTHROPIC_BASE_URL[\s\S]*ANTHROPIC_AUTH_TOKEN[\s\S]*CLAUDE_CODE_OAUTH_TOKEN/,
    );
  });
});
