// scripts/auth-reset-password.ts
//
// Reset a user's password directly in the DB. Useful when:
//   - You forgot a dev password and there's no email-reset flow yet (phase 11
//     intentionally ships without one).
//   - You're seeding a first admin user during a fresh clone.
//
// The script writes a fresh hash using Better Auth's own hashPassword helper
// so the value matches what the runtime sign-in flow expects to verify.
//
// Usage:
//   pnpm auth:reset-password <email> <new-password>
//
// (See package.json — the alias points here with --env-file=.env.local
// so DATABASE_URL is available.)

import { hashPassword } from 'better-auth/crypto';
import { db } from '@/db/client';
import { user, account } from '@/db/schema/auth';
import { eq, and } from 'drizzle-orm';

async function main(): Promise<void> {
  const [email, newPassword] = process.argv.slice(2);
  if (!email || !newPassword) {
    console.error(
      'usage: pnpm auth:reset-password <email> <new-password>',
    );
    process.exit(2);
  }
  if (newPassword.length < 8) {
    console.error('password must be ≥8 chars (Better Auth minPasswordLength)');
    process.exit(2);
  }

  const [u] = await db.select().from(user).where(eq(user.email, email));
  if (!u) {
    console.error(`no user row for email=${email}`);
    process.exit(1);
  }

  const hash = await hashPassword(newPassword);
  const result = await db
    .update(account)
    .set({ password: hash, updatedAt: new Date() })
    .where(
      and(eq(account.userId, u.id), eq(account.providerId, 'credential')),
    );

  // Drizzle's neon-http result shape doesn't expose rowCount in a stable way,
  // so just assert the user existed and the update didn't throw.
  console.log(
    `reset password for ${email} (user_id=${u.id}). result=${JSON.stringify(result)}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
