import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { db } from '@/db/client';
import * as schema from '@/db/schema';
import { env } from '@/lib/env';

// Phase 11 — Better Auth server instance.
//
// `nextCookies()` is the small Next.js plugin that lets server actions read
// the auth cookies after sign-in/sign-up; without it, `authClient.signIn` from
// a server action would set cookies that never make it to the response.
//
// `transaction: false` (the adapter default) is correct here because `db` is
// the neon-http drizzle client which is stateless per request — it cannot
// hold a transaction open. Better Auth's writes are single-statement so this
// is safe.
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    disableSignUp: env.BETTER_AUTH_SIGNUP_DISABLED === '1',
    minPasswordLength: 8,
  },
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh once per day
  },
  plugins: [nextCookies()],
});

export type AuthSession = NonNullable<
  Awaited<ReturnType<typeof auth.api.getSession>>
>;
