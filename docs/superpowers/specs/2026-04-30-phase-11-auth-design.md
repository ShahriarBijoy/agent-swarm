# Phase 11 — Auth (design)

**Date:** 2026-04-30
**Status:** drafted — pending user approval
**Plan references:** `auto-ride-initial-plan.md` §7 (webapp shape, EventSource auth caveat) and §8 (Better Auth in the canonical stack)
**Roadmap entry:** `docs/roadmap/ROADMAP.md` — phase 11 ("auth")

## Purpose

Every prior phase ran with the front door wide open. Phase 11 puts a login gate in front of the webapp so that, for the first time, a request to `/`, `/chat`, `/tasks`, `/billing`, `/map`, or any `app/(dashboard)` surface requires a valid Better Auth session, and a request to `/api/tasks` (POST), `/api/dashboard/*`, `/api/vehicles`, `/api/invoices`, or `/api/trips` requires either that session cookie or — for the SSE timeline `EventSource` — a short-lived HMAC-signed query-param token.

Three things that look small but are load-bearing:

1. **Better Auth owns identity.** The plan doc and `vercel-labs/claude-managed-agents-starter` both pick Better Auth + Drizzle + Neon. We follow that choice: email + password, generated tables (`user`, `session`, `account`, `verification`), `/api/auth/[...all]/route.ts` handler.
2. **`EventSource` cannot send headers.** Plan §7 explicitly calls out that `EventSource` is GET-only with no custom headers, so the SSE timeline must use a separate, short-lived signed token in the URL — not the session cookie. We mint that token on the server while rendering the task page, hand it to the client component as a prop, and verify it on `/api/tasks/[id]/stream`.
3. **`customers` outlived its phase.** Phase 10.5 left `customers` keyed by email so a logged-in operator could roleplay a renter without the table caring. Phase 11 keeps `customers` separate from Better Auth's `user` table and links them by email at task-creation time. No merge, no migration of seeded customer rows. The 10.5 spec already telegraphed this design.

The bar for "phase 11 done" is: a fresh visitor cannot see anything past `/login` or `/health`; a signed-in operator can drive every existing flow end-to-end (timeline, approvals, kanban, chat → scenario → invoice) without seeing an auth error; and an unauthenticated `EventSource` request to the stream route is rejected with `401`.

## Non-goals

- **No social / OAuth providers.** No GitHub, Google, magic link, passkeys, 2FA. Email + password only. Better Auth supports the rest as plugins; we pick them up post-v1 if at all.
- **No multi-tenant / org separation.** Single role: every signed-in user is an "operator" with full read+write across the dashboard. No customer-only role, no `/me`-scoped views. The `/chat` page is still useful because the operator roleplays the customer with their own email or any seeded test email.
- **No invite-only sign-up plumbing.** `/register` is open by default. A `BETTER_AUTH_SIGNUP_DISABLED=1` env flag exists as an emergency kill-switch but is not a real allowlist. Portfolio scope.
- **No password reset / email verification flow.** Better Auth supports both; we leave them off in this phase. The user can reset their password via a one-shot `tsx scripts/auth-reset-password.ts` script — same shape as the existing demo scripts.
- **No CSRF middleware beyond what Better Auth ships.** Better Auth's POST endpoints check origin; our own server actions are protected by Next 15's built-in action token. We do not add a third layer.
- **No middleware-level rate limiting.** Out of scope for v1.
- **No session-revocation UI.** "Sign out everywhere" is a button we'd add post-v1; for now sign-out invalidates the current session only.
- **No customer-side accounts.** A `/chat` visitor's identity is still derived from a free-text email field, not a separate sign-up. Phase 11 only protects the operator surface.
- **No reshuffling of existing routes.** Every dashboard URL stays where it is; we only add a redirect if the user is unauthenticated.

## Cost check

Phase 11 adds **zero** Claude SDK calls during normal operation — no agents, no MCP tools, no embeddings. Cost-relevant facts:

- **Per request overhead:** One Better Auth session lookup per protected request (`db.query.session.findFirst` by token) ≈ 1 indexed btree hit on Neon. Negligible compared to the polling loop the SSE route already runs.
- **Per page render:** A signed task page now also mints one HMAC token (`crypto.subtle.sign('HMAC-SHA256', secret, payload)`) — pure CPU, ~50 µs.
- **Neon storage:** Four new Better Auth tables, expected to hold ~1 row per user (handful), ~1 row per session (one per browser, ≤7-day TTL). Negligible. New btree indexes (`session_user_id_idx`, `session_token_idx`) are <50 KB at this scale.
- **No new Inngest events, no new MCP tools, no embedding calls.**

