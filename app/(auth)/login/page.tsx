import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import Link from 'next/link';
import { auth } from '@/lib/auth/server';
import { LoginForm } from './login-form';

// Phase 11 — Login page.
// If the visitor already has a session, bounce them to the dashboard so the
// back button doesn't trap them on /login after sign-out.

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect('/');
  const { next } = await searchParams;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-medium tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Continue to the Auto-ride dashboard.
        </p>
      </div>
      <LoginForm callbackURL={next ?? '/'} />
      <p className="text-sm text-neutral-500">
        New here?{' '}
        <Link href="/register" className="text-[#FA692E] hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
