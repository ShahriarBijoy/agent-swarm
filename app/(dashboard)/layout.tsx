// app/(dashboard)/layout.tsx
import Link from 'next/link';

export default function DashboardLayout({
  children,
}: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen px-6 pt-6 pb-10">
      <header className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-4 px-2 pb-5">
        <div className="flex items-center gap-2.5">
          <div className="grid h-[22px] w-[22px] place-items-center rounded-[4px] bg-[var(--color-ink)] font-display text-[14px] text-[var(--color-lime)]">A</div>
          <span className="text-[16px] font-semibold tracking-tight">
            auto-ride <span className="font-normal text-[var(--color-muted)]">/ swarm-ops</span>
          </span>
        </div>
        <nav className="justify-self-center flex gap-1.5 rounded-full bg-black/5 p-1">
          {(['Today', 'This Week', 'This Month', 'Reports'] as const).map((label, i) => (
            <button
              key={label}
              className={`rounded-full px-4 py-[7px] text-[13px] font-medium ${
                i === 2 ? 'bg-[var(--color-ink)] text-[var(--color-surface)]' : 'text-[var(--color-muted)]'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
        <Link
          href="/tasks"
          className="rounded-full border border-[var(--color-line-strong)] px-3.5 py-[7px] text-[12px] font-medium"
        >
          All agents ▾
        </Link>
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--color-ink)] font-mono text-[14px] text-[var(--color-surface)]">⌘</div>
      </header>
      {children}
    </div>
  );
}