Soft per-task budget caps from phase 05 are unchanged.

## Dependencies

**New runtime packages (one):**

| Package | State | Action | Purpose |
|---|---|---|---|
| `better-auth` | NOT installed | **add to `package.json` `dependencies`**; user installs manually | Auth core (handler, `getSession`, schema generator, password hashing) |

**New env vars (three required, one optional):**

| Var | Required | Example | Purpose |
|---|---|---|---|
| `BETTER_AUTH_SECRET` | yes | 32-byte hex via `openssl rand -hex 32` | Session-cookie signing key |
| `BETTER_AUTH_URL` | yes | `http://localhost:3100` (dev) | Base URL Better Auth emits in cookies / callbacks |
| `SSE_TOKEN_SECRET` | yes | 32-byte hex (separate from `BETTER_AUTH_SECRET`) | HMAC key for SSE query-param tokens |
| `BETTER_AUTH_SIGNUP_DISABLED` | no | `1` | Optional kill-switch on `/register` |

`.env.example` ships placeholders for all four. Per the env-setup feedback memory, the implementation step that first reads these will halt and ask the user to fill them in before continuing.

**Schema delta:** four Better Auth-owned tables (`user`, `session`, `account`, `verification`), one column added to `customers` (`user_id uuid` nullable + index), zero changes elsewhere.

**Versions:** unchanged. No bump to `next`, `drizzle-orm`, the SDK, or any tooling.

## Directory layout (delta from phase 10.5)

```
Agent-swarm/
├── app/
│   ├── (auth)/                                              # NEW route group — public, no DashboardLayout
│   │   ├── layout.tsx                                       # NEW — minimal centered layout
│   │   ├── login/
│   │   │   ├── page.tsx                                     # NEW — email+password form (server action)
│   │   │   └── login-form.tsx                               # NEW — client form with error display
│   │   └── register/
│   │       ├── page.tsx                                     # NEW — sign-up form (gated by env flag)
│   │       └── register-form.tsx                            # NEW
│   ├── (dashboard)/
│   │   ├── layout.tsx                                       # EDIT — call requireSession(); pass user to TopNav
│   │   ├── chat/
│   │   │   ├── page.tsx                                     # EDIT — defaultEmail comes from session.user.email
│   │   │   └── actions.ts                                   # EDIT — derive customer_email from session, not form
│   │   └── tasks/[id]/
│   │       ├── page.tsx                                     # EDIT — mint SSE token, pass to client components
│   │       ├── timeline-stream.tsx                          # EDIT — accept token prop, append `?token=` to URL
│   │       ├── canvas-view.tsx                              # EDIT — same
│   │       └── approval-bar.tsx                             # EDIT — same
│   ├── api/
│   │   ├── auth/[...all]/
│   │   │   └── route.ts                                     # NEW — Better Auth Next handler
│   │   └── tasks/[id]/stream/
│   │       └── route.ts                                     # EDIT — verify ?token= before opening stream
│   └── health/                                              # UNCHANGED — public
├── components/
│   └── dashboard/
│       └── top-nav.tsx                                      # EDIT — add user pill + sign-out button
├── lib/
│   ├── auth/
│   │   ├── server.ts                                        # NEW — better-auth server instance + getSession helper
│   │   ├── client.ts                                        # NEW — better-auth react client (signIn / signUp / signOut)
│   │   ├── require-session.ts                               # NEW — server-component guard, throws redirect to /login
│   │   ├── sse-token.ts                                     # NEW — sign + verify HMAC SSE tokens
│   │   └── public-paths.ts                                  # NEW — array of regex for middleware allowlist
│   └── env.ts                                               # EDIT — add BETTER_AUTH_SECRET / _URL / SSE_TOKEN_SECRET
├── db/
│   └── schema/
│       ├── auth.ts                                          # NEW — Better Auth-generated tables (user/session/account/verification)
│       ├── domain.ts                                        # EDIT — add customers.userId column + fk + index
│       └── index.ts                                         # EDIT — re-export ./auth
├── middleware.ts                                            # NEW — root middleware: redirect unauthenticated to /login
├── scripts/
│   └── auth-reset-password.ts                               # NEW — `tsx --env-file=.env.local scripts/auth-reset-password.ts <email>`
├── tests/
│   ├── auth/
│   │   ├── sse-token.test.ts                                # NEW — sign/verify round-trip + tampering rejection
│   │   ├── public-paths.test.ts                             # NEW — every dashboard route must NOT match
│   │   └── require-session.test.ts                          # NEW — redirect when no cookie, pass when valid
│   ├── api/
│   │   └── tasks-stream-auth.test.ts                        # NEW — bad token → 401, expired → 401, good → 200
│   └── e2e/
│       └── login-redirect.spec.ts                           # NEW — Playwright: visit / unauth → land on /login
└── .env.example                                             # EDIT — add four new vars
```

