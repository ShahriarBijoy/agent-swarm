'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth/client';

// Phase 11 — Sign-up. Better Auth handles password hashing (scrypt by
// default) and creates the user/account rows; with autoSignIn enabled in
// lib/auth/server.ts the session cookie comes back on the same response.

export function RegisterForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result = await authClient.signUp.email({
      name,
      email,
      password,
      callbackURL: '/',
    });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? 'Sign-up failed');
      return;
    }
    router.push('/');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <input
        type="text"
        name="name"
        autoComplete="name"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name"
        className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#FA692E]/40 dark:border-[#222] dark:bg-[#0F0F10]"
      />
      <input
        type="email"
        name="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#FA692E]/40 dark:border-[#222] dark:bg-[#0F0F10]"
      />
      <input
        type="password"
        name="password"
        autoComplete="new-password"
        required
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password (min 8 chars)"
        className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#FA692E]/40 dark:border-[#222] dark:bg-[#0F0F10]"
      />
      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-full bg-[#FA692E] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
      >
        {pending ? 'Creating…' : 'Create account'}
      </button>
    </form>
  );
}
