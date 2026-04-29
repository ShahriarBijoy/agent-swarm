'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

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

export function TopNav() {
  const pathname = usePathname() ?? '/';
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

      <div className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--color-ink)] font-mono text-[14px] text-[var(--color-surface)]" aria-hidden>
        ⌘
      </div>
    </header>
  );
}