## Identity model (the load-bearing decision)

```
              email (case-insensitive, unique on both)
              ──────────────────────────────►
   user (Better Auth)                          customers (domain)
   ─────────────────                           ──────────────────
   id            uuid PK                       id           uuid PK
   email         text  unique                  email        text  unique
   email_verified bool                         user_id      uuid? FK → user.id   ◄── NEW
   name          text                          name         text
   image         text?                         phone        text?
   created_at    ts                            created_at   ts
```

**Linkage policy:**

- **At sign-up**, no `customers` row is created. Customers exist only when a scenario task is run.
- **At first scenario task** by a signed-in user, the existing email-based upsert in `app/api/tasks/route.ts` runs (unchanged), then a follow-up `UPDATE customers SET user_id = $1 WHERE email = $2 AND user_id IS NULL` stamps the link. Idempotent.
- **`customers.user_id` stays nullable** because seeded fixture customers (`ana.khan@example.com` et al.) have no Better Auth user, and the 10.5 chat suggestion `"What's the status of my trip? My email is ana.khan@example.com."` must keep working for the operator playing customer.

**Why not merge the tables.** Better Auth wants a specific shape on `user` (`emailVerified`, `image`, `name`); shoehorning that into `customers` works, but every Better Auth schema regen would fight the domain columns. Two tables is the supported path and is what the canonical starter does.

**Why link by email and not by ID.** The operator's session email is the only stable identifier we have at task-creation time, and `customers` is keyed on email already (`unique`). Adding the FK is opportunistic — it makes "show me all of *my* trips" possible later — but the link is *not* required for any phase-11 behavior to work.

## Public-route allowlist

```ts
// lib/auth/public-paths.ts
export const publicPaths = [
  /^\/health$/,
  /^\/login$/,
  /^\/register$/,
  /^\/api\/auth\//,                  // Better Auth handler
  /^\/api\/inngest$/,                // Inngest webhook — signed by Inngest, not user
  /^\/api\/tasks\/[^/]+\/stream$/,   // SSE — auth via ?token=, see sse-token.ts
  /^\/_next\//,                      // build assets
  /^\/favicon\.ico$/,
];
```

Notes:

- `/api/inngest` cannot be session-gated because Inngest's CLI hits it with its own signing key. It is already idempotent and validates Inngest's signature header internally.
- `/api/tasks/[id]/stream` is the *only* dashboard route in the allowlist. It is **not** unauthenticated — the route handler calls `verifySseToken(searchParams.get('token'), { taskId })` and returns `401` on miss. The middleware just doesn't redirect it to `/login` because an `EventSource` cannot follow a 302.
- Every other `/api/*` route falls through to the session check. POST `/api/tasks` becomes a 401 for unauth callers; the action `createScenarioTask` calls it with credentials by virtue of being a server action on a session-gated page.

## SSE token mechanism

```
                   server component renders /tasks/[id]
                   ─────────────────────────────────────
                   const session = await requireSession();
                   const token   = await signSseToken({ taskId, userId, ttlSec: 60 });
                   <TimelineStream taskId={id} token={token} />

                                   ▼  prop

                   client component opens EventSource
                   ──────────────────────────────────
                   new EventSource(`/api/tasks/${taskId}/stream?token=${token}`)

                                   ▼  request

                   route handler /api/tasks/[id]/stream
                   ─────────────────────────────────────
                   const token = url.searchParams.get('token');
                   const claims = await verifySseToken(token, { taskId });
                   if (!claims) return new Response('unauthorized', { status: 401 });
                   // ...existing polling loop
```

**Token shape (compact, no JWT lib):**

