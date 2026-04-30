import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import Link from 'next/link';
import { auth } from '@/lib/auth/server';
import { env } from '@/lib/env';
import { RegisterForm } from './register-form';

export const dynamic = 'force-dynamic';

export default async function RegisterPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect('/');

  const signUpDisabled = env.BETTER_AUTH_SIGNUP_DISABLED === '1';
  if (signUpDisabled) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-medium tracking-tight">
          Registration disabled
        </h1>
        <p className="text-sm text-neutral-500">
          Sign-up is currently turned off. Ask the admin for an invite, or{' '}
          <Link href="/login" className="text-[#FA692E] hover:underline">
            sign in
          </Link>
          {' '}with an existing account.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-medium tracking-tight">
          Create your account
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Auto-ride operator workspace.
        </p>
      </div>
      <RegisterForm />
      <p className="text-sm text-neutral-500">
        Already have one?{' '}
        <Link href="/login" className="text-[#FA692E] hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
