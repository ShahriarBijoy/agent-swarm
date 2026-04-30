'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '@/lib/auth/client';

type NavItem = { label: string; href: string; match: (path: string) => boolean };

const NAV: NavItem[] = [
  { label: 'Home',     href: '/',         match: (p) => p === '/' },
  { label: 'Map',      href: '/map',      match: (p) => p === '/map' || p.startsWith('/map/') },
  { label: 'Billing',  href: '/billing',  match: (p) => p === '/billing' || p.startsWith('/billing/') },
  { label: 'Chat',     href: '/chat',     match: (p) => p === '/chat' || p.startsWith('/chat/') },
  { label: 'Tasks',    href: '/tasks',    match: (p) => p === '/tasks' || p.startsWith('/tasks/') },
  { label: 'Agents',   href: '/agents',   match: (p) => p === '/agents' || p.startsWith('/agents/') },
  { label: 'Memories', href: '/memories', match: (p) => p === '/memories' },
];

export function TopNav({
  user,
}: {
  user?: { email: string; name?: string | null };
}) {
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    await authClient.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="grid grid-cols-[auto_1fr_auto] items-center gap-4 px-2 pb-5">
      <Link href="/" className="flex items-center gap-2.5">
        <div className="grid h-[22px] w-[22px] place-items-center rounded-[4px] bg-[var(--color-ink)] font-display text-[14px] text-[var(--color-lime)]">A</div>
        <span className="text-[16px] font-semibold tracking-tight">
          auto-ride <span className="font-normal text-[var(--color-muted)]">/ swarm-ops</span>
        </span>
      </Link>

      <nav className="justify-self-center flex gap-1.5 rounded-full bg-black/5 p-1" aria-label="Primary">
        {NAV.map((item) => {
          const active = item.match(pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`rounded-full px-4 py-[7px] text-[13px] font-medium transition-colors ${
                active
                  ? 'bg-[var(--color-ink)] text-[var(--color-surface)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {user ? (
        <div className="flex items-center gap-2">
          <span
            className="hidden max-w-[180px] truncate font-mono text-[11px] text-[var(--color-muted)] sm:inline"
            title={user.email}
          >
            {user.email}
          </span>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="rounded-full border border-[var(--color-line-strong)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-muted)] transition-colors hover:bg-black/5 hover:text-[var(--color-ink)] disabled:opacity-50"
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      ) : (
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--color-ink)] font-mono text-[14px] text-[var(--color-surface)]" aria-hidden>
          ⌘
        </div>
      )}
    </header>
  );
}