```
base64url(payload) + '.' + base64url(hmac)
   payload = JSON: { tid: <taskId>, uid: <userId>, exp: <unix-seconds> }
   hmac    = HMAC-SHA256(SSE_TOKEN_SECRET, payload-bytes)
```

Implementation lives in `lib/auth/sse-token.ts` using `node:crypto` (`createHmac`, `timingSafeEqual`). No `jsonwebtoken`, no `jose` dependency — ~50 lines of code. TTL: 60 seconds at issuance, plus a 5-second clock-skew tolerance on verify.

**Refresh on reconnect.** `EventSource` auto-reconnects with `Last-Event-ID`, but its URL — including the `?token=` — is fixed at construction. After ≥60 s the token expires; on a stream error the existing client code already sees `onerror`. We add a `fetch('/api/tasks/[id]/stream-token')` (new route, session-cookie-gated) that returns a fresh token, then reconstruct the `EventSource`. ~15 client-side lines, see `timeline-stream.tsx` patch.

**Why not bind the token to the cookie session token.** Two reasons. (a) The cookie token is long-lived (7-day default in Better Auth), so a leaked SSE URL would grant a 7-day stream subscription. The 60-second HMAC limits exposure to a window. (b) The cookie token rotates on Better Auth's schedule; if we bound to it the SSE would tear down on every rotation. The HMAC is decoupled and self-contained.

**What attackers can do with a leaked token.** Read the SSE for that task ID for ≤60 s. Cannot post events, cannot approve gates, cannot read other tasks (`tid` is in the signed payload). Acceptable risk for the threat model.

## Behavior changes by route

