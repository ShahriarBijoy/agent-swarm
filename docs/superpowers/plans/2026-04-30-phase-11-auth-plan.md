# Phase 11 Implementation Plan — Auth (Better Auth + middleware + SSE token)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the entire webapp behind Better Auth. A signed-out visitor sees only `/login`, `/register`, `/health`. A signed-in operator drives every dashboard surface and the chat-driven scenario flow exactly as before. The SSE timeline survives the gate via a 60-second HMAC token in the `EventSource` URL.

**Architecture:** Better Auth (email + password only) owns identity in four generated tables (`user`, `session`, `account`, `verification`). The existing `customers` table is unchanged except for a new nullable `user_id` FK. A root `middleware.ts` redirects unauthenticated requests to `/login` *except* for an explicit allowlist (`/health`, `/login`, `/register`, `/api/auth/**`, `/api/inngest`, `/api/tasks/[id]/stream`, build assets). The SSE stream route is allowlisted because `EventSource` cannot follow redirects; it instead requires a separate, hand-rolled HMAC-signed query-param token, minted server-side at page render. Three EventSource clients (`timeline-stream.tsx`, `canvas-view.tsx`, `approval-bar.tsx`) and one chat surface change shape; everything else stays put.

**Tech stack:** TypeScript / Next.js 16 App Router / React 19 / Drizzle ORM 0.45 / Neon Postgres / `better-auth` (NEW) / `node:crypto` for HMAC / Vitest 4 / Playwright (existing).

**Spec:** `docs/superpowers/specs/2026-04-30-phase-11-auth-design.md` — read it first; this plan does not re-explain the design.

**Decisions locked in (from spec sign-off):**

1. Identity = two tables, link `customers.user_id` → `user.id` lazily by email.
2. Single role; every signed-in user is a full-access operator.
3. Email + password only.
4. Open `/register` with `BETTER_AUTH_SIGNUP_DISABLED=1` kill-switch.
5. SSE = 60s HMAC `?token=`; refresh route on reconnect.
6. Chat reads email from session; visible "Replying as:" pill stays.

---

## File structure

```
db/
  schema/
    auth.ts                                       [NEW]   user / session / account / verification
    domain.ts                                     [MOD]   customers.user_id (nullable FK + index)
    index.ts                                      [MOD]   re-export ./auth

lib/
  env.ts                                          [MOD]   add BETTER_AUTH_SECRET / _URL / SSE_TOKEN_SECRET; optional BETTER_AUTH_SIGNUP_DISABLED
  auth/
    server.ts                                     [NEW]   betterAuth() instance (drizzle adapter, email+password)
    client.ts                                     [NEW]   createAuthClient() for React (signIn / signUp / signOut)
    require-session.ts                            [NEW]   server-component guard, throws redirect to /login
    sse-token.ts                                  [NEW]   sign / verify HMAC tokens (~50 lines, no JWT lib)
    public-paths.ts                               [NEW]   regex array for middleware

app/
  (auth)/                                         [NEW]   public route group
    layout.tsx                                    [NEW]   minimal centered layout (no TopNav)
    login/
      page.tsx                                    [NEW]   server component — redirect to / if already signed in
      login-form.tsx                              [NEW]   client form using authClient.signIn
    register/
      page.tsx                                    [NEW]   gated by BETTER_AUTH_SIGNUP_DISABLED
      register-form.tsx                           [NEW]
  (dashboard)/
    layout.tsx                                    [MOD]   await requireSession(); pass user to TopNav
    chat/
      page.tsx                                    [MOD]   defaultEmail from session.user.email
      chat-form.tsx                               [MOD]   drop hidden customer_email input; pill always shown
      actions.ts                                  [MOD]   server action reads session, not form
    tasks/[id]/
      page.tsx                                    [MOD]   mint sseToken; pass to client components
      timeline-stream.tsx                         [MOD]   accept sseToken prop; refresh on onerror
      canvas-view.tsx                             [MOD]   same prop + refresh wiring
      approval-bar.tsx                            [MOD]   same
  api/
    auth/[...all]/
      route.ts                                    [NEW]   Better Auth Next handler
    tasks/
      route.ts                                    [MOD]   require session; overwrite body customer_email with session email
      [id]/stream/
        route.ts                                  [MOD]   verify ?token=
      [id]/stream-token/
        route.ts                                  [NEW]   GET — session-cookie-gated; returns fresh SSE token
    dashboard/route.ts                            [MOD]   require session
    invoices/route.ts                             [MOD]   require session
    trips/route.ts                                [MOD]   require session
    vehicles/route.ts                             [MOD]   require session

middleware.ts                                     [NEW]   root middleware

components/
  dashboard/
    top-nav.tsx                                   [MOD]   user pill + sign-out button

scripts/
  auth-reset-password.ts                          [NEW]   tsx --env-file=.env.local <email>

tests/
  auth/
    sse-token.test.ts                             [NEW]   sign/verify/tamper/expiry
    public-paths.test.ts                          [NEW]   matrix: every dashboard route must NOT match
    require-session.test.ts                       [NEW]   redirect on miss, pass on hit
  api/
    tasks-stream-auth.test.ts                     [NEW]   401 on bad token, 200 on good
    tasks-post-auth.test.ts                       [NEW]   POST /api/tasks 401 unauth, 200 with session
  e2e/
    login-redirect.spec.ts                        [NEW]   visit / unauth → /login; sign in → see content; sign out → /login

.env.example                                      [MOD]   BETTER_AUTH_SECRET / _URL / SSE_TOKEN_SECRET / BETTER_AUTH_SIGNUP_DISABLED
package.json                                      [MOD]   add `better-auth` to dependencies
README.md                                         [MOD]   phase 11 section (auth setup steps)
```

