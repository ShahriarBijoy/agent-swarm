import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url().min(1),
  DATABASE_URL_UNPOOLED: z.string().url().min(1),
  GEMINI_API_KEY: z.string().min(1),
  // Phase 11 — Better Auth + SSE token gate.
  // Both 32-byte hex secrets generated via `openssl rand -hex 32`.
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, 'BETTER_AUTH_SECRET must be ≥32 chars (use `openssl rand -hex 32`)'),
  BETTER_AUTH_URL: z.string().url().min(1),
  SSE_TOKEN_SECRET: z
    .string()
    .min(32, 'SSE_TOKEN_SECRET must be ≥32 chars (use `openssl rand -hex 32`)'),
  // Optional kill-switch for `/register` — set to '1' to disable sign-up.
  BETTER_AUTH_SIGNUP_DISABLED: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();

// ---------------------------------------------------------------------------
// Agent SDK auth — phase 05. Separate from `envSchema` so tests that don't
// exercise `query()` (mapper tests, hook tests, definition tests) keep running
// in CI without Anthropic credentials.
// ---------------------------------------------------------------------------

export type AgentAuthEnv =
  | { kind: 'api_key'; apiKey: string }
  | { kind: 'gateway'; baseUrl: string; authToken: string }
  | { kind: 'oauth'; oauthToken: string };

/**
 * Resolves Anthropic credentials for the Agent SDK.
 *
 * Precedence (matches the SDK's documented resolution order):
 *   1. ANTHROPIC_API_KEY                      — direct API key
 *   2. ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN — gateway / LiteLLM proxy
 *   3. CLAUDE_CODE_OAUTH_TOKEN                — Pro/Max subscription via `claude setup-token`
 *
 * When multiple are set, the higher-precedence one wins — logs a warning on
 * stderr so the developer doesn't think OAuth is being used when the SDK will
 * actually route through the API key.
 *
 * Throws when none of the three paths is populated.
 */
export function loadAgentAuthEnv(): AgentAuthEnv {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  const baseUrl = process.env.ANTHROPIC_BASE_URL?.trim();
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN?.trim();
  const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();

  const hasApiKey = Boolean(apiKey);
  const hasGateway = Boolean(baseUrl && authToken);
  const hasOauth = Boolean(oauthToken);

  if (hasApiKey) {
    if (hasOauth) {
      console.error(
        '[agent-auth] both ANTHROPIC_API_KEY and CLAUDE_CODE_OAUTH_TOKEN are set — API key takes precedence',
      );
    }
    return { kind: 'api_key', apiKey: apiKey as string };
  }

  if (hasGateway) {
    if (hasOauth) {
      console.error(
        '[agent-auth] both ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN and CLAUDE_CODE_OAUTH_TOKEN are set — gateway takes precedence',
      );
    }
    return {
      kind: 'gateway',
      baseUrl: baseUrl as string,
      authToken: authToken as string,
    };
  }

  if (hasOauth) {
    return { kind: 'oauth', oauthToken: oauthToken as string };
  }

  throw new Error(
    'Agent SDK auth missing. Set exactly one of:\n' +
      '  - ANTHROPIC_API_KEY\n' +
      '  - ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN\n' +
      '  - CLAUDE_CODE_OAUTH_TOKEN\n' +
      'See docs/roadmap/ROADMAP.md → "Auth for the Agent SDK" for the full decision tree.',
  );
}