| Route | Before phase 11 | After phase 11 |
|---|---|---|
| `/` (dashboard home) | Public | Redirect to `/login` if no session |
| `/agents`, `/tasks`, `/tasks/[id]`, `/billing`, `/map`, `/memories`, `/chat` | Public | Redirect to `/login` if no session |
| `/health` | Public | Public (unchanged) |
| `/login`, `/register` | (did not exist) | Public; if already signed in, redirect to `/` |
| `/api/auth/[...all]` | (did not exist) | Public (Better Auth's own handler) |
| `/api/inngest` | Public | Public (Inngest signs requests) |
| `/api/tasks` (POST) | Public | 401 if no session cookie |
| `/api/tasks/[id]/stream` (GET, EventSource) | Public | 401 if no/invalid `?token=` query param |
| `/api/tasks/[id]/stream-token` (GET, fetch) | (did not exist) | 401 if no session cookie; returns fresh SSE token |
| `/api/dashboard/*`, `/api/vehicles`, `/api/invoices`, `/api/trips` | Public | 401 if no session cookie |

The chat-form `defaultEmail` prop is now sourced from `session.user.email` instead of `searchParams.customer`. The hidden `customer_email` form input is removed: `createScenarioTask` server action reads the session itself. The visible "Replying as: …" pill stays.

## Schema additions

```ts
// db/schema/auth.ts — NEW
// Generated by `npx @better-auth/cli generate --output db/schema/auth.ts`
// then hand-edited only to import the existing `pgTable` / column helpers.

export const user = pgTable('user', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  name: text('name'),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable('session', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('session_user_id_idx').on(t.userId),
  index('session_token_idx').on(t.token),
]);

export const account = pgTable('account', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  providerId: text('provider_id').notNull(),       // 'credential' for email+password
  accountId: text('account_id').notNull(),
  password: text('password'),                      // bcrypt hash, only for 'credential'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('account_user_id_idx').on(t.userId),
]);

export const verification = pgTable('verification', {
  id: uuid('id').defaultRandom().primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

```ts
// db/schema/domain.ts — EDIT (one column added)
export const customers = pgTable('customers', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),  // NEW
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  phone: text('phone'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('customers_user_id_idx').on(t.userId),                                    // NEW
]);
```

Migration: `pnpm db:generate` → review the generated SQL → `pnpm db:migrate`. The `customers.user_id` add is non-destructive (nullable, no default needed).

## Testing strategy

| Layer | Tests | Why |
|---|---|---|
| Unit (`tests/auth/sse-token.test.ts`) | Sign+verify round-trip; tampered payload fails; expired token fails; clock skew tolerance | Hand-rolled crypto needs paranoia |
| Unit (`tests/auth/public-paths.test.ts`) | Every public-allowlist regex matches its intended path and *fails* on every dashboard path | Catch a `/api/inngest` regex that accidentally matches `/api/inngest/leak` |
| Unit (`tests/auth/require-session.test.ts`) | Mock `cookies()`; verify redirect on miss, pass-through on hit | Server-component guard |
| Route (`tests/api/tasks-stream-auth.test.ts`) | Hit `/api/tasks/<id>/stream` with no token / bad token / expired token / valid token; assert 401 vs 200 | Token gate is the new auth boundary |
| E2E (`tests/e2e/login-redirect.spec.ts`) | Visit `/`, `/chat`, `/tasks`, `/billing`, `/map` while logged out → land on `/login`. Sign in. Visit each → see content. Sign out. Visit `/` → back to `/login`. | The phase-11 acceptance test |

E2E uses Playwright and runs against `pnpm dev`'s 3100 port (per the `feedback_no_port_3000` memory). The user keeps the dev server running themselves; the E2E suite expects to find it.

## Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Better Auth schema regen overwrites our `customers.user_id` edit** | Keep auth tables in `db/schema/auth.ts` and domain tables in `db/schema/domain.ts`. Regen only ever writes `auth.ts`. |
| 2 | **`EventSource` reconnect after token expiry leaves stream silently dead** | Client catches `onerror`, fetches `/api/tasks/[id]/stream-token`, reconstructs `EventSource`. Test in E2E by setting TTL to 5s in dev. |
| 3 | **`/api/tasks` POST path no longer reads `customer_email` — breaks any external curl-based smoke tests** | Keep `customer_email` accepted in the body schema, but server-side overwrite it with `session.user.email`. Logged warning in dev when the body field is set. |
| 4 | **Inngest webhook accidentally session-gated** | `public-paths.test.ts` asserts `/api/inngest` matches the allowlist. |
| 5 | **First-time setup hits `loadEnv()` and crashes because new env vars are missing** | `lib/env.ts` validation surfaces a readable error listing the four new vars. Per env-setup memory, halt and ask the user before any "run". |
| 6 | **Existing seeded customers (ana.khan@…) lose access to "what's my trip" queries because they have no `user_id`** | `user_id` is nullable. The query still keys on email; the FK is opportunistic. |
| 7 | **bcrypt hash on every login adds ~150ms per request** | Acceptable. Better Auth uses `scrypt` by default in 2026 builds, similar profile. Login is a once-per-session cost. |

## Acceptance criteria

- [ ] Visiting `http://localhost:3100/` while signed out lands on `/login` (302)
- [ ] Visiting `/health` while signed out returns 200 with the same body shape as today
- [ ] `/register` creates a `user` row and an `account` row with `provider_id='credential'` and a hashed password
- [ ] `/login` with the registered credentials sets a Better Auth session cookie and redirects to `/`
- [ ] After login, every existing dashboard route renders without errors
- [ ] `/chat` form pre-fills the signed-in user's email in the "Replying as: …" pill (no input field)
- [ ] Submitting the chat form runs the existing 10.5 scenario flow end-to-end and creates the customer linked to the user (verify `customers.user_id IS NOT NULL` after first send)
- [ ] `/tasks/[id]` opens the SSE timeline; `EventSource` URL contains `?token=…`; tampering with the token client-side closes the stream
- [ ] An unauthenticated `curl /api/tasks` POST returns 401
- [ ] An unauthenticated `curl /api/tasks/<id>/stream` returns 401
- [ ] An unauthenticated `curl /api/tasks/<id>/stream?token=BOGUS` returns 401
- [ ] Inngest dev CLI can still register functions and process events (i.e. `/api/inngest` is reachable)
- [ ] `pnpm test` passes (existing suites unchanged + new auth suites)
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test:e2e -- tests/e2e/login-redirect.spec.ts` passes

## Phase 11 PR checklist (to copy into the PR body)

- [ ] Worktree at `.worktree/phase-11-auth/` with branch `phase/11-auth`
- [ ] Git identity verified (`shahriarbijoy` / `shahriarbijoy@gmail.com`)
- [ ] Design spec exists at `docs/superpowers/specs/2026-04-30-phase-11-auth-design.md`
- [ ] Implementation plan exists at `docs/superpowers/plans/2026-04-30-phase-11-auth-plan.md`
- [ ] All acceptance criteria checked off above
- [ ] No regressions in prior phases (run `pnpm test` + `pnpm typecheck` + `pnpm build`)
- [ ] PR title is `phase 11: auth`
- [ ] PR body links plan §7 (auth + EventSource caveat) and §8 (Better Auth selection)
