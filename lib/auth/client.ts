'use client';

import { createAuthClient } from 'better-auth/react';

// Phase 11 — Better Auth React client.
//
// `baseURL` defaults to the current origin in the browser, so leaving it
// undefined is fine in dev and prod. Setting it explicitly here would couple
// the client to a hard-coded port; the empty constructor lets it follow the
// page that loaded it (port 3100 in dev, deployed origin in prod).
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