**Files NOT modified** (load-bearing): `app/api/inngest/route.ts`, `app/health/route.ts`, the existing `db/schema/{tasks,approvals,memories,cleanup,enums}.ts`, every file under `lib/agent/`, every file under `lib/inngest/`, every file under `lib/mcp/`. Asserted byte-identical to `main` in Task 16.

---

## Pre-flight (user runs)

Per the package-installs and env-setup feedback memories, the user does these steps; the agent does **not** run `pnpm install` or start `pnpm dev`.

- [ ] **Pre-flight 1: Confirm baseline green**

```bash
pnpm typecheck && pnpm test
```

Expected: all green. Phase 11 starts from a clean `main` (PR #14 merged).

- [ ] **Pre-flight 2 (after Task 2 commit lands): Install `better-auth`**

```bash
pnpm install
```

Expected: `node_modules/better-auth` present. Lockfile updated.

- [ ] **Pre-flight 3 (after Task 1 commit lands): Fill env**

Append to `.env.local` (generate the secrets):

```bash
BETTER_AUTH_SECRET=$(openssl rand -hex 32)
BETTER_AUTH_URL=http://localhost:3100
SSE_TOKEN_SECRET=$(openssl rand -hex 32)
# BETTER_AUTH_SIGNUP_DISABLED=1   # optional kill-switch
```

The agent will halt before any task that needs these and ask the user to confirm `.env.local` is populated.

- [ ] **Pre-flight 4 (after Task 3 commit lands): Migrate schema**

```bash
pnpm db:generate          # produces drizzle/<NNNN>_phase_11_auth.sql
# review the generated SQL — should add 4 tables + customers.user_id column + 1 index
pnpm db:migrate
```

Expected: 4 new tables on Neon (`user`, `session`, `account`, `verification`), `customers` gains nullable `user_id` column.

---

## Wave A — Schema, env, deps (typecheck-clean before any `better-auth` import)

### Task 1: Env validation

**Files:**
- Modify: `lib/env.ts`
- Modify: `.env.example`

- [ ] **Step 1.1: Add three required + one optional env var to `envSchema`**

```ts
// lib/env.ts (replace envSchema and Env)
const envSchema = z.object({
  DATABASE_URL: z.string().url().min(1),
  DATABASE_URL_UNPOOLED: z.string().url().min(1),
  GEMINI_API_KEY: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be ≥32 chars (use `openssl rand -hex 32`)'),
  BETTER_AUTH_URL: z.string().url().min(1),
  SSE_TOKEN_SECRET: z.string().min(32, 'SSE_TOKEN_SECRET must be ≥32 chars (use `openssl rand -hex 32`)'),
  BETTER_AUTH_SIGNUP_DISABLED: z.string().optional(),
});
```

- [ ] **Step 1.2: Append the four vars to `.env.example`**

```
# Better Auth (phase 11)
BETTER_AUTH_SECRET=replace-me-32-bytes-hex
BETTER_AUTH_URL=http://localhost:3100
SSE_TOKEN_SECRET=replace-me-32-bytes-hex
# BETTER_AUTH_SIGNUP_DISABLED=1
```

- [ ] **Step 1.3: Typecheck**

```bash
pnpm typecheck
```

Expected: PASS. (Existing tests still pass because the validator only runs on import of `env`, which test setup does not.)

- [ ] **Step 1.4: Halt and ask user**

Before continuing, post a one-liner asking the user to populate the three secrets in `.env.local` per Pre-flight 3. **Do not proceed to Task 2 until they confirm.**

- [ ] **Step 1.5: Commit**

```bash
git add lib/env.ts .env.example
git commit -m "phase 11: env vars for Better Auth + SSE token"
git push -u origin phase/11-auth
```

### Task 2: Add `better-auth` to dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 2.1: Append `better-auth` to `dependencies`**

```json
"better-auth": "^1.1.0",
```

(Use the latest stable line at install time; the spec does not pin to a patch.)

- [ ] **Step 2.2: Halt and ask user to run `pnpm install`**

Per Pre-flight 2. Do not proceed until the user confirms `node_modules/better-auth` exists.

- [ ] **Step 2.3: Commit (after install + lockfile update)**

```bash
git add package.json pnpm-lock.yaml
git commit -m "phase 11: add better-auth dependency"
```

### Task 3: Auth schema + customers.user_id

**Files:**
- Create: `db/schema/auth.ts`
- Modify: `db/schema/domain.ts`
- Modify: `db/schema/index.ts`

- [ ] **Step 3.1: Write `db/schema/auth.ts`** (copy from spec §"Schema additions"). Use `pgTable`, `uuid`, `text`, `boolean`, `timestamp`, `index` from `drizzle-orm/pg-core`. Four tables: `user`, `session`, `account`, `verification`. Two indexes on `session` (`session_user_id_idx`, `session_token_idx`), one on `account` (`account_user_id_idx`).

- [ ] **Step 3.2: Add `userId` + index to `customers` in `db/schema/domain.ts`**

```ts
import { user } from './auth';
// ...
export const customers = pgTable('customers', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  phone: text('phone'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('customers_user_id_idx').on(t.userId),
]);
```

- [ ] **Step 3.3: Re-export auth schema in `db/schema/index.ts`**

```ts
export * from './auth';
```

(Place above `./domain` so the FK resolves.)

- [ ] **Step 3.4: Typecheck**

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3.5: Halt and ask user to run migration** (Pre-flight 4). Do not proceed until they confirm `pnpm db:migrate` succeeded.

- [ ] **Step 3.6: Commit**

```bash
git add db/schema/auth.ts db/schema/domain.ts db/schema/index.ts drizzle/
git commit -m "phase 11: Better Auth tables + customers.user_id link"
```

---

## Wave B — Better Auth core wiring

### Task 4: Better Auth server + Next handler

**Files:**
- Create: `lib/auth/server.ts`
- Create: `lib/auth/client.ts`
- Create: `app/api/auth/[...all]/route.ts`

- [ ] **Step 4.1: Write `lib/auth/server.ts`**

```ts
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '@/db/client';
import * as schema from '@/db/schema';
import { env } from '@/lib/env';

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    disableSignUp: env.BETTER_AUTH_SIGNUP_DISABLED === '1',
  },
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  session: {
    expiresIn: 60 * 60 * 24 * 7,        // 7 days
    updateAge: 60 * 60 * 24,            // refresh once per day
  },
});

export type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;
```

- [ ] **Step 4.2: Write `lib/auth/client.ts`**

```ts
'use client';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3100',
});

export const { signIn, signUp, signOut, useSession } = authClient;
```

- [ ] **Step 4.3: Write `app/api/auth/[...all]/route.ts`**

```ts
import { auth } from '@/lib/auth/server';
import { toNextJsHandler } from 'better-auth/next-js';

export const dynamic = 'force-dynamic';
export const { GET, POST } = toNextJsHandler(auth);
```

- [ ] **Step 4.4: Typecheck**

```bash
pnpm typecheck
```

Expected: PASS. (`better-auth` is now installed per Pre-flight 2.)

- [ ] **Step 4.5: Commit**

```bash
git add lib/auth/server.ts lib/auth/client.ts app/api/auth/
git commit -m "phase 11: Better Auth server + client + Next handler"
```

---

## Wave C — Login + Register UI

### Task 5: `(auth)` route group + forms

**Files:**
- Create: `app/(auth)/layout.tsx`
- Create: `app/(auth)/login/page.tsx`
- Create: `app/(auth)/login/login-form.tsx`
- Create: `app/(auth)/register/page.tsx`
- Create: `app/(auth)/register/register-form.tsx`

- [ ] **Step 5.1: Layout** — minimal centered shell, dark/light aware, no `TopNav`. ~15 lines.

- [ ] **Step 5.2: `login/page.tsx`** — server component. If `auth.api.getSession({ headers: await headers() })` returns a session, `redirect('/')`. Otherwise render `<LoginForm />`.

- [ ] **Step 5.3: `login-form.tsx`** — client component with two inputs (email, password), submit calls `authClient.signIn.email({ email, password, callbackURL: '/' })`. Display `result.error.message` on failure. Style follows the existing chat-form aesthetic (rounded-2xl inputs, orange `#FA692E` submit).

- [ ] **Step 5.4: `register/page.tsx`** — same pattern, but if `env.BETTER_AUTH_SIGNUP_DISABLED === '1'` render a "registration disabled" message.

- [ ] **Step 5.5: `register-form.tsx`** — three inputs (name, email, password). Submit calls `authClient.signUp.email({ name, email, password, callbackURL: '/' })`. On success the auto-sign-in lands the user on `/`.

- [ ] **Step 5.6: Typecheck + commit**

```bash
pnpm typecheck
git add app/\(auth\)/
git commit -m "phase 11: /login and /register pages"
```

---

## Wave D — Public-paths, require-session, middleware

### Task 6: Public-paths allowlist + test

**Files:**
- Create: `lib/auth/public-paths.ts`
- Create: `tests/auth/public-paths.test.ts`

- [ ] **Step 6.1: Write `public-paths.ts`** (per spec §"Public-route allowlist")

```ts
export const publicPaths: readonly RegExp[] = [
  /^\/health$/,
  /^\/login$/,
  /^\/register$/,
  /^\/api\/auth\//,
  /^\/api\/inngest$/,
  /^\/api\/tasks\/[^/]+\/stream$/,
];

export function isPublicPath(pathname: string): boolean {
  return publicPaths.some((re) => re.test(pathname));
}
```

- [ ] **Step 6.2: Write `tests/auth/public-paths.test.ts`**

Asserts: `isPublicPath('/health') === true`, every dashboard route in `['/', '/agents', '/billing', '/chat', '/map', '/memories', '/tasks', '/tasks/abc']` is `false`, `/api/tasks` is `false`, `/api/tasks/abc/stream` is `true`, `/api/tasks/abc/stream-token` is `false` (the token-mint route is session-gated), `/api/inngest/leak` is `false` (regex anchored to `$`).

- [ ] **Step 6.3: Test + commit**

```bash
pnpm test tests/auth/public-paths.test.ts
git add lib/auth/public-paths.ts tests/auth/
git commit -m "phase 11: public-paths allowlist + matrix test"
```

### Task 7: `requireSession` server-component guard + test

**Files:**
- Create: `lib/auth/require-session.ts`
- Create: `tests/auth/require-session.test.ts`

- [ ] **Step 7.1: Write `require-session.ts`**

```ts
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from './server';

export async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/login');
  return session;
}

export async function getOptionalSession() {
  return auth.api.getSession({ headers: await headers() });
}
```

- [ ] **Step 7.2: Write the test** — vi-mock `next/headers` and `auth.api.getSession`. Assert `redirect('/login')` thrown when session is null; assert returned object passes through when present.

- [ ] **Step 7.3: Test + commit**

```bash
pnpm test tests/auth/require-session.test.ts
git add lib/auth/require-session.ts tests/auth/require-session.test.ts
git commit -m "phase 11: requireSession server guard"
```

### Task 8: Root `middleware.ts`

**Files:**
- Create: `middleware.ts` (repo root, sibling of `next.config.*`)

- [ ] **Step 8.1: Write the middleware**

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { isPublicPath } from '@/lib/auth/public-paths';

export async function middleware(req: NextRequest) {
  if (isPublicPath(req.nextUrl.pathname)) return NextResponse.next();

  // Better Auth's session cookie name follows its prefix convention.
  const cookie = req.cookies.get('better-auth.session_token');
  if (!cookie) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

// Exclude static assets and Next internals; everything else flows through.
export const config = {
  matcher: ['/((?!_next/|favicon\\.ico).*)'],
};
```

- [ ] **Step 8.2: Apply layout-level `requireSession()` in `app/(dashboard)/layout.tsx`**

The middleware does the redirect; the layout call validates the cookie's session is real (cookie present but expired ≠ valid) and supplies `user` to `TopNav`:

```ts
import { requireSession } from '@/lib/auth/require-session';
// ...
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <TooltipProvider delayDuration={150}>
      <div className="min-h-screen px-6 pt-6 pb-10">
        <TopNav user={session.user} />
        {children}
      </div>
    </TooltipProvider>
  );
}
```

- [ ] **Step 8.3: Manual smoke** — user runs `pnpm dev` (already running on 3100) and confirms:
  - `curl -i localhost:3100/` → 307 to `/login?next=%2F`
  - `curl -i localhost:3100/health` → 200
  - browser navigation to `/` while signed out → lands on `/login`

- [ ] **Step 8.4: Commit**

```bash
git add middleware.ts app/\(dashboard\)/layout.tsx
git commit -m "phase 11: middleware redirect + dashboard layout requireSession"
```

---

## Wave E — SSE token

### Task 9: `lib/auth/sse-token.ts` + unit test

**Files:**
- Create: `lib/auth/sse-token.ts`
- Create: `tests/auth/sse-token.test.ts`

- [ ] **Step 9.1: Implement** (full source from spec §"SSE token mechanism"). Use `node:crypto` `createHmac` + `timingSafeEqual`. TTL default 60s, skew default 5s, both overridable for tests.

- [ ] **Step 9.2: Tests** — round-trip valid; tampered payload → null; tampered sig → null; expired token → null; `taskId` mismatch → null; clock-skew tolerance honored. Stub `Date.now()` via `vi.useFakeTimers()`.

- [ ] **Step 9.3: Test + commit**

```bash
pnpm test tests/auth/sse-token.test.ts
git add lib/auth/sse-token.ts tests/auth/sse-token.test.ts
git commit -m "phase 11: HMAC sign/verify for SSE query-param tokens"
```

### Task 10: Stream route gate + token-refresh route + tests

**Files:**
- Modify: `app/api/tasks/[id]/stream/route.ts`
- Create: `app/api/tasks/[id]/stream-token/route.ts`
- Create: `tests/api/tasks-stream-auth.test.ts`

- [ ] **Step 10.1: Gate the existing stream route**

Insert at the top of the `GET` handler, before the `parseLastEventId` call:

```ts
const url = new URL(req.url);
const token = url.searchParams.get('token');
const verified = token ? verifySseToken(token, { taskId }) : null;
if (!verified) {
  return new Response('unauthorized', { status: 401 });
}
```

- [ ] **Step 10.2: Write `stream-token/route.ts`**

```ts
import { requireSession } from '@/lib/auth/require-session';
import { signSseToken } from '@/lib/auth/sse-token';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const token = signSseToken({ taskId: id, userId: session.user.id });
  return Response.json({ token, ttlSec: 60 });
}
```

- [ ] **Step 10.3: Write `tests/api/tasks-stream-auth.test.ts`**

Cases (all use `fetch` against the route handler with mocked params):
- No `token` → 401
- Bogus `token` → 401
- Token signed for a different task ID → 401
- Expired token (forge `exp` in past) → 401
- Valid token → 200 with `text/event-stream` content-type and at least the heartbeat after 16 s (use `vi.useFakeTimers` + manual `controller` poke).

- [ ] **Step 10.4: Commit**

```bash
git add app/api/tasks/\[id\]/stream/route.ts app/api/tasks/\[id\]/stream-token/ tests/api/tasks-stream-auth.test.ts
git commit -m "phase 11: gate SSE stream behind HMAC token + refresh route"
```

### Task 11: Client patches for the three EventSource sites

**Files:**
- Modify: `app/(dashboard)/tasks/[id]/page.tsx`
- Modify: `app/(dashboard)/tasks/[id]/timeline-stream.tsx`
- Modify: `app/(dashboard)/tasks/[id]/canvas-view.tsx`
- Modify: `app/(dashboard)/tasks/[id]/approval-bar.tsx`

- [ ] **Step 11.1: Mint token in the page server component**

```ts
import { signSseToken } from '@/lib/auth/sse-token';
const session = await requireSession();
const sseToken = signSseToken({ taskId: id, userId: session.user.id });
// pass to <TaskTabs /> which forwards to TimelineStream / CanvasView / ApprovalBar
```

- [ ] **Step 11.2: Patch `timeline-stream.tsx`**

Add `sseToken` prop. Replace `new EventSource(\`/api/tasks/${taskId}/stream\`)` with the helper:

```ts
const openStream = (token: string) =>
  new EventSource(`/api/tasks/${taskId}/stream?token=${encodeURIComponent(token)}`);

// On reconnect (esRef.current?.readyState === EventSource.CLOSED inside onerror):
const fresh = await fetch(`/api/tasks/${taskId}/stream-token`).then((r) => r.json());
esRef.current = openStream(fresh.token);
```

- [ ] **Step 11.3: Same patch for `canvas-view.tsx`** and `approval-bar.tsx`. Centralize the helper if duplication smells — fine to inline three times for v1 (~6 lines each).

- [ ] **Step 11.4: Manual smoke** — user navigates to `/tasks/<id>` for a recent task while signed in. Confirms:
  - DevTools Network → request URL contains `?token=…`
  - Stream stays open; if token TTL is set to 5s in dev, it auto-refreshes via `/stream-token` on `onerror`
  - Logs out, refreshes — lands on `/login`

- [ ] **Step 11.5: Commit**

```bash
git add app/\(dashboard\)/tasks/\[id\]/
git commit -m "phase 11: thread SSE token from server component through three EventSource clients"
```

---

## Wave F — Chat session-derived email + protected mutating routes

### Task 12: Chat reads session

**Files:**
- Modify: `app/(dashboard)/chat/page.tsx`
- Modify: `app/(dashboard)/chat/chat-form.tsx`
- Modify: `app/(dashboard)/chat/actions.ts`

- [ ] **Step 12.1: `page.tsx`** — read session, drop `searchParams.customer`:

```ts
const session = await requireSession();
return <ChatForm defaultEmail={session.user.email} action={createScenarioTask} />;
```

- [ ] **Step 12.2: `chat-form.tsx`** — make `defaultEmail` required; remove the hidden `customer_email` input (the server action reads the session itself); the visible "Replying as: …" pill stays.

- [ ] **Step 12.3: `actions.ts`** — read session in the action body, ignore any form-supplied `customer_email`:

```ts
'use server';
import { requireSession } from '@/lib/auth/require-session';
// ...
export async function createScenarioTask(formData: FormData) {
  const session = await requireSession();
  const prompt = String(formData.get('prompt') ?? '').trim();
  if (!prompt) return;
  const res = await fetch(/* same URL */, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: (await headers()).get('cookie') ?? '' },
    body: JSON.stringify({ kind: 'scenario', prompt, customer_email: session.user.email }),
  });
  // ...
}
```

The `cookie:` forward is needed so the internal `fetch` to `/api/tasks` carries the session through.

### Task 13: Gate `/api/tasks` POST + other dashboard APIs

**Files:**
- Modify: `app/api/tasks/route.ts`
- Modify: `app/api/dashboard/route.ts`
- Modify: `app/api/invoices/route.ts`
- Modify: `app/api/trips/route.ts`
- Modify: `app/api/vehicles/route.ts`
- Create: `tests/api/tasks-post-auth.test.ts`

- [ ] **Step 13.1: At the top of each handler**

```ts
const session = await auth.api.getSession({ headers: req.headers });
if (!session) return new Response('unauthorized', { status: 401 });
```

- [ ] **Step 13.2: In `tasks/route.ts` POST**, after the `safeJson` parse, **overwrite** the body's `customer_email` with `session.user.email`. Keep the `customers` upsert exactly as today; add the lazy linkage update:

```ts
if (parsed.data.kind === 'scenario') {
  const email = session.user.email;          // overwrite, not derive
  const [existing] = await db.select().from(customers).where(eq(customers.email, email));
  if (!existing) {
    await db.insert(customers).values({ name: session.user.name ?? email.split('@')[0], email, userId: session.user.id });
  } else if (!existing.userId) {
    await db.update(customers).set({ userId: session.user.id }).where(eq(customers.id, existing.id));
  }
  prefixedPrompt = `[scenario] customer_email=${email}\n\n${parsed.data.prompt}`;
}
```

- [ ] **Step 13.3: Test `tests/api/tasks-post-auth.test.ts`** — POST without cookie → 401; POST with mocked session → 200, customer linked.

- [ ] **Step 13.4: Commit**

```bash
git add app/api/tasks/route.ts app/api/dashboard/ app/api/invoices/ app/api/trips/ app/api/vehicles/ app/\(dashboard\)/chat/ tests/api/tasks-post-auth.test.ts
git commit -m "phase 11: session-gate /api/tasks + dashboards; chat reads session email"
```

---

## Wave G — TopNav, scripts, e2e, docs

### Task 14: TopNav user pill + sign-out

**Files:**
- Modify: `components/dashboard/top-nav.tsx`

- [ ] **Step 14.1: Add `user` prop** (`{ name?: string; email: string }`) and render a small pill on the right with a dropdown: "Signed in as {email}" + "Sign out" button. Sign-out calls `authClient.signOut({ fetchOptions: { onSuccess: () => router.push('/login') } })`.

- [ ] **Step 14.2: Commit**

```bash
git add components/dashboard/top-nav.tsx
git commit -m "phase 11: TopNav user pill + sign-out"
```

### Task 15: Password-reset script

**Files:**
- Create: `scripts/auth-reset-password.ts`

- [ ] **Step 15.1: Implement**

```ts
import { auth } from '@/lib/auth/server';

const email = process.argv[2];
const newPassword = process.argv[3];
if (!email || !newPassword) {
  console.error('usage: tsx --env-file=.env.local scripts/auth-reset-password.ts <email> <new-password>');
  process.exit(1);
}
await auth.api.setPassword({ body: { email, newPassword } });
console.log(`reset password for ${email}`);
process.exit(0);
```

(Better Auth's `setPassword` admin API path; if the v1.x API differs, adapt — script is for the user, no production dependency.)

- [ ] **Step 15.2: Add `pnpm` script alias to `package.json` `scripts`:**

```json
"auth:reset-password": "tsx --env-file=.env.local scripts/auth-reset-password.ts"
```

- [ ] **Step 15.3: Commit**

```bash
git add scripts/auth-reset-password.ts package.json
git commit -m "phase 11: admin password-reset script"
```

### Task 16: E2E + final verification

**Files:**
- Create: `tests/e2e/login-redirect.spec.ts`
- Modify: `README.md` (phase 11 section)

- [ ] **Step 16.1: Playwright spec** — six steps:
  1. Visit `/` while signed out → assert URL is `/login?next=%2F`
  2. Submit register form (`e2e+phase11@example.test` / random password)
  3. Land on `/` → assert TopNav contains the user email pill
  4. Visit `/chat`, `/billing`, `/map`, `/tasks` → all 200
  5. Click "Sign out" in the pill
  6. Visit `/` → back to `/login?next=%2F`

- [ ] **Step 16.2: README append** — document the two `openssl rand -hex 32` env vars, `pnpm db:migrate` after a fresh clone, and the `pnpm auth:reset-password` script.

- [ ] **Step 16.3: Run full verification**

```bash
pnpm typecheck
pnpm test
pnpm test:e2e -- tests/e2e/login-redirect.spec.ts
pnpm build
```

Expected: all green.

- [ ] **Step 16.4: Assert untouched files** — confirm byte-identical to `main` for: `app/api/inngest/route.ts`, `app/health/route.ts`, every file under `lib/agent/`, `lib/inngest/`, `lib/mcp/`, `db/schema/{tasks,approvals,memories,cleanup,enums}.ts`.

```bash
git diff main -- app/api/inngest app/health lib/agent lib/inngest lib/mcp db/schema/tasks.ts db/schema/approvals.ts db/schema/memories.ts db/schema/cleanup.ts db/schema/enums.ts
```

Expected: empty diff.

- [ ] **Step 16.5: Commit**

```bash
git add tests/e2e/login-redirect.spec.ts README.md
git commit -m "phase 11: e2e login-redirect + README setup notes"
```

---

## Open PR

- [ ] **Final step: Open the PR**

```bash
gh pr create --base main --head phase/11-auth \
  --title "phase 11: auth" \
  --body "$(cat <<'EOF'
Implements phase 11 of the Auto-ride roadmap. See:
- Spec: docs/superpowers/specs/2026-04-30-phase-11-auth-design.md
- Plan: docs/superpowers/plans/2026-04-30-phase-11-auth-plan.md
- auto-ride-initial-plan.md §7 (webapp shape, EventSource caveat) and §8 (Better Auth)

## What ships

- Better Auth (email + password) gates every dashboard route. Public surface limited to `/health`, `/login`, `/register`, `/api/auth/**`, `/api/inngest`, `/api/tasks/[id]/stream`.
- 60-second HMAC-signed query-param token for `EventSource` (plan §7 explicitly calls this out — `EventSource` cannot send headers).
- Three new env vars: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `SSE_TOKEN_SECRET`.
- `customers` keeps its email key; a new nullable `customers.user_id` lazily links the operator's account to their first scenario.

## Verification

- [x] `pnpm typecheck`
- [x] `pnpm test` (incl. new auth + api suites)
- [x] `pnpm test:e2e -- tests/e2e/login-redirect.spec.ts`
- [x] `pnpm build`
- [x] Manual: signed-out `/` redirects to `/login`; signed-in `/tasks/[id]` SSE works; sign-out works.
EOF
)"
```

---

## Risks restated (from spec §"Risks") with mitigation owners by task

| Risk | Owner task |
|---|---|
| Better Auth schema regen overwrites `customers.user_id` | Task 3 — separate file (`db/schema/auth.ts`) |
| `EventSource` reconnect dies after token expiry | Task 11 — `/stream-token` refresh on `onerror` |
| External curl smoke tests break on `/api/tasks` | Task 13 — body still accepts `customer_email` (overwritten server-side) |
| Inngest webhook session-gated | Task 6 — public-paths matrix test asserts `/api/inngest` matches |
| Env validator crashes on first run | Task 1 — Step 1.4 halt-and-ask |
| Seeded customers (ana.khan@…) lose access | Task 3 — `user_id` nullable; query unchanged |
| bcrypt/scrypt cost on login | Task 4 — accept; once-per-session |

---

## Acceptance criteria (mirrors spec)

(Repeat from spec §"Acceptance criteria" — verified during Task 16.)

- [ ] Visiting `/` signed out → 302 to `/login`
- [ ] `/health` signed out → 200
- [ ] `/register` creates `user` + `account` rows; password is hashed
- [ ] `/login` sets cookie; redirects to `/`
- [ ] All dashboard routes render after login
- [ ] `/chat` pill shows session email (no editable email field)
- [ ] First scenario from a new user creates the customer with `user_id IS NOT NULL`
- [ ] `/tasks/[id]` SSE works; `?token=` present; tampering closes
- [ ] Unauth `curl /api/tasks` POST → 401
- [ ] Unauth `curl /api/tasks/<id>/stream` → 401
- [ ] Unauth `curl /api/tasks/<id>/stream?token=BOGUS` → 401
- [ ] Inngest dev CLI still registers (`/api/inngest` reachable)
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm build` all pass
- [ ] `pnpm test:e2e -- tests/e2e/login-redirect.spec.ts` passes
